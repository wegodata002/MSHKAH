import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { normalizeCustomerEmail } from "@/lib/orders/customer-email";
import {
  authoritativeOrderAmount,
  chargeFromCatalogSum,
  formatHypAmount,
} from "@/lib/payments/hyp/amounts";
import { paymentAudit } from "@/lib/payments/hyp/audit";
import { createHypPaymentPage, verifyHypRedirect } from "@/lib/payments/hyp/client";
import { HypConfigError, isHypConfigured } from "@/lib/payments/hyp/config";
import { decidePaymentUpdate } from "@/lib/payments/hyp/decide";
import { runFailedPostPaymentTasks, runPaidPostPaymentTasks } from "@/lib/payments/hyp/pipeline";
import { hypLogFields, parseHypRedirect } from "@/lib/payments/hyp/query";
import { HYP_CURRENCY, HYP_PROVIDER } from "@/lib/payments/hyp/types";
import type { FirestoreOrder } from "@/types/firestore";
import { loadFulfillmentContext } from "@/lib/orders/server-context";
import { loadModifierConfigs } from "@/lib/orders/admin-modifier-config";
import { deliveryFeeForZone } from "@/lib/fulfillment/availability";
import { isPersonalCouponCode } from "@/lib/loyalty/coupons";
import { personalCouponRateForOrder } from "@/lib/loyalty/admin/coupons";
import { readOrderCouponRecord, readStoreCoupon } from "@/lib/coupons/admin/store";
import { heldPointsDiscount, releaseOrderPoints } from "@/lib/loyalty/admin/redemption";
import { couponStatus, normalizeStoreCode } from "@/lib/coupons/store-coupons";
import { tryCreateTrackingToken } from "@/lib/orders/tracking-token";
import { linesFromStoredItems, priceOrderLines, requestProductIds } from "@/lib/orders/price-lines";
import type { CatalogProduct } from "@/lib/orders/server-order";
import { loadBundles } from "@/lib/bundles/admin";
import { deliveryFeeAfterOffers } from "@/lib/bundles/bundle";

/** A bundle that was on when the order was placed still counts at the card charge, this long after. */
export const BUNDLE_CHARGE_GRACE_MS = 60 * 60_000;

/** When the order was placed (server time), if it was a short while ago; else null. */
function placedRecently(order: FirestoreOrder, now: Date): Date | null {
  const raw = (order as { createdAt?: unknown }).createdAt as { toDate?: () => Date } | undefined;
  const at = raw && typeof raw.toDate === "function" ? raw.toDate() : null;
  if (!at || !Number.isFinite(at.getTime())) return null;
  const age = now.getTime() - at.getTime();
  return age >= 0 && age <= BUNDLE_CHARGE_GRACE_MS ? at : null;
}

export class HypPaymentError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = "HypPaymentError";
  }
}

function pageLangFromLocale(locale?: string): "HEB" | "ENG" {
  return locale === "en" ? "ENG" : "HEB";
}

