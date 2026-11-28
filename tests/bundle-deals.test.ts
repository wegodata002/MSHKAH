// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeFirestore } from "./helpers/fake-firestore";
import { buildServerOrder, createOrderRequestSchema, type CatalogProduct, type CreateOrderRequest } from "@/lib/orders/server-order";
import { DEFAULT_FULFILLMENT, type FulfillmentSettings } from "@/lib/fulfillment/settings";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { localToDate } from "@/lib/fulfillment/availability";
import {
  allocateBundlePrice,
  bundleSeparateRange,
  deliveryFeeAfterOffers,
  freeDeliveryFrom,
  picksFitBundle,
  readBundle,
  type Bundle,
} from "@/lib/bundles/bundle";
import { linesFromStoredItems, priceOrderLines } from "@/lib/orders/price-lines";
import { checkBundleAgainst, parseBundleInput } from "@/lib/bundles/admin";
import { chargeFromCatalogSum } from "@/lib/payments/hyp/amounts";
import { buildProductBuilderConfig } from "@/lib/product-builder/engine";

/**
 * Bundles (several products for one price) and free delivery (from a bundle or a sale). One pricing
 * function for the order route and the card charge: the amount charged is the amount on the screen,
 * with a bundle, free delivery, a coupon and club points.
 */

const WITH_DELIVERY: FulfillmentSettings = {
  ...DEFAULT_FULFILLMENT,
  delivery: { ...DEFAULT_FULFILLMENT.delivery, enabled: true, zones: [{ id: "ein-mahel", name: { he: "עין מאהל", ar: "عين ماهل", en: "Ein Mahel" }, fee: 15, minOrder: 50 }] },
};

const fake = createFakeFirestore();
const pages: Array<{ amount: string }> = [];
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fake.db }));
vi.mock("@/lib/payments/hyp/config", () => ({ isHypConfigured: () => true, HypConfigError: class extends Error {} }));
vi.mock("@/lib/payments/hyp/client", () => ({
  createHypPaymentPage: async (input: { amount: string }) => {
    pages.push(input);
    return "https://pay.example/redirect";
  },
  verifyHypRedirect: async () => ({ ok: false }),
}));
vi.mock("@/lib/payments/hyp/pipeline", () => ({ runPaidPostPaymentTasks: async () => {}, runFailedPostPaymentTasks: async () => {} }));
vi.mock("@/lib/orders/admin-modifier-config", () => ({ loadModifierConfigs: async () => new Map([["cappuccino", SIZE_CONFIG]]) }));
vi.mock("@/lib/orders/server-context", () => ({ loadFulfillmentContext: async () => ({ fulfillment: WITH_DELIVERY, openingHours: DEFAULT_OPENING_HOURS }) }));

const { createHypPaymentAttempt, BUNDLE_CHARGE_GRACE_MS } = await import("@/lib/payments/hyp/process");

const NOON = localToDate({ year: 2026, month: 11, day: 25 }, 12 * 60);
const START = "2026-11-24T05:00:00.000Z";
const END = "2026-11-30T21:59:00.000Z";

/** Large +₪3 on the cappuccino (an add-on: paid on top of the bundle). Built like the menu builds it. */
const SIZE_CONFIG = buildProductBuilderConfig({
  productId: "cappuccino",
  groups: [{ id: "size", name_he: "גודל", name_ar: "الحجم", name_en: "Size", selectionType: "single", requirement: "optional", minSelections: 0, maxSelections: 1, displayType: "buttons", sortOrder: 1, active: true, archived: false, createdAt: "", updatedAt: "" }],
  options: [{ id: "large", groupId: "size", name_he: "גדול", name_ar: "كبير", name_en: "Large", priceDelta: 3, cost: 0, sortOrder: 1, active: true, archived: false, createdAt: "", updatedAt: "" }],
  productGroups: [{ id: "cappuccino-size", productId: "cappuccino", groupId: "size", sortOrder: 1, active: true }],
  productOptions: [],
  rules: [],
  suggestions: [],
  inventory: [],
});

