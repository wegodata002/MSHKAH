// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFakeFirestore } from "./helpers/fake-firestore";
import {
  BUILTIN_COUPONS,
  checkStoreCoupon,
  couponStatus,
  isCountedCouponUse,
  isSameCustomer,
  parseCouponInput,
  resolveStoreCoupon,
  storeCouponDiscount,
  type StoreCoupon,
} from "@/lib/coupons/store-coupons";
import { handleCreateOrder, type CreateOrderDeps } from "@/lib/orders/create-order-handler";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { localToDate } from "@/lib/fulfillment/availability";
import type { CatalogProduct, ServerOrderDraft } from "@/lib/orders/server-order";
import { chargeFromCatalogSum } from "@/lib/payments/hyp/amounts";
import { UI_TRANSLATIONS_SEED } from "@/data/ui-translations-seed";
import { ADMIN_TRANSLATIONS } from "@/data/admin-translations";

const fake = createFakeFirestore();
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fake.db }));
const store = await import("@/lib/coupons/admin/store");
const db = fake.db as unknown as Parameters<typeof store.readStoreCoupon>[0];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const NOW = new Date("2026-11-26T10:00:00Z");
const coupon = (over: Partial<StoreCoupon> = {}): StoreCoupon => ({
  code: "SUMMER15",
  name: { he: "קיץ", ar: "صيف", en: "Summer" },
  type: "percent",
  value: 15,
  expiresOn: null,
  audience: "all",
  minOrder: 0,
  limit: "unlimited",
  active: true,
  ...over,
});

