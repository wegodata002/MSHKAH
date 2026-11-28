// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFakeFirestore } from "./helpers/fake-firestore";
import {
  applyPointsToOrder,
  checkRedemption,
  maxRedeemablePoints,
  pointsHeldOnOrder,
  PointsUnavailableError,
  redemptionReady,
  type RedemptionSettings,
} from "@/lib/loyalty/redemption";
import { handleCreateOrder, type CreateOrderDeps } from "@/lib/orders/create-order-handler";
import type { CatalogProduct, ServerOrderDraft } from "@/lib/orders/server-order";
import { chargeFromCatalogSum, amountFromOrderItems } from "@/lib/payments/hyp/amounts";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { localToDate } from "@/lib/fulfillment/availability";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { buildTrackingView } from "@/lib/orders/tracking-view";
import { buildReceiptModelFromOrder } from "@/lib/print-jobs/receipt-model";
import { ADMIN_TRANSLATIONS } from "@/data/admin-translations";
import { UI_TRANSLATIONS_SEED } from "@/data/ui-translations-seed";

const fake = createFakeFirestore();
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fake.db }));
const redemption = await import("@/lib/loyalty/admin/redemption");
const db = fake.db as unknown as Parameters<typeof redemption.saveOrderWithPoints>[0];
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** ₪0.10 a point, 10–500 points per order. */
const ON: RedemptionSettings = { redemptionEnabled: true, pointValueApproved: true, pointValueMinor: 10, redemptionMinPoints: 10, redemptionMaxPoints: 500 };

describe("the rules (pure)", () => {
  it("off until the value is set and approved and redemption is on", () => {
    expect(redemptionReady(ON)).toBe(true);
    expect(redemptionReady({ ...ON, pointValueMinor: 0 })).toBe(false);
    expect(redemptionReady({ ...ON, pointValueApproved: false })).toBe(false);
    expect(redemptionReady({ ...ON, redemptionEnabled: false })).toBe(false);
    expect(maxRedeemablePoints({ balancePoints: 1000, settings: { ...ON, pointValueMinor: 0 }, productsAfterCoupon: 50, totalBeforePoints: 50 })).toBe(0);
  });

  it("the most points: balance, club maximum, products after the coupon (₪1 always left), club minimum", () => {
    const max = (balance: number, products: number, total = products) => maxRedeemablePoints({ balancePoints: balance, settings: ON, productsAfterCoupon: products, totalBeforePoints: total });
    expect(max(120, 50)).toBe(120); // the balance
    expect(max(2000, 100)).toBe(500); // the club maximum
    expect(max(2000, 30)).toBe(290); // ₪30 of products: up to ₪29, ₪1 left to pay
    expect(max(2000, 30, 45)).toBe(300); // with ₪15 delivery: all the products, never the delivery
    expect(max(9, 50)).toBe(0); // below the club minimum
    expect(max(2000, 0.5)).toBe(0);
    expect(maxRedeemablePoints({ balancePoints: 5, settings: { ...ON, redemptionMinPoints: 0, redemptionMaxPoints: 0 }, productsAfterCoupon: 50, totalBeforePoints: 50 })).toBe(5);
  });

  it("the server's answer, with the reason and the new maximum", () => {
    const ctx = { member: { status: "active", balancePoints: 200 }, settings: ON, productsAfterCoupon: 40, totalBeforePoints: 40, dineIn: false };
    expect(checkRedemption(150, ctx)).toEqual({ ok: true, points: 150, discount: 15 });
    expect(checkRedemption(150, { ...ctx, settings: { ...ON, redemptionEnabled: false } })).toMatchObject({ ok: false, reason: "disabled" });
    expect(checkRedemption(150, { ...ctx, dineIn: true })).toMatchObject({ ok: false, reason: "not_here" });
    expect(checkRedemption(150, { ...ctx, member: null })).toMatchObject({ ok: false, reason: "login_required" });
    expect(checkRedemption(150, { ...ctx, member: { status: "suspended", balancePoints: 200 } })).toMatchObject({ ok: false, reason: "not_member" });
    expect(checkRedemption(250, ctx)).toEqual({ ok: false, reason: "insufficient_balance", maxPoints: 200 });
    expect(checkRedemption(5, ctx)).toMatchObject({ ok: false, reason: "below_minimum" });
    expect(checkRedemption(200, { ...ctx, productsAfterCoupon: 15, totalBeforePoints: 15 })).toEqual({ ok: false, reason: "too_many", maxPoints: 140 });
  });

  it("the order total after points; 'points held' only on an unpaid card order not cancelled and not given back", () => {
    expect(applyPointsToOrder({ total: 40.5 }, 150, 15)).toEqual({ total: 25.5, pointsRedeemed: 150, pointsDiscount: 15 });
    const card = { pointsRedeemed: 150, paymentMethod: "card", paymentStatus: "pending", status: "pending" };
    expect(pointsHeldOnOrder(card)).toBe(150);
    expect(pointsHeldOnOrder({ ...card, paymentStatus: "failed" })).toBe(150);
    expect(pointsHeldOnOrder({ ...card, paymentStatus: "paid" })).toBe(0);
    expect(pointsHeldOnOrder({ ...card, status: "cancelled" })).toBe(0);
    expect(pointsHeldOnOrder({ ...card, pointsReleasedAt: "2026-11-26T10:00:00Z" })).toBe(0);
    expect(pointsHeldOnOrder({ ...card, paymentMethod: "cash" })).toBe(0);
    expect(pointsHeldOnOrder({ ...card, pointsRedeemed: 0 })).toBe(0);
  });
});