const CATALOG: Record<string, CatalogProduct> = {
  espresso: { price: 10, nameHe: "אספרסו", available: true, categoryId: "coffee" },
  cappuccino: { price: 14, nameHe: "קפוצ'ינו", available: true, categoryId: "coffee" },
  latte: { price: 16, nameHe: "לאטה", available: true, categoryId: "coffee" },
  croissant: { price: 12, nameHe: "קרואסון", available: true, categoryId: "pastry" },
  choco: { price: 14, nameHe: "מאפה שוקולד", available: true, categoryId: "pastry" },
  cake: { price: 30, nameHe: "עוגה", available: true, categoryId: "desserts" },
  tea: { price: 12, nameHe: "תה", available: true, categoryId: "tea" },
};

/** "2 coffees + a pastry for ₪30", free delivery. */
const MORNING_DOC = {
  name: { he: "חבילת בוקר", ar: "باقة الصباح", en: "Morning bundle" },
  description: { he: "2 קפה + מאפה", ar: "", en: "" },
  price: 30,
  startsAt: START,
  endsAt: END,
  slots: [
    { id: "coffee", kind: "choice", productIds: ["espresso", "cappuccino", "latte"], choose: 2 },
    { id: "pastry", kind: "category", categoryId: "pastry", choose: 1 },
  ],
  freeDelivery: true,
  freeDeliveryMin: 0,
  couponsAllowed: false,
};
const MORNING = readBundle("Morning01", MORNING_DOC)!;

const products = () => new Map(Object.entries(CATALOG));
const bundles = (...list: Bundle[]) => new Map(list.map((b) => [b.id, b]));

const morningPicks = [
  { slotId: "coffee", productId: "cappuccino", modifiers: [{ groupId: "size", optionId: "large", quantity: 1 }] },
  { slotId: "coffee", productId: "latte" },
  { slotId: "pastry", productId: "croissant" },
];

function request(extra: Partial<CreateOrderRequest>): CreateOrderRequest {
  const parsed = createOrderRequestSchema.safeParse({
    items: [],
    customer: { name: "דנה", phone: "0501234567" },
    locale: "he",
    payment: "online",
    fulfillment: { type: "pickup" },
    ...extra,
  });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
  return parsed.data;
}

function build(req: CreateOrderRequest, opts: { storeCoupon?: { type: "percent" | "fixed"; value: number; minOrder: number } | null; personalCouponRate?: number; list?: Bundle[] } = {}) {
  return buildServerOrder(req, {
    products: products(),
    modifierConfigs: new Map([["cappuccino", SIZE_CONFIG]]),
    bundles: bundles(...(opts.list ?? [MORNING])),
    fulfillment: WITH_DELIVERY,
    openingHours: DEFAULT_OPENING_HOURS,
    now: NOON,
    orderNumber: "MC-2026-BNDL0001",
    storeCoupon: opts.storeCoupon === undefined ? null : opts.storeCoupon,
    ...(opts.personalCouponRate !== undefined ? { personalCouponRate: opts.personalCouponRate } : {}),
  });
}