describe("rules", () => {
  it("MISHKAT10 is built in until it has a record; the record always wins (disabled or deleted stays off)", () => {
    expect(resolveStoreCoupon("MISHKAT10", null)).toEqual(BUILTIN_COUPONS.MISHKAT10);
    expect(resolveStoreCoupon("MISHKAT10", { ...BUILTIN_COUPONS.MISHKAT10!, active: false })!.active).toBe(false);
    expect(resolveStoreCoupon("MISHKAT10", { ...BUILTIN_COUPONS.MISHKAT10!, deleted: true })).toBeNull();
    expect(resolveStoreCoupon("NOPE1234", null)).toBeNull();
  });

  it("status: disabled, expired after its last day (Israel time), else active", () => {
    expect(couponStatus(coupon({ active: false }), NOW)).toBe("disabled");
    expect(couponStatus(coupon({ expiresOn: "2026-11-26" }), NOW)).toBe("active");
    expect(couponStatus(coupon({ expiresOn: "2026-11-26" }), new Date("2026-11-26T22:30:00Z"))).toBe("expired"); // 00:30 in Israel
    expect(couponStatus(coupon({ expiresOn: "2026-11-25" }), NOW)).toBe("expired");
  });

  it("checks in order: exists/active, date, club members only, once per customer", () => {
    const ctx = { now: NOW, isMember: false, customerUses: 0 };
    expect(checkStoreCoupon(null, ctx)).toEqual({ ok: false, reason: "invalid" });
    expect(checkStoreCoupon(coupon({ active: false }), ctx)).toEqual({ ok: false, reason: "invalid" });
    expect(checkStoreCoupon(coupon({ expiresOn: "2026-01-01" }), ctx)).toEqual({ ok: false, reason: "expired" });
    expect(checkStoreCoupon(coupon({ audience: "members" }), ctx)).toEqual({ ok: false, reason: "members_only" });
    expect(checkStoreCoupon(coupon({ audience: "members" }), { ...ctx, isMember: true }).ok).toBe(true);
    expect(checkStoreCoupon(coupon({ limit: "once" }), { ...ctx, customerUses: 1 })).toEqual({ ok: false, reason: "already_used" });
  });

  it("discount on the products: %, ₪, minimum order, never the whole order", () => {
    expect(storeCouponDiscount(32, coupon())).toEqual({ ok: true, discount: 4.8 });
    expect(storeCouponDiscount(32, coupon({ type: "fixed", value: 20 }))).toEqual({ ok: true, discount: 20 });
    expect(storeCouponDiscount(40, coupon({ minOrder: 60 }))).toEqual({ ok: false, reason: "min_order", minOrder: 60 });
    expect(storeCouponDiscount(20, coupon({ type: "fixed", value: 20 }))).toEqual({ ok: false, reason: "too_large" });
    expect(storeCouponDiscount(15, coupon({ type: "fixed", value: 20 }))).toEqual({ ok: false, reason: "too_large" });
  });

  it("a use counts unless cancelled or an unpaid card order (and only orders the server priced)", () => {
    const base = { pricedBy: "server", status: "pending", paymentMethod: "cash", paymentStatus: "pending" };
    expect(isCountedCouponUse(base)).toBe(true);
    expect(isCountedCouponUse({ ...base, status: "cancelled" })).toBe(false);
    expect(isCountedCouponUse({ ...base, paymentMethod: "card", paymentStatus: "pending" })).toBe(false);
    expect(isCountedCouponUse({ ...base, paymentMethod: "card", paymentStatus: "paid" })).toBe(true);
    expect(isCountedCouponUse({ ...base, pricedBy: undefined })).toBe(false);
  });

  it("same customer: the club member, or the same phone however it was typed", () => {
    for (const typed of ["058-123-4567", "0581234567", "+972 58 123 4567", "972581234567"]) {
      expect(isSameCustomer({ customerPhone: "0581234567" }, { phone: typed }), typed).toBe(true);
    }
    expect(isSameCustomer({ customerPhone: "0581234568" }, { phone: "0581234567" })).toBe(false);
    expect(isSameCustomer({ loyalty: { memberId: "M1" }, customerPhone: "" }, { memberId: "M1" })).toBe(true);
  });

  it("admin form is checked", () => {
    const ok = parseCouponInput({ code: " summer15 ", name: { he: "קיץ" }, type: "percent", value: 15, expiresOn: "2027-08-31", audience: "members", minOrder: "60", limit: "once" });
    expect(ok).toMatchObject({ ok: true, coupon: { code: "SUMMER15", audience: "members", minOrder: 60, limit: "once", expiresOn: "2027-08-31", active: true } });
    expect(parseCouponInput({ code: "AB", name: { he: "x" }, value: 10 })).toEqual({ ok: false, error: "CODE" });
    expect(parseCouponInput({ code: "MK-1234-ABCD", name: { he: "x" }, value: 10 })).toEqual({ ok: false, error: "CODE" });
    expect(parseCouponInput({ code: "ABCD", name: { he: "" }, value: 10 })).toEqual({ ok: false, error: "NAME" });
    expect(parseCouponInput({ code: "ABCD", name: { he: "x" }, type: "percent", value: 95 })).toEqual({ ok: false, error: "VALUE" });
    expect(parseCouponInput({ code: "ABCD", name: { he: "x" }, type: "fixed", value: 12.345 })).toEqual({ ok: false, error: "VALUE" });
    expect(parseCouponInput({ code: "ABCD", name: { he: "x" }, value: 10, expiresOn: "31/08/2027" })).toEqual({ ok: false, error: "EXPIRES" });
  });
});