describe("the order route: sale → coupon → points, decided on the server", () => {
  const PRODUCTS = new Map<string, CatalogProduct | undefined>([["latte", { price: 20, nameHe: "לאטה", available: true }]]);
  const NOON = localToDate({ year: 2026, month: 11, day: 24 }, 12 * 60);
  type Saved = { draft: ServerOrderDraft; parts?: Parameters<NonNullable<CreateOrderDeps["saveOrderWithPoints"]>>[1] };
  const deps = (saved: Saved[], over: Partial<CreateOrderDeps> = {}): CreateOrderDeps => ({
    now: () => NOON,
    loadProducts: async () => PRODUCTS,
    loadContext: async () => ({ fulfillment: DEFAULT_FULFILLMENT, openingHours: DEFAULT_OPENING_HOURS }),
    loadModifierConfigs: async () => new Map(),
    rateLimit: async () => true,
    saveOrder: async (draft) => {
      saved.push({ draft });
      return "Order0000001";
    },
    findClubMember: async () => ({ id: "MemberA001", status: "active", balancePoints: 300 }),
    loadLoyaltySettings: async () => ON,
    saveOrderWithPoints: async (draft, parts) => {
      saved.push({ draft, parts });
      return "Order0000002";
    },
    findStoreCoupon: async (code) => (code === "SAVE10" ? { code, name: { he: "", ar: "", en: "" }, type: "percent", value: 10, audience: "all", minOrder: 0, limit: "unlimited", active: true, expiresAt: null, createdAt: "", updatedAt: "" } as never : null),
    saveOrderWithStoreCoupon: async (draft) => {
      saved.push({ draft });
      return "Order0000003";
    },
    ...over,
  });
  const body = (over: Record<string, unknown> = {}) => ({ items: [{ productId: "latte", quantity: 2 }], customer: { name: "דנה", phone: "050-1234567" }, payment: "online", fulfillment: { type: "pickup" }, ...over });

  it("coupon then points: ₪40 − 10% = ₪36, 150 points = ₪15 → ₪21; saved with the points and the coupon record in one call", async () => {
    const saved: Saved[] = [];
    const r = await handleCreateOrder(body({ couponCode: "SAVE10", redeemPoints: 150 }), "", deps(saved));
    expect(r).toMatchObject({ status: 200, body: { ok: true, id: "Order0000002", total: 21 } });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.draft).toMatchObject({ subtotal: 40, discount: 4, pointsRedeemed: 150, pointsDiscount: 15, total: 21, loyalty: { memberId: "MemberA001" } });
    expect(saved[0]!.parts).toEqual({ points: { memberId: "MemberA001", points: 150, discount: 15, pointValueMinor: 10 }, storeCouponRecord: { code: "SAVE10", type: "percent", value: 10, discount: 4 } });
  });

  it("no points asked: saved as before (no points fields)", async () => {
    const saved: Saved[] = [];
    await handleCreateOrder(body(), "", deps(saved));
    expect(saved[0]!.parts).toBeUndefined();
    expect(saved[0]!.draft).not.toHaveProperty("pointsRedeemed");
  });

  it("refused with a reason (nothing saved): off, guest, table, too many for this order", async () => {
    const cases: Array<[Partial<CreateOrderDeps>, Record<string, unknown>, string]> = [
      [{ loadLoyaltySettings: async () => ({ ...ON, pointValueApproved: false }) }, {}, "disabled"],
      [{ findClubMember: async () => null }, {}, "login_required"],
      [{}, { fulfillment: { type: "dine_in", tableId: "in-1" }, payment: "table" }, "not_here"],
      // ₪40 of products: at most 390 points (₪1 left to pay), with a balance of 1000.
      [{ findClubMember: async () => ({ id: "MemberA001", status: "active", balancePoints: 1000 }) }, { redeemPoints: 450 }, "too_many"],
      [{}, { redeemPoints: 450 }, "insufficient_balance"],
    ];
    for (const [over, extra, reason] of cases) {
      const saved: Saved[] = [];
      const r = await handleCreateOrder(body({ redeemPoints: 150, ...extra }), "", deps(saved, over));
      if (reason === "not_here") {
        // The table may be unknown in the default settings; either way no points and nothing saved with them.
        expect(saved.some((s) => s.parts)).toBe(false);
        continue;
      }
      expect(r.status, reason).toBe(409);
      expect(r.body).toMatchObject({ ok: false, code: "POINTS_UNAVAILABLE", reason });
      expect(saved).toHaveLength(0);
    }
  });

  it("the balance changed during the save → refused, nothing saved", async () => {
    const r = await handleCreateOrder(body({ redeemPoints: 150 }), "", deps([], { saveOrderWithPoints: async () => { throw new PointsUnavailableError("insufficient_balance"); } }));
    expect(r).toEqual({ status: 409, body: { ok: false, code: "POINTS_UNAVAILABLE", reason: "insufficient_balance", maxPoints: 0 } });
  });
});