describe("bundle model (pure)", () => {
  it("splits the bundle price over its products in agorot, adding up exactly", () => {
    expect(allocateBundlePrice(30, [14, 16, 12])).toEqual([10, 11.43, 8.57]);
    expect(allocateBundlePrice(10, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBeCloseTo(10, 10);
    expect(allocateBundlePrice(9, [0, 0, 0])).toEqual([3, 3, 3]);
  });

  it("the picks must fill every part: right count, allowed product, right category", () => {
    const p = products();
    expect(picksFitBundle(MORNING, morningPicks, p)).toBe(true);
    expect(picksFitBundle(MORNING, morningPicks.slice(1), p)).toBe(false); // one coffee short
    expect(picksFitBundle(MORNING, [...morningPicks, { slotId: "pastry", productId: "choco" }], p)).toBe(false); // one pastry too many
    expect(picksFitBundle(MORNING, [morningPicks[0]!, morningPicks[1]!, { slotId: "pastry", productId: "cake" }], p)).toBe(false); // not a pastry
    expect(picksFitBundle(MORNING, [morningPicks[0]!, { slotId: "coffee", productId: "tea" }, morningPicks[2]!], p)).toBe(false); // not on the list
    expect(picksFitBundle(MORNING, [morningPicks[0]!, morningPicks[0]!, morningPicks[2]!], p)).toBe(true); // 2 × cappuccino is fine
  });

  it("the card: cheapest and dearest combination now", () => {
    const list = Object.entries(CATALOG).map(([id, c]) => ({ id, categoryId: c.categoryId, priceNow: Number(c.price), orderable: true }));
    expect(bundleSeparateRange(MORNING, list)).toEqual({ min: 32, max: 46 }); // 10+10+12 … 16+16+14
    expect(bundleSeparateRange(MORNING, list.map((p) => (p.categoryId === "pastry" ? { ...p, orderable: false } : p)))).toBeNull();
  });

  it("free delivery: the easier offer counts; the fee is 0 from its minimum", () => {
    expect(freeDeliveryFrom([])).toBeNull();
    expect(freeDeliveryFrom([{ min: 80 }, { min: 60 }])).toBe(60);
    expect(deliveryFeeAfterOffers(15, 59, 60)).toEqual({ fee: 15, free: false });
    expect(deliveryFeeAfterOffers(15, 60, 60)).toEqual({ fee: 0, free: true });
    expect(deliveryFeeAfterOffers(15, 100, null)).toEqual({ fee: 15, free: false });
  });

  it("a malformed bundle is never read as a price", () => {
    expect(readBundle("x", { ...MORNING_DOC, price: -1 })).toBeNull();
    expect(readBundle("x", { ...MORNING_DOC, slots: [] })).toBeNull();
    expect(readBundle("x", { ...MORNING_DOC, slots: Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, kind: "fixed", productId: "tea", quantity: 1 })) })).toBeNull();
    expect(readBundle("x", { ...MORNING_DOC, endsAt: START })).toBeNull();
  });
});

describe("admin: saving a bundle", () => {
  const input = () => {
    const parsed = parseBundleInput({ ...MORNING_DOC });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    return parsed.input;
  };
  const docs = Object.entries(CATALOG).map(([id, c]) => ({ id, exists: true, ...c }));

  it("checks name, price, dates, parts (up to 6) and the free-delivery minimum", () => {
    expect(parseBundleInput({ ...MORNING_DOC, name: { he: "" } })).toEqual({ ok: false, error: { code: "NAME" } });
    expect(parseBundleInput({ ...MORNING_DOC, price: 0 })).toEqual({ ok: false, error: { code: "PRICE" } });
    expect(parseBundleInput({ ...MORNING_DOC, endsAt: START })).toEqual({ ok: false, error: { code: "DATES" } });
    expect(parseBundleInput({ ...MORNING_DOC, slots: [] })).toEqual({ ok: false, error: { code: "NO_SLOTS" } });
    const seven = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, kind: "fixed", productId: "tea", quantity: 1 }));
    expect(parseBundleInput({ ...MORNING_DOC, slots: seven })).toEqual({ ok: false, error: { code: "TOO_MANY_SLOTS", max: 6 } });
    expect(parseBundleInput({ ...MORNING_DOC, slots: [{ id: "a", kind: "choice", productIds: [], choose: 1 }] })).toEqual({ ok: false, error: { code: "SLOT", index: 0 } });
    expect(parseBundleInput({ ...MORNING_DOC, freeDeliveryMin: -5 })).toEqual({ ok: false, error: { code: "FREE_DELIVERY_MIN" } });
    // Coupons: off unless switched on.
    const { couponsAllowed: _c, ...withoutCoupons } = MORNING_DOC;
    void _c;
    expect(parseBundleInput(withoutCoupons)).toMatchObject({ ok: true, input: { couponsAllowed: false } });
  });

  it("must be cheaper than its cheapest products bought separately, every part orderable", () => {
    expect(checkBundleAgainst(input(), docs, NOON)).toBeNull();
    expect(checkBundleAgainst({ ...input(), price: 32 }, docs, NOON)).toEqual({ code: "NOT_LOWER", separately: 32 });
    expect(checkBundleAgainst(input(), docs.filter((d) => d.id !== "latte"), NOON)).toEqual({ code: "PRODUCT_NOT_FOUND", productIds: ["latte"] });
    expect(checkBundleAgainst(input(), docs.map((d) => (d.categoryId === "pastry" ? { ...d, available: false } : d)), NOON)).toEqual({ code: "SLOT_EMPTY", index: 1 });
  });
});