describe("admin store (in-memory database)", () => {
  beforeEach(() => fake.reset());
  const order = (id: string, extra: Record<string, unknown>) =>
    fake.put("orders", id, { couponCode: "MISHKAT10", pricedBy: "server", status: "pending", paymentMethod: "cash", paymentStatus: "pending", customerPhone: "0581234567", ...extra });

  it("MISHKAT10 shows in the list (built in) with its uses — cancelled and unpaid card orders not counted", async () => {
    order("O1", {});
    order("O2", { status: "cancelled" });
    order("O3", { paymentMethod: "card", paymentStatus: "pending" });
    order("O4", { paymentMethod: "card", paymentStatus: "paid" });
    const list = await store.listStoreCoupons(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ code: "MISHKAT10", value: 10, uses: 2, builtin: true });
    expect(await store.countCustomerUses(db, "MISHKAT10", { phone: "+972-58-123-4567" })).toBe(2);
  });

  it("disabling MISHKAT10 keeps it off; deleting leaves a marker so it never comes back from the code", async () => {
    expect((await store.updateStoreCoupon(db, { code: "MISHKAT10", patch: { active: false }, actor: "a" })).ok).toBe(true);
    expect(fake.get("storeCoupons", "MISHKAT10")).toMatchObject({ active: false });
    expect((await store.readStoreCoupon(db, "MISHKAT10"))!.active).toBe(false);
    expect(await store.deleteStoreCoupon(db, { code: "MISHKAT10", actor: "a" })).toBe(true);
    expect(fake.get("storeCoupons", "MISHKAT10")).toMatchObject({ deleted: true, active: false });
    expect(await store.readStoreCoupon(db, "MISHKAT10")).toBeNull();
    expect(await store.listStoreCoupons(db)).toEqual([]);
    // Its code can be used again for a new coupon.
    expect((await store.createStoreCoupon(db, { coupon: coupon({ code: "MISHKAT10" }), actor: "a" })).ok).toBe(true);
  });

  it("create (code must be free, MISHKAT10 included), edit, delete a regular coupon", async () => {
    expect(await store.createStoreCoupon(db, { coupon: coupon({ code: "MISHKAT10" }), actor: "a" })).toEqual({ ok: false, code: "EXISTS" });
    expect((await store.createStoreCoupon(db, { coupon: coupon(), actor: "a" })).ok).toBe(true);
    expect(await store.createStoreCoupon(db, { coupon: coupon(), actor: "a" })).toEqual({ ok: false, code: "EXISTS" });
    await store.updateStoreCoupon(db, { code: "SUMMER15", patch: { value: 20 }, actor: "a" });
    expect((await store.readStoreCoupon(db, "SUMMER15"))!.value).toBe(20);
    expect(await store.deleteStoreCoupon(db, { code: "SUMMER15", actor: "a" })).toBe(true);
    expect(fake.get("storeCoupons", "SUMMER15")).toBeUndefined();
  });

  it("the order and its priced discount are saved together", async () => {
    const id = await store.saveOrderWithStoreCoupon(db, { order: { orderNumber: "MC-1" }, record: { code: "SUMMER15", type: "percent", value: 15, discount: 4.8 }, now: NOW });
    expect(fake.get("orders", id)).toEqual({ orderNumber: "MC-1" });
    expect(await store.readOrderCouponRecord(db, id)).toMatchObject({ code: "SUMMER15", discount: 4.8 });
  });
});