async function trustedChargeAmount(
  order: FirestoreOrder,
  orderId: string
): Promise<{ amount: number; discount: number; subtotal: number; delivery: number; pointsDiscount: number }> {
  const items = order.items ?? [];
  if (items.length === 0) {
    throw new HypPaymentError("Order has no items", "INVALID_AMOUNT", 400);
  }
  const db = getAdminDb();
  // The order's lines (products on their own, and each bundle's products) — only ids and quantities;
  // every price is worked out again by the SAME function as the order route (price-lines): the sale
  // price while a sale is on, the bundle price from the bundle in the database, add-ons from the
  // products' add-on groups. Never a price written on the order.
  const lines = linesFromStoredItems(items as Parameters<typeof linesFromStoredItems>[0]);
  if (!lines) {
    throw new HypPaymentError("Order items are invalid", "INVALID_AMOUNT", 400);
  }
  const productIds = requestProductIds(lines.items, lines.bundles);
  const now = new Date();
  const [modifierConfigs, products, bundles] = await Promise.all([
    loadModifierConfigs(db, productIds),
    loadChargeProducts(db, productIds),
    lines.bundles.length > 0 ? loadBundles(db, lines.bundles.map((b) => b.bundleId)) : Promise.resolve(new Map()),
  ]);
  const priced = priceOrderLines(lines, { products, modifierConfigs, bundles, now, locale: "he", charge: { placedAt: placedRecently(order, now) } });
  if (!priced.ok) {
    const error = priced.error;
    if (error.code === "BUNDLE_UNAVAILABLE") throw new HypPaymentError("A bundle in the order is over", "BUNDLE_UNAVAILABLE", 409);
    if (error.code === "OPTIONS_UNAVAILABLE") throw new HypPaymentError("Order add-ons are invalid", "INVALID_AMOUNT", 400);
    if (error.code === "INVALID_PRICE") throw new HypPaymentError("Order amount is invalid", "INVALID_AMOUNT", 400);
    throw new HypPaymentError("Order items are invalid", "INVALID_AMOUNT", 400);
  }
  const catalogSum = priced.value.subtotal;
  // Discount is derived from the stored coupon code only — never order.discount.
  // Delivery fee comes from the settings for the order's area — never order.delivery,
  // which the browser could still write directly until the rules are locked; free when a sale or
  // a bundle in the order gives free delivery (from its minimum), exactly as the order route.
  const deliveryFee = deliveryFeeAfterOffers(await trustedDeliveryFee(order), catalogSum, priced.value.freeDeliveryFrom).fee;
  // A personal club code counts only if it is recorded as used by this very order.
  const personalRate = isPersonalCouponCode(order.couponCode)
    ? await personalCouponRateForOrder(db, orderId, order.couponCode)
    : undefined;
  // A store coupon: the discount the server priced and saved with this order (never order.discount,
  // which the browser could write). An order priced before that record existed: the coupon as it works
  // now (its record first — a disabled or deleted MISHKAT10 gives nothing). No coupon: nothing.
  let store: { discount: number } | { rate: number } | undefined;
  if (personalRate === undefined) {
    const code = normalizeStoreCode(order.couponCode);
    const record = code ? await readOrderCouponRecord(db, orderId) : null;
    if (record && record.code === code) store = { discount: Number(record.discount) || 0 };
    else if (code) {
      const coupon = await readStoreCoupon(db, code);
      const usable = coupon && coupon.type === "percent" && coupon.audience === "all" && couponStatus(coupon, new Date()) === "active";
      store = { rate: usable ? coupon.value / 100 : 0 };
    } else store = { rate: 0 };
  }
  // Club points: what the server took off the member for this order (0 once given back).
  const points = await heldPointsDiscount(db, orderId);
  return {
    ...chargeFromCatalogSum(catalogSum, { ...order, delivery: deliveryFee }, personalRate, store, points, priced.value.couponBase),
    delivery: deliveryFee,
  };
}

/** The order's products from the catalog (one read each; a product deleted since = missing). */
async function loadChargeProducts(db: ReturnType<typeof getAdminDb>, ids: readonly string[]): Promise<Map<string, CatalogProduct | undefined>> {
  const out = new Map<string, CatalogProduct | undefined>();
  await Promise.all(
    ids.map(async (id) => {
      const snap = await db.collection(COLLECTIONS.products).doc(id).get();
      out.set(id, snap.exists ? (snap.data() as CatalogProduct) : undefined);
    })
  );
  return out;
}

async function trustedDeliveryFee(order: FirestoreOrder): Promise<number> {
  if (order.orderType !== "delivery") return 0;
  const zoneId = order.deliveryZoneId?.trim();
  if (!zoneId) {
    throw new HypPaymentError("Delivery area is missing", "DELIVERY_ZONE_REQUIRED", 409);
  }
  const { fulfillment } = await loadFulfillmentContext(getAdminDb());
  const fee = deliveryFeeForZone(fulfillment, zoneId);
  if (fee === null) {
    throw new HypPaymentError("Delivery area is unknown", "DELIVERY_ZONE_UNKNOWN", 409);
  }
  return fee;
}