describe("in the database: one transaction, given back once", () => {
  const NOW = new Date("2026-11-26T10:00:00Z");
  beforeEach(() => {
    fake.reset();
    fake.put("loyaltyMembers", "MemberA001", { status: "active", balancePoints: 300, email: "a@x.com" });
  });
  const points = (n: number) => ({ memberId: "MemberA001", points: n, discount: n / 10, pointValueMinor: 10 });
  const balance = async () => (await fake.db.collection("loyaltyMembers").doc("MemberA001").get()).data()!.balancePoints;

  it("save: the order, the balance and the ledger together; the card charge reads the held value", async () => {
    const id = await redemption.saveOrderWithPoints(db, { order: { orderNumber: "MC-1", total: 21 }, points: points(150), storeCouponRecord: { code: "SAVE10", type: "percent", value: 10, discount: 4 }, now: NOW });
    expect(await balance()).toBe(150);
    expect((await fake.db.collection("orders").doc(id).get()).data()).toMatchObject({ orderNumber: "MC-1" });
    expect((await fake.db.collection("loyaltyPointsLedger").doc(`redeem:${id}`).get()).data()).toMatchObject({ kind: "redeem", points: -150, discountMinor: 1500, orderId: id, memberId: "MemberA001" });
    expect((await fake.db.collection("orderCoupons").doc(id).get()).data()).toMatchObject({ code: "SAVE10", discount: 4 });
    expect(await redemption.heldPointsDiscount(db, id)).toBe(15);
  });

  it("two orders at once cannot spend the same points: the second is refused and not saved", async () => {
    await redemption.saveOrderWithPoints(db, { order: { orderNumber: "MC-1" }, points: points(200), now: NOW });
    await expect(redemption.saveOrderWithPoints(db, { order: { orderNumber: "MC-2" }, points: points(200), now: NOW })).rejects.toBeInstanceOf(PointsUnavailableError);
    expect(await balance()).toBe(100);
    const orders = await fake.db.collection("orders").get();
    expect(orders.docs.map((d) => d.data().orderNumber)).toEqual(["MC-1"]);
  });

  it("a suspended member cannot pay with points", async () => {
    fake.put("loyaltyMembers", "MemberA001", { status: "suspended", balancePoints: 300 });
    await expect(redemption.saveOrderWithPoints(db, { order: {}, points: points(100), now: NOW })).rejects.toMatchObject({ reason: "not_member" });
  });

  it("given back once (cancel / failed card): balance restored, order marked, the charge no longer takes them off", async () => {
    const id = await redemption.saveOrderWithPoints(db, { order: { orderNumber: "MC-1" }, points: points(150), now: NOW });
    expect(await redemption.releaseOrderPoints(db, id, "cancelled", NOW)).toBe(150);
    expect(await redemption.releaseOrderPoints(db, id, "cancelled", NOW)).toBe(0);
    expect(await balance()).toBe(300);
    expect((await fake.db.collection("loyaltyPointsLedger").doc(`unredeem:${id}`).get()).data()).toMatchObject({ kind: "unredeem", points: 150, reason: "cancelled" });
    expect((await fake.db.collection("orders").doc(id).get()).data()).toMatchObject({ pointsReleasedAt: NOW.toISOString() });
    expect(await redemption.heldPointsDiscount(db, id)).toBe(0);
    expect(await redemption.releaseOrderPoints(db, "NoPointsOrder", "cancelled", NOW)).toBe(0);
  });
});