describe("order route: the server checks and prices", () => {
  const TUE_NOON = localToDate({ year: 2026, month: 11, day: 24 }, 12 * 60);
  const PRODUCTS = new Map<string, CatalogProduct>([["latte", { price: 16, nameHe: "לאטה", nameEn: "Latte", available: true }]]);
  const request = (couponCode?: string) => ({
    items: [{ productId: "latte", quantity: 2 }],
    customer: { name: "דנה", phone: "058-123-4567" },
    locale: "he" as const,
    payment: "counter" as const,
    fulfillment: { type: "pickup" as const },
    ...(couponCode ? { couponCode } : {}),
  });
  function deps(opts: { coupon?: StoreCoupon | null; member?: { id: string; status: string } | null; uses?: number } = {}) {
    const saved: ServerOrderDraft[] = [];
    const records: Array<{ discount: number; code: string }> = [];
    const found: string[] = [];
    const usesAsked: Array<{ memberId: string | null; phone: string | null }> = [];
    const d: CreateOrderDeps = {
      now: () => TUE_NOON,
      loadProducts: async (ids) => new Map(ids.map((id) => [id, PRODUCTS.get(id)])),
      loadModifierConfigs: async () => new Map(),
      loadContext: async () => ({ fulfillment: DEFAULT_FULFILLMENT, openingHours: DEFAULT_OPENING_HOURS }),
      rateLimit: async () => true,
      saveOrder: async (draft) => {
        saved.push(draft);
        return "order-1";
      },
      findClubMember: async () => opts.member ?? null,
      findStoreCoupon: async (code) => {
        found.push(code);
        return opts.coupon === undefined ? resolveStoreCoupon(code, null) : opts.coupon;
      },
      countStoreCouponUses: async (_code, who) => {
        usesAsked.push(who);
        return opts.uses ?? 0;
      },
      saveOrderWithStoreCoupon: async (draft, record) => {
        saved.push(draft);
        records.push(record);
        return "order-2";
      },
      checkClubCoupon: async () => ({ ok: true, percent: 10, heldBy: null }),
      saveOrderWithCoupon: async (draft) => {
        saved.push(draft);
        return "order-3";
      },
    };
    return { d, saved, records, found, usesAsked };
  }

  it("MISHKAT10 works exactly as before: 10% of the products, and the discount is saved for the card charge", async () => {
    const { d, saved, records } = deps();
    const res = await handleCreateOrder(request("mishkat10"), "", d);
    expect(res.status).toBe(200);
    expect(saved[0]).toMatchObject({ subtotal: 32, discount: 3.2, couponCode: "MISHKAT10", total: 28.8 });
    expect(records).toEqual([{ code: "MISHKAT10", type: "percent", value: 10, discount: 3.2 }]);
  });

  it("refusals: disabled, members only (club cookie), once per customer (phone normalized), minimum, too large", async () => {
    const refused = async (o: Parameters<typeof deps>[0]) => (await handleCreateOrder(request("SUMMER15"), "", deps(o).d)).body;
    expect(await refused({ coupon: coupon({ active: false }) })).toMatchObject({ code: "COUPON_INVALID", reason: "invalid" });
    expect(await refused({ coupon: coupon({ audience: "members" }) })).toMatchObject({ reason: "members_only" });
    expect(await refused({ coupon: coupon({ audience: "members" }), member: { id: "M1", status: "suspended" } })).toMatchObject({ reason: "members_only" });
    expect(await refused({ coupon: coupon({ limit: "once" }), uses: 1 })).toMatchObject({ reason: "already_used" });
    expect(await refused({ coupon: coupon({ minOrder: 50 }) })).toMatchObject({ reason: "min_order", minOrder: 50 });
    expect(await refused({ coupon: coupon({ type: "fixed", value: 40 }) })).toMatchObject({ reason: "too_large" });
    expect(await refused({ coupon: null })).toMatchObject({ reason: "invalid" });

    const once = deps({ coupon: coupon({ limit: "once" }), member: { id: "M1", status: "active" } });
    await handleCreateOrder(request("SUMMER15"), "", once.d);
    expect(once.usesAsked).toEqual([{ memberId: "M1", phone: "0581234567" }]);
  });

  it("members-only for a signed-in member; ₪ coupon", async () => {
    const ok = deps({ coupon: coupon({ audience: "members", type: "fixed", value: 10 }), member: { id: "M1", status: "active" } });
    expect((await handleCreateOrder(request("SUMMER15"), "", ok.d)).status).toBe(200);
    expect(ok.saved[0]).toMatchObject({ discount: 10, total: 22, couponCode: "SUMMER15" });
    expect(ok.records[0]).toMatchObject({ discount: 10, type: "fixed" });
  });

  it("one coupon per order: a personal club code goes its own way and is never read as a store coupon", async () => {
    const p = deps({ member: { id: "M1", status: "active" } });
    const res = await handleCreateOrder(request("MK-ABCD-2345"), "", p.d);
    expect(res.status).toBe(200);
    expect(p.found).toEqual([]);
    expect(p.records).toEqual([]);
    expect(p.saved[0]).toMatchObject({ discount: 3.2, couponCode: "MK-ABCD-2345" });
  });

  it("no code: no coupon looked up, no discount", async () => {
    const n = deps();
    await handleCreateOrder(request(), "", n.d);
    expect(n.found).toEqual([]);
    expect(n.saved[0]).toMatchObject({ discount: 0 });
  });
});