describe("order pricing with a bundle (server)", () => {
  it("one line per product, the bundle price split over them, add-ons on top", () => {
    const built = build(request({ bundles: [{ bundleId: "Morning01", quantity: 1, picks: morningPicks }] }));
    if (!built.ok) throw new Error(JSON.stringify(built.error));
    const { items, subtotal, total } = built.order;
    expect(items.map((i) => [i.productId, i.basePrice, i.price])).toEqual([
      ["cappuccino", 10, 13], // its share of ₪30 + Large ₪3
      ["latte", 11.43, 11.43],
      ["croissant", 8.57, 8.57],
    ]);
    expect(items.every((i) => i.bundle?.lineId === "b1" && i.bundle.price === 30 && i.bundle.regularPrice === 42 && i.bundle.name === "חבילת בוקר")).toBe(true);
    expect(subtotal).toBe(33);
    expect(total).toBe(33);
  });

  it("never more than the products bought separately", () => {
    const cheap = readBundle("Cheap001", { ...MORNING_DOC, price: 40 })!;
    const built = build(request({ bundles: [{ bundleId: "Cheap001", quantity: 1, picks: [{ slotId: "coffee", productId: "espresso" }, { slotId: "coffee", productId: "espresso" }, { slotId: "pastry", productId: "croissant" }] }] }), { list: [cheap] });
    expect(built.ok && built.order.subtotal).toBe(32); // 10 + 10 + 12 < ₪40
  });

  it("refuses a bundle that is over, deleted, or not filled", () => {
    const over = readBundle("Morning01", { ...MORNING_DOC, endsAt: "2026-11-25T09:00:00.000Z" })!;
    expect(build(request({ bundles: [{ bundleId: "Morning01", quantity: 1, picks: morningPicks }] }), { list: [over] })).toEqual({ ok: false, error: { code: "BUNDLE_UNAVAILABLE", bundleNames: ["חבילת בוקר"] } });
    expect(build(request({ bundles: [{ bundleId: "Gone0001", quantity: 1, picks: morningPicks }] }))).toMatchObject({ ok: false, error: { code: "BUNDLE_UNAVAILABLE" } });
    expect(build(request({ bundles: [{ bundleId: "Morning01", quantity: 1, picks: morningPicks.slice(0, 2) }] }))).toEqual({ ok: false, error: { code: "BUNDLE_INVALID", bundleNames: ["חבילת בוקר"] } });
  });

  it("free delivery with the bundle; the area's minimum order (₪50) still applies", () => {
    const delivery = { type: "delivery" as const, zoneId: "ein-mahel", address: "הרחוב 1" };
    const small = build(request({ payment: "online", fulfillment: delivery, bundles: [{ bundleId: "Morning01", quantity: 1, picks: morningPicks }] }));
    expect(small).toEqual({ ok: false, error: { code: "BELOW_MINIMUM", minOrder: 50 } });
    const built = build(request({ payment: "online", fulfillment: delivery, bundles: [{ bundleId: "Morning01", quantity: 2, picks: morningPicks }] }));
    if (!built.ok) throw new Error(JSON.stringify(built.error));
    expect(built.order).toMatchObject({ subtotal: 66, delivery: 0, freeDelivery: { regularFee: 15 }, total: 66 });
  });

  it("free delivery from a sale (Admin → Sales), from its minimum on the whole order", () => {
    const sale = { saleId: "SaleFree1", kind: "percent", value: 10, startsAt: START, endsAt: END, freeDelivery: true, freeDeliveryMin: 60 };
    const p = new Map(products());
    p.set("cake", { ...CATALOG.cake!, sales: [sale] });
    const delivery = { type: "delivery" as const, zoneId: "ein-mahel", address: "הרחוב 1" };
    const at = (items: CreateOrderRequest["items"]) =>
      buildServerOrder(request({ fulfillment: delivery, items }), { products: p, modifierConfigs: new Map(), fulfillment: WITH_DELIVERY, openingHours: DEFAULT_OPENING_HOURS, now: NOON, orderNumber: "MC-2026-SALE0002", storeCoupon: null });
    expect(at([{ productId: "cake", quantity: 2 }])).toMatchObject({ ok: true, order: { subtotal: 54, delivery: 15 } }); // ₪54 < ₪60
    expect(at([{ productId: "cake", quantity: 2 }, { productId: "tea", quantity: 1 }])).toMatchObject({ ok: true, order: { subtotal: 66, delivery: 0 } });
    expect(at([{ productId: "tea", quantity: 6 }])).toMatchObject({ ok: true, order: { delivery: 15 } }); // no product of the sale
  });

  it("coupons: not on a bundle unless it allows them (off by default)", () => {
    const withTea = request({ couponCode: "SAVE10", items: [{ productId: "tea", quantity: 2 }], bundles: [{ bundleId: "Morning01", quantity: 1, picks: morningPicks }] });
    const pct = { type: "percent" as const, value: 10, minOrder: 0 };
    expect(build(withTea, { storeCoupon: pct })).toMatchObject({ ok: true, order: { subtotal: 57, discount: 2.4, total: 54.6 } }); // 10% of the tea only
    const only = request({ couponCode: "SAVE10", bundles: [{ bundleId: "Morning01", quantity: 1, picks: morningPicks }] });
    expect(build(only, { storeCoupon: pct })).toEqual({ ok: false, error: { code: "COUPON_INVALID", reason: "bundles_only" } });
    const open = readBundle("Morning01", { ...MORNING_DOC, couponsAllowed: true })!;
    expect(build(only, { storeCoupon: pct, list: [open] })).toMatchObject({ ok: true, order: { discount: 3.3, total: 29.7 } });
    // The coupon's minimum is on all the products of the order.
    expect(build(withTea, { storeCoupon: { ...pct, minOrder: 50 } })).toMatchObject({ ok: true, order: { discount: 2.4 } });
    expect(build(withTea, { personalCouponRate: 0.1 })).toMatchObject({ ok: true, order: { discount: 2.4 } });
  });

  it("the stored lines group back into the same bundles (for the card charge)", () => {
    const built = build(request({ items: [{ productId: "tea", quantity: 1 }], bundles: [{ bundleId: "Morning01", quantity: 2, picks: morningPicks }] }));
    if (!built.ok) throw new Error("not built");
    const lines = linesFromStoredItems(built.order.items)!;
    expect(lines.items).toEqual([{ productId: "tea", quantity: 1, modifiers: [] }]);
    expect(lines.bundles).toEqual([{ bundleId: "Morning01", quantity: 2, picks: morningPicks.map((p) => ({ slotId: p.slotId, productId: p.productId, modifiers: p.modifiers ?? [] })) }]);
    const again = priceOrderLines(lines, { products: products(), modifierConfigs: new Map([["cappuccino", SIZE_CONFIG]]), bundles: bundles(MORNING), now: NOON, locale: "he" });
    expect(again.ok && again.value.subtotal).toBe(built.order.subtotal);
    // Lines that don't make sense are refused.
    expect(linesFromStoredItems([{ productId: "tea", quantity: 1, bundle: { lineId: "b1", bundleId: "Morning01" } }])).toBeNull();
  });

  it("the waiter screen takes bundles too (a table order)", async () => {
    const { handleWaiterOrder } = await import("@/lib/waiter/new-order");
    const saved: unknown[] = [];
    const withTable: FulfillmentSettings = { ...WITH_DELIVERY, dineIn: { enabled: true, tables: [{ id: "in-1", area: "inside", number: 1 }] } } as FulfillmentSettings;
    const result = await handleWaiterOrder(
      { tableId: "in-1", customerName: "שולחן 1", bundles: [{ bundleId: "Morning01", quantity: 1, picks: morningPicks }] },
      "רנא",
      {
        now: () => NOON,
        rateLimit: async () => true,
        loadProducts: async () => products(),
        loadContext: async () => ({ fulfillment: withTable, openingHours: DEFAULT_OPENING_HOURS }),
        loadModifierConfigs: async () => new Map([["cappuccino", SIZE_CONFIG]]),
        loadBundles: async () => bundles(MORNING),
        saveOrder: async (draft) => {
          saved.push(draft);
          return "WaiterOrder1";
        },
        afterSave: async () => {},
      }
    );
    expect(result).toMatchObject({ status: 200, body: { ok: true, total: 33 } });
  });
});