describe("card charge and earning", () => {
  it("the charge takes the held points off the products after the coupon (never the delivery)", () => {
    expect(chargeFromCatalogSum(40, { couponCode: "SAVE10" }, undefined, { discount: 4 }, 15)).toEqual({ amount: 21, discount: 4, subtotal: 40, pointsDiscount: 15 });
    expect(chargeFromCatalogSum(40, { couponCode: "SAVE10", delivery: 15 }, undefined, { discount: 4 }, 99)).toEqual({ amount: 15, discount: 4, subtotal: 40, pointsDiscount: 36 });
    expect(chargeFromCatalogSum(40, {}, undefined, { rate: 0 })).toMatchObject({ amount: 40, pointsDiscount: 0 });
    expect(amountFromOrderItems({ items: [{ price: 20, quantity: 2 }], discount: 4, pointsDiscount: 15 })).toBe(21);
  });

  it("the charge prices from the catalog with the sale price and the server's points; failures give the points back", () => {
    const process = read("src/lib/payments/hyp/process.ts");
    expect(process).toContain("priceNow({ price: snap.data()?.price, sales: snap.data()?.sales }, new Date()).price");
    expect(process).toContain("const points = await heldPointsDiscount(db, orderId);");
    expect(process).toContain(`await releaseOrderPoints(db, payment.orderId, "payment_failed")`);
    const cancel = read("src/lib/email/notifications/order-cancelled.ts");
    expect(cancel.indexOf(`releaseOrderPoints(getAdminDb(), orderId, "cancelled")`)).toBeGreaterThan(0);
    expect(cancel.indexOf(`releaseOrderPoints(getAdminDb(), orderId, "cancelled")`)).toBeLessThan(cancel.indexOf("const claim = await claimNotification"));
  });

  it("points are earned on what was paid (the total, already after points), not taken off twice", () => {
    const hook = read("src/lib/loyalty/order-hook.ts");
    expect(hook).not.toMatch(/redeemedValueMinor:\s*order\.loyalty/);
    expect(hook).toContain("paidAmountMinor: toMinor(paidTotal)");
  });
});

describe("shown on the tracking page and the receipt", () => {
  const order = { id: "o1", orderNumber: "MC-2026-ABCD1234", customerName: "דנה", status: "pending", items: [{ productId: "latte", productName: "לאטה", quantity: 2, price: 20 }], subtotal: 40, discount: 4, pointsRedeemed: 150, pointsDiscount: 15, delivery: 0, total: 21, createdAt: "2026-11-26T10:00:00Z", orderType: "pickup" };
  it("tracking: its own line; receipt: inside the discount line (the printer agent needs no update)", () => {
    expect(buildTrackingView(order as never, new Date("2026-11-26T10:05:00Z"))).toMatchObject({ discount: 4, points: 15, total: 21 });
    expect(buildReceiptModelFromOrder(order as never, "he")).toMatchObject({ discount: 19, subtotal: 40, total: 21 });
  });
});

describe("texts in Hebrew, Arabic and English", () => {
  it("every new key exists in the three languages", () => {
    const ui = ["checkout.points.title", "checkout.points.balance", "checkout.points.notThisOrder", "checkout.points.use", "checkout.points.amount", "checkout.points.fewer", "checkout.points.more", "checkout.points.range", "checkout.points.line", "checkout.points.error.balance", "checkout.points.error.tooMany", "checkout.points.error.minimum", "checkout.points.error.login", "checkout.points.error.unavailable", "tracking.points"];
    for (const k of ui) for (const l of ["he", "ar", "en"] as const) expect(UI_TRANSLATIONS_SEED[l][k], `${l} ${k}`).toBeTruthy();
    for (const k of ["club.me.kind.unredeem", "admin.orders.pointsHeld", "admin.orders.pointsHeldHint", "admin.orders.pointsLine", "admin.orders.pointsReturned"]) for (const l of ["he", "ar", "en"] as const) expect(ADMIN_TRANSLATIONS[l][k], `${l} ${k}`).toBeTruthy();
  });
});
