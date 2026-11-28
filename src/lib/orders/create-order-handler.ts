import { normalizeIsraeliPhone } from "@/lib/customers/phone";
import { normalizeCustomerEmail } from "@/lib/orders/customer-email";
import type { FulfillmentSettings } from "@/lib/fulfillment/settings";
import type { OpeningHours } from "@/lib/settings/opening-hours";
import {
  buildServerOrder,
  createOrderRequestSchema,
  generateOrderNumber,
  type CatalogProduct,
  type OrderBuildError,
  type ServerOrderDraft,
} from "@/lib/orders/server-order";
import { CouponUnavailableError, isPersonalCouponCode } from "@/lib/loyalty/coupons";
import { checkStoreCoupon, normalizeStoreCode, type StoreCoupon } from "@/lib/coupons/store-coupons";
import type { ProductBuilderConfig } from "@/types/modifiers";
import type { Bundle } from "@/lib/bundles/bundle";
import { requestProductIds } from "@/lib/orders/price-lines";
import { applyPointsToOrder, checkRedemption, PointsUnavailableError, type PointsRefusal, type RedemptionSettings } from "@/lib/loyalty/redemption";

/**
 * POST /api/orders/create, without the HTTP and Firebase wiring (injected), so it can be tested
 * with in-memory stand-ins.
 */

export type CreateOrderDeps = {
  now: () => Date;
  loadProducts: (ids: string[]) => Promise<ReadonlyMap<string, CatalogProduct | undefined>>;
  loadContext: () => Promise<{ fulfillment: FulfillmentSettings; openingHours: OpeningHours }>;
  /** The products' add-on groups from the database: add-on prices are taken only from here. */
  loadModifierConfigs: (productIds: string[]) => Promise<ReadonlyMap<string, ProductBuilderConfig>>;
  /** The bundles asked for, from the database (Admin → Sales → Bundles); missing = deleted. */
  loadBundles?: (ids: string[]) => Promise<ReadonlyMap<string, Bundle | undefined>>;
  /** Returns true when under the limit. */
  rateLimit: (key: string, windowSeconds: number, limit: number) => Promise<boolean>;
  saveOrder: (draft: ServerOrderDraft) => Promise<string>;
  /**
   * The club member logged in on this device (from the signed club session), or null.
   * Never trusted from the request body. A failure here must not block the order.
   */
  findClubMember?: () => Promise<{ id: string; email?: string | null; status?: string; balancePoints?: number } | null>;
  /** The club's points settings (paying with points is off until the point value is set and approved). */
  loadLoyaltySettings?: () => Promise<RedemptionSettings>;
  /**
   * Saves the order with the points taken off the member's balance, plus its coupon if any, in ONE
   * transaction (throws PointsUnavailableError when the balance changed meanwhile).
   */
  saveOrderWithPoints?: (
    draft: ServerOrderDraft,
    parts: {
      points: { memberId: string; points: number; discount: number; pointValueMinor: number };
      personalCoupon?: { code: string; memberId: string; heldBy: string | null };
      storeCouponRecord?: { code: string; type: StoreCoupon["type"]; value: number; discount: number };
    }
  ) => Promise<string>;
  /** Personal club code (MK-XXXX-XXXX): can the logged-in member use it now? */
  checkClubCoupon?: (
    code: string,
    member: { id: string; status?: string }
  ) => Promise<
    { ok: true; percent: number; heldBy: string | null } | { ok: false; reason: "invalid" | "used" | "expired" }
  >;
  /** Saves the order and marks the personal code used by it, in one transaction. */
  saveOrderWithCoupon?: (
    draft: ServerOrderDraft,
    coupon: { code: string; memberId: string; heldBy: string | null }
  ) => Promise<string>;
  /**
   * After the order is saved: keep the member's phone (and, from a delivery, area, address and
   * link) on the member, to fill the checkout next time on any device. Club members only
   * (active or suspended). A failure here never fails the order.
   */
  rememberMemberCheckout?: (memberId: string, order: ServerOrderDraft) => Promise<void>;
  /**
   * Store coupons (Admin → Coupons): the coupon as it works now (record first, MISHKAT10 built in),
   * how many counted orders this customer (club member or phone) already has with it, and saving the
   * order together with the discount priced for it (read later by the card charge).
   */
  findStoreCoupon?: (code: string) => Promise<StoreCoupon | null>;
  countStoreCouponUses?: (code: string, who: { memberId: string | null; phone: string | null }) => Promise<number>;
  saveOrderWithStoreCoupon?: (draft: ServerOrderDraft, record: { code: string; type: StoreCoupon["type"]; value: number; discount: number }) => Promise<string>;
};