describe("card charge", () => {
  it("uses the discount saved with the order; MISHKAT10 and personal codes as before", () => {
    // Saved amount (store coupon).
    expect(chargeFromCatalogSum(32, { couponCode: "SUMMER15" }, undefined, { discount: 4.8 })).toMatchObject({ amount: 27.2, discount: 4.8, subtotal: 32 });
    expect(chargeFromCatalogSum(32, { couponCode: "SUMMER15", delivery: 15 }, undefined, { discount: 10 })).toMatchObject({ amount: 37, discount: 10, subtotal: 32 });
    // Never more than the products.
    expect(chargeFromCatalogSum(32, { couponCode: "X" }, undefined, { discount: 99 }).discount).toBe(32);
    // An order priced before the record existed: MISHKAT10 as it works now.
    expect(chargeFromCatalogSum(32, { couponCode: "MISHKAT10" }, undefined, { rate: 0.1 })).toMatchObject({ amount: 28.8, discount: 3.2, subtotal: 32 });
    expect(chargeFromCatalogSum(32, { couponCode: "MISHKAT10" }, undefined, { rate: 0 }).discount).toBe(0);
    // Unchanged calls (no store argument): exactly as before.
    expect(chargeFromCatalogSum(32, { couponCode: "MISHKAT10" })).toMatchObject({ amount: 28.8, discount: 3.2, subtotal: 32 });
    expect(chargeFromCatalogSum(32, { couponCode: "MK-ABCD-2345" }, 0.1)).toMatchObject({ amount: 28.8, discount: 3.2, subtotal: 32 });
  });

  it("the charge reads the saved record, never order.discount", () => {
    const process = read("src/lib/payments/hyp/process.ts");
    expect(process).toContain("await readOrderCouponRecord(db, orderId)");
    expect(process).toContain("record && record.code === code");
    // order.discount is only compared afterwards (to sync the stored totals), never used for the charge.
    expect(process).not.toMatch(/Number\(order\.discount|discount:\s*order\.discount|store = \{ discount: order/);
    expect(process).toContain("store = { discount: Number(record.discount) || 0 }");
  });
});

describe("routes and texts", () => {
  it("check route: club members by the signed cookie only; admin route: admin only", () => {
    const check = read("src/app/api/coupons/check/route.ts");
    expect(check).toContain("request.cookies.get(CLUB_COOKIE_NAME)");
    expect(check).toContain('isMember: member?.status === "active"');
    expect(check).not.toMatch(/body\?\.(member|memberId|isMember)/);
    expect(check).toContain("consumeRateLimit");
    expect(read("src/app/api/admin/coupons/route.ts")).toContain("requireAdminOnly(request)");
    expect(read("firestore.rules")).not.toMatch(/storeCoupons|orderCoupons/);
    expect(read("src/features/admin/admin-nav-config.ts")).toContain('{ segment: "coupons", labelKey: "admin.coupons.title", icon: TicketPercent, adminOnly: true }');
  });

  it("customer messages and admin texts in three languages", () => {
    for (const key of ["cart.couponMembersOnly", "cart.couponAlreadyUsed", "cart.couponMinOrder"]) {
      for (const l of ["he", "ar", "en"] as const) expect(UI_TRANSLATIONS_SEED[l][key], `${l} ${key}`).toBeTruthy();
    }
    expect(UI_TRANSLATIONS_SEED.he["cart.couponMinOrder"]).toContain("{min}");
    const keys = (l: "he" | "ar" | "en") => Object.keys(ADMIN_TRANSLATIONS[l]).filter((k) => k.startsWith("admin.coupons.")).sort();
    expect(keys("he").length).toBeGreaterThan(40);
    expect(keys("ar")).toEqual(keys("he"));
    expect(keys("en")).toEqual(keys("he"));
  });
});