/* ── The card charge: the amount charged = the amount on the screen ── */

class FakeTimestamp {
  constructor(private readonly at: Date) {}
  toDate() {
    return this.at;
  }
}

function putCatalog() {
  for (const [id, c] of Object.entries(CATALOG)) fake.put("products", id, c as Record<string, unknown>);
  fake.put("bundles", "Morning01", MORNING_DOC as Record<string, unknown>);
}

async function charge(orderId: string, order: Record<string, unknown>) {
  fake.put("orders", orderId, { ...order, createdAt: new FakeTimestamp(NOON) });
  await createHypPaymentAttempt(orderId);
  const saved = (await fake.db.collection("orders").doc(orderId).get()).data()!;
  return { amount: pages.at(-1)!.amount, saved };
}

describe("card charge = screen", () => {
  beforeEach(() => {
    fake.reset();
    pages.length = 0;
    putCatalog();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOON.getTime() + 5 * 60_000)); // paying 5 minutes after ordering
  });

  it("a bundle with an add-on, delivered free", async () => {
    const built = build(request({ fulfillment: { type: "delivery", zoneId: "ein-mahel", address: "הרחוב 1" }, items: [{ productId: "tea", quantity: 2 }], bundles: [{ bundleId: "Morning01", quantity: 1, picks: morningPicks }] }));
    if (!built.ok) throw new Error(JSON.stringify(built.error));
    expect(built.order).toMatchObject({ subtotal: 57, delivery: 0, total: 57 });
    const { amount, saved } = await charge("OrderB001", built.order as unknown as Record<string, unknown>);
    expect(amount).toBe("57.00");
    expect(saved).toMatchObject({ total: 57, delivery: 0 }); // not rewritten
  });

  it("a bundle + a store coupon (saved with the order) + club points", async () => {
    const built = build(request({ couponCode: "SAVE10", items: [{ productId: "tea", quantity: 2 }], bundles: [{ bundleId: "Morning01", quantity: 1, picks: morningPicks }] }), { storeCoupon: { type: "percent", value: 10, minOrder: 0 } });
    if (!built.ok) throw new Error(JSON.stringify(built.error));
    // On the screen: ₪57 − ₪2.40 (coupon on the tea only) − ₪5 points = ₪49.60.
    const order = { ...built.order, pointsRedeemed: 50, pointsDiscount: 5, total: 49.6 };
    fake.put("orderCoupons", "OrderB002", { code: "SAVE10", type: "percent", value: 10, discount: 2.4 });
    fake.put("loyaltyPointsLedger", "redeem:OrderB002", { orderId: "OrderB002", memberId: "m1", points: -50, discountMinor: 500 });
    const { amount, saved } = await charge("OrderB002", order as unknown as Record<string, unknown>);
    expect(amount).toBe("49.60");
    expect(saved).toMatchObject({ total: 49.6, discount: 2.4, pointsDiscount: 5 });
  });

  it("a forged price on the order is ignored: the bundle is priced again from the database", async () => {
    const built = build(request({ bundles: [{ bundleId: "Morning01", quantity: 1, picks: morningPicks }] }));
    if (!built.ok) throw new Error("not built");
    const forged = { ...built.order, items: built.order.items.map((i) => ({ ...i, price: 1, basePrice: 1, bundle: { ...i.bundle!, price: 3 } })), subtotal: 3, total: 3 };
    const { amount, saved } = await charge("OrderB003", forged as unknown as Record<string, unknown>);
    expect(amount).toBe("33.00");
    expect(saved.total).toBe(33);
  });

  it("a bundle that ended while the customer was paying: still the amount ordered (within an hour)", async () => {
    const built = build(request({ bundles: [{ bundleId: "Morning01", quantity: 1, picks: morningPicks }] }));
    if (!built.ok) throw new Error("not built");
    fake.put("bundles", "Morning01", { ...MORNING_DOC, endsAt: new Date(NOON.getTime() + 60_000).toISOString() });
    const { amount } = await charge("OrderB004", built.order as unknown as Record<string, unknown>);
    expect(amount).toBe("33.00");
    // Much later than that: refused (no price is invented).
    vi.setSystemTime(new Date(NOON.getTime() + BUNDLE_CHARGE_GRACE_MS + 60_000));
    fake.put("orders", "OrderB005", { ...(built.order as unknown as Record<string, unknown>), createdAt: new FakeTimestamp(NOON) });
    await expect(createHypPaymentAttempt("OrderB005")).rejects.toMatchObject({ code: "BUNDLE_UNAVAILABLE" });
  });

  it("the charge helper takes the coupon off the part it may (bundles left out)", () => {
    expect(chargeFromCatalogSum(57, { couponCode: "MISHKAT10" }, 0.1, undefined, 0, 24)).toMatchObject({ discount: 2.4, amount: 54.6 });
    expect(chargeFromCatalogSum(57, { couponCode: "" }, undefined, { rate: 0.1 })).toMatchObject({ discount: 5.7 });
  });
});