export type CreateOrderResponse =
  | { status: 200; body: { ok: true; id: string; orderNumber: string; total: number } }
  | { status: 400; body: { ok: false; code: "INVALID_REQUEST" | "INVALID_PHONE" } }
  | { status: 409; body: { ok: false } & OrderBuildError }
  | { status: 429; body: { ok: false; code: "RATE_LIMITED" } }
  | { status: 500; body: { ok: false; code: "ORDER_SAVE_FAILED" } };

export const ORDER_RATE_LIMITS = {
  perPhone: { windowSeconds: 60 * 60, limit: 30 },
  perIp: { windowSeconds: 60 * 60, limit: 100 },
  /** Table orders without a phone are limited per table instead. */
  perTable: { windowSeconds: 60 * 60, limit: 20 },
} as const;

type CouponReason = Extract<OrderBuildError, { code: "COUPON_INVALID" }>["reason"];

function couponRefused(reason: CouponReason): CreateOrderResponse {
  return { status: 409, body: { ok: false, code: "COUPON_INVALID", reason } };
}

function pointsRefused(reason: PointsRefusal, maxPoints = 0): CreateOrderResponse {
  return { status: 409, body: { ok: false, code: "POINTS_UNAVAILABLE", reason, maxPoints } };
}

export async function handleCreateOrder(
  rawBody: unknown,
  ip: string,
  deps: CreateOrderDeps
): Promise<CreateOrderResponse> {
  const parsed = createOrderRequestSchema.safeParse(rawBody);
  if (!parsed.success) return { status: 400, body: { ok: false, code: "INVALID_REQUEST" } };
  const request = parsed.data;
  // A table order may come without a phone (name only); a phone that is given must be a real
  // Israeli number: 9 or 10 digits starting with 0, or +972 (saved as 0…).
  const givenPhone = request.customer.phone.trim();
  const phone = normalizeIsraeliPhone(givenPhone);
  const phoneOptional = request.fulfillment.type === "dine_in" && !givenPhone;
  if (!phoneOptional && !phone) return { status: 400, body: { ok: false, code: "INVALID_PHONE" } };
  if (phone) request.customer.phone = phone;
  const digits = phone ?? "";

  try {
    const { perPhone, perIp, perTable } = ORDER_RATE_LIMITS;
    const phoneOk = phoneOptional
      ? await deps.rateLimit(
          `create-order|table|${request.fulfillment.type === "dine_in" ? request.fulfillment.tableId : ""}`,
          perTable.windowSeconds,
          perTable.limit
        )
      : await deps.rateLimit(`create-order|phone|${digits}`, perPhone.windowSeconds, perPhone.limit);
    const ipOk = !ip || (await deps.rateLimit(`create-order|ip|${ip}`, perIp.windowSeconds, perIp.limit));
    if (!phoneOk || !ipOk) return { status: 429, body: { ok: false, code: "RATE_LIMITED" } };

    // The products of the lines and of the bundles' picks; the bundles themselves from the database.
    const productIds = requestProductIds(request.items, request.bundles ?? []);
    const bundleIds = [...new Set((request.bundles ?? []).map((b) => b.bundleId))];
    const [products, context, modifierConfigs, bundles] = await Promise.all([
      deps.loadProducts(productIds),
      deps.loadContext(),
      deps.loadModifierConfigs(productIds),
      bundleIds.length > 0 && deps.loadBundles ? deps.loadBundles(bundleIds) : Promise.resolve(new Map<string, Bundle | undefined>()),
    ]);
    const now = deps.now();
    // Club member from the signed session (never from the request body).
    const member = deps.findClubMember ? await deps.findClubMember().catch(() => null) : null;

    // A personal club code works only for its owner, logged in to the club on this device.
    const personalCode = isPersonalCouponCode(request.couponCode) ? request.couponCode!.trim().toUpperCase() : null;
    let personal: { percent: number; heldBy: string | null } | null = null;
    if (personalCode) {
      if (!member) return couponRefused("login_required");
      if (!deps.checkClubCoupon || !deps.saveOrderWithCoupon) return couponRefused("invalid");
      const check = await deps.checkClubCoupon(personalCode, member);
      if (!check.ok) return couponRefused(check.reason);
      personal = { percent: check.percent, heldBy: check.heldBy };
    }

    // A store coupon (one coupon per order: the request has a single code). Checked here on the server
    // only: active, date, who may use it (club members by the signed club cookie), once per customer.
    // The minimum order and "not the whole order" are checked when the order is priced.
    let storeCoupon: StoreCoupon | null | undefined;
    const storeCode = !personalCode ? normalizeStoreCode(request.couponCode) : "";
    if (deps.findStoreCoupon) {
      storeCoupon = null;
      if (storeCode) {
        const coupon = await deps.findStoreCoupon(storeCode);
        const who = { memberId: member?.id ?? null, phone: digits || null };
        const customerUses = coupon?.limit === "once" && deps.countStoreCouponUses ? await deps.countStoreCouponUses(storeCode, who) : 0;
        const check = checkStoreCoupon(coupon, { now, isMember: member?.status === "active", customerUses });
        if (!check.ok) return couponRefused(check.reason);
        storeCoupon = check.coupon;
      }
    }

    const built = buildServerOrder(request, {
      products,
      modifierConfigs,
      bundles,
      fulfillment: context.fulfillment,
      openingHours: context.openingHours,
      now,
      orderNumber: generateOrderNumber(now),
      personalCouponRate: personal ? personal.percent / 100 : undefined,
      storeCoupon,
    });
    if (!built.ok) return { status: 409, body: { ok: false, ...built.error } };

    // Paying with points (after the sale and the coupon): checked here against the club settings and
    // the member's balance; taken off the balance in the same transaction as the order.
    let redemption: { points: number; discount: number; pointValueMinor: number } | null = null;
    const requestedPoints = request.redeemPoints ?? 0;
    if (requestedPoints > 0) {
      const settings = deps.loadLoyaltySettings && deps.saveOrderWithPoints ? await deps.loadLoyaltySettings() : null;
      if (!settings) return pointsRefused("disabled");
      const check = checkRedemption(requestedPoints, {
        member,
        settings,
        productsAfterCoupon: Math.round((built.order.subtotal - built.order.discount) * 100) / 100,
        totalBeforePoints: built.order.total,
        dineIn: request.fulfillment.type === "dine_in",
      });
      if (!check.ok) return pointsRefused(check.reason, check.maxPoints);
      redemption = { points: check.points, discount: check.discount, pointValueMinor: settings.pointValueMinor };
    }

    // Club member: points by member id (not by email); their saved email, if any, for the
    // payment confirmation. The checkout no longer asks for an email.
    let order: ServerOrderDraft = { ...built.order };
    if (redemption) order = applyPointsToOrder(order, redemption.points, redemption.discount);
    if (member?.id) {
      order.loyalty = { memberId: member.id };
      const memberEmail = normalizeCustomerEmail(member.email);
      if (memberEmail && !order.customerEmail) order.customerEmail = memberEmail;
    }

    const storeRecord = storeCoupon && order.discount > 0 ? { code: storeCode, type: storeCoupon.type, value: storeCoupon.value, discount: order.discount } : undefined;
    const id = redemption && member && deps.saveOrderWithPoints
      ? await deps.saveOrderWithPoints(order, {
          points: { memberId: member.id, ...redemption },
          ...(personal && personalCode ? { personalCoupon: { code: personalCode, memberId: member.id, heldBy: personal.heldBy } } : {}),
          ...(storeRecord && deps.saveOrderWithStoreCoupon ? { storeCouponRecord: storeRecord } : {}),
        })
      : personal && personalCode && member && deps.saveOrderWithCoupon
        ? await deps.saveOrderWithCoupon(order, { code: personalCode, memberId: member.id, heldBy: personal.heldBy })
        : storeCoupon && order.discount > 0 && deps.saveOrderWithStoreCoupon
          ? await deps.saveOrderWithStoreCoupon(order, storeRecord!)
          : await deps.saveOrder(order);
    if (member?.id && deps.rememberMemberCheckout && (member.status === "active" || member.status === "suspended")) {
      await deps.rememberMemberCheckout(member.id, order).catch((error) =>
        console.error("[orders/create] member checkout details not saved:", error instanceof Error ? error.message : error)
      );
    }
    return { status: 200, body: { ok: true, id, orderNumber: built.order.orderNumber, total: order.total } };
  } catch (error) {
    // The code was taken by another order a moment ago: nothing was saved.
    if (error instanceof CouponUnavailableError) return couponRefused(error.reason);
    // The balance changed a moment ago (another order, an adjustment): nothing was saved.
    if (error instanceof PointsUnavailableError) return pointsRefused(error.reason);
    console.error("[orders/create] failed:", error instanceof Error ? error.message : error);
    return { status: 500, body: { ok: false, code: "ORDER_SAVE_FAILED" } };
  }
}