export async function createHypPaymentAttempt(
  orderId: string,
  customer?: { name?: string; phone?: string; email?: string }
): Promise<{
  paymentId: string;
  paymentUrl: string;
}> {
  if (!isHypConfigured()) {
    throw new HypConfigError();
  }

  const id = orderId.trim();
  if (!id) {
    throw new HypPaymentError("orderId required", "ORDER_REQUIRED", 400);
  }

  const db = getAdminDb();
  const orderRef = db.collection(COLLECTIONS.orders).doc(id);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    throw new HypPaymentError("Order not found", "ORDER_NOT_FOUND", 404);
  }

  let order = orderSnap.data() as FirestoreOrder;
  if (order.status === "cancelled") {
    throw new HypPaymentError("Order cannot be paid", "ORDER_CANCELLED", 409);
  }
  if (order.paymentStatus === "paid") {
    throw new HypPaymentError("Order is already paid", "ALREADY_PAID", 409);
  }

  const customerPatch: Record<string, string> = {};
  const nextName = customer?.name?.trim();
  const nextPhone = customer?.phone?.trim();
  const nextEmail = normalizeCustomerEmail(customer?.email);
  if (nextName) {
    customerPatch.customerName = nextName;
    customerPatch.customerFullName = nextName;
  }
  if (nextPhone) customerPatch.customerPhone = nextPhone;
  if (nextEmail) customerPatch.customerEmail = nextEmail;
  if (Object.keys(customerPatch).length > 0) {
    await orderRef.update(customerPatch);
    order = { ...order, ...customerPatch };
  }

  const { amount, discount, subtotal, delivery, pointsDiscount } = await trustedChargeAmount(order, id);
  if (amount <= 0) {
    throw new HypPaymentError("Order amount is invalid", "INVALID_AMOUNT", 400);
  }
  if (
    amount !== authoritativeOrderAmount(order) ||
    amount !== order.total ||
    discount !== order.discount ||
    delivery !== (Number(order.delivery) || 0) ||
    pointsDiscount !== (Number((order as { pointsDiscount?: unknown }).pointsDiscount) || 0)
  ) {
    await orderRef.update({ total: amount, subtotal, discount, delivery, pointsDiscount });
    order = { ...order, total: amount, subtotal, discount, delivery, pointsDiscount } as typeof order;
  }

  const customerEmail = normalizeCustomerEmail(order.customerEmail);
  const customerFullName = (order.customerFullName || order.customerName || "").trim();
  const customerPhone = order.customerPhone?.trim() || "";
  const paymentRef = db.collection(COLLECTIONS.payments).doc();
  const now = FieldValue.serverTimestamp();
  await paymentRef.set({
    orderId: id,
    orderNumber: order.orderNumber,
    provider: HYP_PROVIDER,
    amount,
    expectedAmount: amount,
    currency: HYP_CURRENCY,
    status: "pending",
    customerEmail: customerEmail || null,
    customerName: customerFullName || null,
    customerFullName: customerFullName || null,
    customerPhone: customerPhone || null,
    createdAt: now,
    updatedAt: now,
  });

  await orderRef.update({
    paymentMethod: "card",
    paymentStatus: "pending",
    paymentProvider: HYP_PROVIDER,
  });
  paymentAudit("PAYMENT_CREATED", { orderId: id, paymentAttemptId: paymentRef.id });

  try {
    const paymentUrl = await createHypPaymentPage({
      amount: formatHypAmount(amount),
      orderRef: paymentRef.id,
      info: `Mishkat ${order.orderNumber}`,
      clientName: customerFullName || undefined,
      cell: customerPhone || undefined,
      email: customerEmail || undefined,
      pageLang: pageLangFromLocale(order.locale),
    });
    paymentAudit("HYP_REDIRECT_CREATED", { orderId: id, paymentAttemptId: paymentRef.id });
    return { paymentId: paymentRef.id, paymentUrl };
  } catch (error) {
    await paymentRef.update({
      status: "failed",
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.error(
      "[hyp] create failed",
      hypLogFields({
        orderId: id,
        paymentAttemptId: paymentRef.id,
        providerErrorCode:
          error instanceof Error ? error.message.replace(/^HYP_SIGN_FAILED:/, "") : "sign_failed",
      })
    );
    throw new HypPaymentError(
      "Could not open the secure payment page",
      "HYP_UNAVAILABLE",
      502
    );
  }
}

export async function handleHypReturn(rawQuery: string): Promise<{
  redirectPath: string;
}> {
  const redirect = parseHypRedirect(rawQuery);
  const paymentId = redirect.order.trim();

  if (!paymentId) {
    return { redirectPath: "/payment/failed?reason=cancelled" };
  }

  const db = getAdminDb();
  const paymentRef = db.collection(COLLECTIONS.payments).doc(paymentId);
  const paymentSnap = await paymentRef.get();
  if (!paymentSnap.exists) {
    console.error(
      "[hyp] return unknown payment",
      hypLogFields({
        paymentAttemptId: paymentId,
        providerErrorCode: redirect.cCode || "unknown_payment",
      })
    );
    return { redirectPath: "/payment/failed?reason=failed" };
  }

  const payment = paymentSnap.data() as {
    orderId: string;
    orderNumber?: string;
    amount: number;
    status: string;
    hypTransactionId?: string;
  };

  const orderRef = db.collection(COLLECTIONS.orders).doc(payment.orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    return { redirectPath: `/payment/failed?orderId=${encodeURIComponent(payment.orderId)}&reason=failed` };
  }

  const order = orderSnap.data() as FirestoreOrder;
  const failedPath = `/payment/failed?orderId=${encodeURIComponent(payment.orderId)}&order=${encodeURIComponent(order.orderNumber)}`;
  const successParams = new URLSearchParams({
    order: order.orderNumber,
    amount: formatHypAmount(payment.amount),
  });
  const successName = (order.customerFullName || order.customerName || "").trim();
  if (successName) successParams.set("name", successName);
  // Tracking link for the "Track your order" button on the success page (left out if it cannot be made:
  // the payment is final by now and must not fail because of it).
  const trackingToken = tryCreateTrackingToken(payment.orderId);
  if (trackingToken) successParams.set("t", trackingToken);
  const successPath = `/payment/success?${successParams.toString()}`;
  paymentAudit("HYP_RETURN_RECEIVED", {
    orderId: payment.orderId,
    paymentAttemptId: paymentId,
    extra: { cCode: redirect.cCode },
  });

  let verified = false;
  let verifyCode = "";
  if (rawQuery.trim()) {
    try {
      const result = await verifyHypRedirect(rawQuery);
      verified = result.ok;
      verifyCode = result.cCode;
      paymentAudit(result.ok ? "HYP_VERIFY_SUCCESS" : "HYP_VERIFY_FAILED", {
        orderId: payment.orderId,
        paymentAttemptId: paymentId,
        extra: { verifyCode: result.cCode },
      });
    } catch (error) {
      console.error(
        "[hyp] verify failed",
        hypLogFields({
          orderId: payment.orderId,
          paymentAttemptId: paymentId,
          providerErrorCode: error instanceof Error ? error.message : "verify_failed",
        })
      );
      verified = false;
    }
  }

  const decision = decidePaymentUpdate({
    order: {
      id: payment.orderId,
      total: authoritativeOrderAmount(order),
      status: order.status,
      paymentStatus: order.paymentStatus,
    },
    payment: {
      id: paymentId,
      orderId: payment.orderId,
      amount: payment.amount,
      status: payment.status,
      hypTransactionId: payment.hypTransactionId,
    },
    verified,
    resultCCode: redirect.cCode,
    returnedAmount: redirect.amount,
    returnedOrder: redirect.order,
    returnedCoin: redirect.coin || undefined,
    transactionId: redirect.id,
  });

  if (decision.action === "already_processed") {
    if (decision.outcome === "paid") {
      void runPaidPostPaymentTasks(payment.orderId, paymentId);
    }
    return {
      redirectPath: decision.outcome === "paid" ? successPath : `${failedPath}&reason=${decision.outcome}`,
    };
  }

  if (decision.action === "reject") {
    console.error(
      "[hyp] return rejected",
      hypLogFields({
        orderId: payment.orderId,
        paymentAttemptId: paymentId,
        providerErrorCode: decision.reason,
        extra: { verifyCode, resultCCode: redirect.cCode },
      })
    );
    if (
      decision.reason !== "verify_failed" &&
      payment.status !== "paid" &&
      order.paymentStatus !== "paid"
    ) {
      await paymentRef.update({
        status: "failed",
        lastCCode: redirect.cCode || decision.reason,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return { redirectPath: `${failedPath}&reason=failed` };
  }

  const alreadyPaid = await db.runTransaction(async (tx) => {
    const livePayment = await tx.get(paymentRef);
    const liveOrder = await tx.get(orderRef);
    const livePaymentData = livePayment.data();
    const liveOrderData = liveOrder.data() as FirestoreOrder | undefined;
    if (!livePaymentData || !liveOrderData) return false;

    if (liveOrderData.paymentStatus === "paid" || livePaymentData.status === "paid") {
      return true;
    }

    const now = FieldValue.serverTimestamp();

    if (decision.action === "mark_paid") {
      const paidPatch: Record<string, unknown> = {
        status: "paid",
        hypTransactionId: redirect.id,
        providerReference: redirect.id,
        lastCCode: redirect.cCode,
        verifiedAt: now,
        paidAt: now,
        updatedAt: now,
      };
      if (redirect.aCode) paidPatch.approvalCode = redirect.aCode;
      tx.update(paymentRef, paidPatch);
      tx.update(orderRef, {
        paymentStatus: "paid",
        paymentMethod: "card",
        paymentProvider: HYP_PROVIDER,
        paymentTransactionId: redirect.id,
        paidAt: now,
      });
      return false;
    }

    const nextStatus = decision.action === "mark_cancelled" ? "cancelled" : "failed";
    tx.update(paymentRef, {
      status: nextStatus,
      lastCCode: redirect.cCode || verifyCode,
      updatedAt: now,
    });
    tx.update(orderRef, {
      paymentStatus: nextStatus === "cancelled" ? "pending" : "failed",
    });
    return false;
  });

  if (decision.action === "mark_paid") {
    if (!alreadyPaid) {
      paymentAudit("PAYMENT_CONFIRMED", {
        orderId: payment.orderId,
        paymentAttemptId: paymentId,
      });
      paymentAudit("ORDER_CONFIRMED", {
        orderId: payment.orderId,
        paymentAttemptId: paymentId,
      });
    }
    void runPaidPostPaymentTasks(payment.orderId, paymentId);
    return { redirectPath: successPath };
  }

  if (!alreadyPaid && (decision.action === "mark_failed" || decision.action === "mark_cancelled")) {
    // The card payment failed or was cancelled at the payment page: the club points paid with on
    // this order go back to the member, once. (A payment never finished keeps them held until a
    // manager cancels the order: the admin shows "points held".)
    await releaseOrderPoints(db, payment.orderId, "payment_failed").catch((error) =>
      console.error("[loyalty] points release failed after card failure", {
        orderId: payment.orderId,
        message: error instanceof Error ? error.message : "unknown",
      })
    );
    void runFailedPostPaymentTasks(payment.orderId, paymentId);
  }

  return {
    redirectPath: `${failedPath}&reason=${decision.action === "mark_cancelled" ? "cancelled" : "failed"}`,
  };
}