describe("the cart shows what the server will charge", () => {
  it("bundle in the cart = the server's price (bundle + add-ons), struck = separately", async () => {
    const { priceCartBundle, cartFreeDeliveryFrom } = await import("@/lib/bundles/cart-bundle");
    const picks = [
      { slotId: "coffee", product: { id: "cappuccino", ...CATALOG.cappuccino! }, selections: [{ priceDelta: 3, quantity: 1 }] },
      { slotId: "coffee", product: { id: "latte", ...CATALOG.latte! }, selections: [] },
      { slotId: "pastry", product: { id: "croissant", ...CATALOG.croissant! }, selections: [] },
    ];
    const priced = priceCartBundle(MORNING, picks, new Map(), NOON.getTime());
    expect(priced).toEqual({ unitPrice: 33, regularUnitPrice: 45, bundlePrice: 30, extras: 3, available: true });
    const built = build(request({ bundles: [{ bundleId: "Morning01", quantity: 1, picks: morningPicks }] }));
    expect(built.ok && built.order.subtotal).toBe(priced.unitPrice);
    // Over, or a pick that no longer fits: not available.
    expect(priceCartBundle(MORNING, picks, new Map(), Date.parse(END) + 1).available).toBe(false);
    expect(priceCartBundle(undefined, picks, new Map(), NOON.getTime()).available).toBe(false);
    expect(priceCartBundle(MORNING, picks.slice(0, 2), new Map(), NOON.getTime()).available).toBe(false);
    // Free delivery: from a sale line or a bundle, the easier minimum.
    expect(cartFreeDeliveryFrom([{ sale: { freeDelivery: true, freeDeliveryMin: 80 } }, { sale: null }], [{ bundle: MORNING, available: true }])).toBe(0);
    expect(cartFreeDeliveryFrom([{ sale: { freeDelivery: true, freeDeliveryMin: 80 } }], [{ bundle: MORNING, available: false }])).toBe(80);
    expect(cartFreeDeliveryFrom([], [])).toBeNull();
  });
});
