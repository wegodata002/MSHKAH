import { describe, expect, it, vi } from "vitest";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { localToDate, deliveryFeeForZone } from "@/lib/fulfillment/availability";
import { DEFAULT_FULFILLMENT, type FulfillmentSettings } from "@/lib/fulfillment/settings";
import {
  buildServerOrder,
  generateOrderNumber,
  TEST_ORDER_NOTE,
  type CatalogProduct,
  type CreateOrderRequest,
} from "@/lib/orders/server-order";
import { handleCreateOrder, type CreateOrderDeps } from "@/lib/orders/create-order-handler";
import { chargeFromCatalogSum } from "@/lib/payments/hyp/amounts";
import { buildProductBuilderConfig } from "@/lib/product-builder/engine";

/** Pure, in-memory data — no Firebase, no network, no real clock. */

const TUESDAY_NOON = localToDate({ year: 2026, month: 11, day: 24 }, 12 * 60);
const FRIDAY_NOON = localToDate({ year: 2026, month: 11, day: 27 }, 12 * 60);
/** November 2026, Israel time: at(24, "12:00") is Tuesday noon. */
const at = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return localToDate({ year: 2026, month: 11, day }, h! * 60 + m!);
};

const PRODUCTS = new Map<string, CatalogProduct | undefined>([
  ["latte", { price: 16, nameHe: "לאטה", nameAr: "لاتيه", nameEn: "Latte", available: true, active: true }],
  ["crepe", { price: 38, nameHe: "קרפ", nameAr: "كريب", nameEn: "Crepe", available: true }],
  ["off", { price: 20, nameHe: "מאפה", nameAr: "معجنات", nameEn: "Pastry", available: false }],
  ["inactive", { price: 20, nameHe: "עוגה", nameAr: "كعكة", nameEn: "Cake", active: false }],
  ["hidden-test", { price: 2, nameHe: "בדיקה", nameEn: "Test", available: true, hidden: true, isTestProduct: true } as CatalogProduct],
]);

/** Latte add-ons as the server loads them: milk (one only): oat +3 (kitchen note), a test option −50. */
const MILK_GROUP = { id: "milk", name_he: "חלב", name_ar: "حليب", name_en: "Milk", selectionType: "single" as const, requirement: "optional" as const, minSelections: 0, maxSelections: 1, displayType: "buttons" as const, sortOrder: 1, active: true, archived: false, createdAt: "", updatedAt: "" };
const milkOption = (id: string, name: string, priceDelta: number, kitchenNote?: string) => ({ id, groupId: "milk", name_he: name, name_ar: name, name_en: name, priceDelta, cost: 0, sortOrder: 1, kitchenNote, active: true, archived: false, createdAt: "", updatedAt: "" });
const MODIFIERS = new Map([
  [
    "latte",
    buildProductBuilderConfig({
      productId: "latte",
      groups: [MILK_GROUP],
      options: [milkOption("oat", "שיבולת שועל", 3, "oat milk"), milkOption("minus", "הנחה", -50)],
      productGroups: [{ id: "latte-milk", productId: "latte", groupId: "milk", sortOrder: 1, active: true }],
      productOptions: [],
      rules: [],
      suggestions: [],
      inventory: [],
    }),
  ],
]);

/** Delivery on with the two real areas (Ein Mahel 15 / min 50, Har Yona / Nof HaGalil 25 / min 50). */
const WITH_DELIVERY: FulfillmentSettings = {
  ...DEFAULT_FULFILLMENT,
  delivery: {
    ...DEFAULT_FULFILLMENT.delivery,
    enabled: true,
    zones: [
      { id: "ein-mahel", name: { he: "עין מאהל", ar: "عين ماهل", en: "Ein Mahel" }, fee: 15, minOrder: 50 },
      { id: "har-yona", name: { he: "הר יונה / נוף הגליל", ar: "هار يونا / نوف هجليل", en: "Har Yona / Nof HaGalil" }, fee: 25, minOrder: 50 },
    ],
  },
};

function request(patch: Partial<CreateOrderRequest> = {}): CreateOrderRequest {
  return {
    items: [
      {
        productId: "latte",
        quantity: 2,
        modifiers: [
          { groupId: "milk", groupName: "חלב", optionId: "oat", optionName: "שיבולת שועל", priceDelta: 3, quantity: 1, kitchenNote: "oat milk" },
        ],
        notes: "חם מאוד",
      },
      { productId: "crepe", quantity: 1 },
    ],
    customer: { id: "cust-1", name: " דנה ", phone: "050-1234567", email: " Dana@Example.COM " },
    notes: "בלי סוכר\nטלפון: 050-1234567\nאיסוף עצמי מהעסק",
    locale: "he",
    payment: "counter",
    fulfillment: { type: "pickup" },
    ...patch,
  };
}

function build(req: CreateOrderRequest, fulfillment: FulfillmentSettings = DEFAULT_FULFILLMENT, now = TUESDAY_NOON) {
  return buildServerOrder(req, {
    products: PRODUCTS,
    modifierConfigs: MODIFIERS,
    fulfillment,
    openingHours: DEFAULT_OPENING_HOURS,
    now,
    orderNumber: "MC-2026-ABCDEFGH",
  });
}

describe("server order: same document as today's checkout", () => {
  it("pickup + cash: the fields the browser wrote, plus only pricedBy and paymentCollection", () => {
    const result = build(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // What the browser stored for this cart before PR 3 (createOrderFromCart + buildFirestoreOrder).
    expect(result.order).toEqual({
      orderNumber: "MC-2026-ABCDEFGH",
      customerId: "cust-1",
      customerName: "דנה",
      customerFullName: "דנה",
      customerPhone: "050-1234567",
      customerEmail: "dana@example.com",
      items: [
        {
          productId: "latte",
          productName: "לאטה",
          quantity: 2,
          price: 19,
          basePrice: 16,
          modifiers: [
            { groupId: "milk", groupName: "חלב", optionId: "oat", optionName: "שיבולת שועל", priceDelta: 3, quantity: 1, kitchenNote: "oat milk" },
          ],
          notes: "חם מאוד",
          kitchenNotes: ["שיבולת שועל: oat milk"],
        },
        { productId: "crepe", productName: "קרפ", quantity: 1, price: 38, basePrice: 38 },
      ],
      status: "pending",
      subtotal: 76,
      discount: 0,
      delivery: 0,
      total: 76,
      paymentMethod: "cash",
      paymentStatus: "pending",
      orderType: "pickup",
      notes: "בלי סוכר\nטלפון: 050-1234567\nאיסוף עצמי מהעסק",
      locale: "he",
      // New, optional fields:
      paymentCollection: "counter",
      pricedBy: "server",
      // No time sent (an older cached checkout): the earliest time today, noon + 15 minutes.
      pickupTime: "12:15",
    });
  });

  it("card payment keeps paymentMethod \"card\" (what HYP, the admin and reports read)", () => {
    const result = build(request({ payment: "online" }));
    expect(result.ok && result.order.paymentMethod).toBe("card");
    expect(result.ok && result.order.paymentCollection).toBe("online");
  });

  it("product names follow the order language, like today", () => {
    const ar = build(request({ locale: "ar" }));
    const en = build(request({ locale: "en" }));
    expect(ar.ok && ar.order.items.map((i) => i.productName)).toEqual(["لاتيه", "كريب"]);
    expect(en.ok && en.order.items.map((i) => i.productName)).toEqual(["Latte", "Crepe"]);
  });

  it("no customer id → guest; no email → no email field", () => {
    const result = build(request({ customer: { name: "Ali", phone: "0501234567" } }));
    expect(result.ok && result.order.customerId).toBe("guest-checkout");
    expect(result.ok && "customerEmail" in result.order).toBe(false);
  });

  it("order number keeps the MC-<year>-<8> format", () => {
    expect(generateOrderNumber(TUESDAY_NOON, () => 0.123456)).toMatch(/^MC-2026-[0-9A-Z]{8}$/);
  });
});

describe("server order: prices", () => {
  it("the price always comes from the catalog (the request has no price field)", () => {
    const tampered = request();
    (tampered.items[1] as Record<string, unknown>).price = 1;
    (tampered.items[1] as Record<string, unknown>).basePrice = 1;
    const result = build(tampered);
    expect(result.ok && result.order.items[1]).toMatchObject({ price: 38, basePrice: 38 });
  });

  it("coupon from its code; unknown codes give no discount and are not stored", () => {
    const ok = build(request({ couponCode: " mishkat10 " }));
    expect(ok.ok && ok.order).toMatchObject({ couponCode: "MISHKAT10", discount: 7.6, total: 68.4 });
    const bad = build(request({ couponCode: "FREE100" }));
    expect(bad.ok && bad.order.discount).toBe(0);
    expect(bad.ok && "couponCode" in bad.order).toBe(false);
  });

  it("the test product marks the order as a test, as before", () => {
    const result = build(request({ items: [{ productId: "hidden-test", quantity: 1 }] }));
    expect(result.ok && result.order.isTestOrder).toBe(true);
    expect(result.ok && result.order.notes.startsWith(TEST_ORDER_NOTE)).toBe(true);
  });

  it("a negative total is impossible", () => {
    const result = build(
      request({
        items: [
          { productId: "latte", quantity: 1, modifiers: [{ groupId: "milk", groupName: "g", optionId: "minus", optionName: "o", priceDelta: 0, quantity: 1 }] },
        ],
      })
    );
    expect(result).toEqual({ ok: false, error: { code: "INVALID_PRICE" } });
  });
});

describe("server order: products", () => {
  it("rejects a product that does not exist", () => {
    const result = build(request({ items: [{ productId: "gone", quantity: 1 }] }));
    expect(result).toEqual({ ok: false, error: { code: "PRODUCT_NOT_FOUND", productIds: ["gone"] } });
  });

  it("rejects products switched off in the catalog, naming them in the order language", () => {
    const he = build(request({ items: [{ productId: "latte", quantity: 1 }, { productId: "off", quantity: 1 }, { productId: "inactive", quantity: 1 }] }));
    expect(he).toEqual({ ok: false, error: { code: "PRODUCT_UNAVAILABLE", productNames: ["מאפה", "עוגה"] } });
    const ar = build(request({ locale: "ar", items: [{ productId: "off", quantity: 1 }] }));
    expect(ar).toEqual({ ok: false, error: { code: "PRODUCT_UNAVAILABLE", productNames: ["معجنات"] } });
  });

  it("a hidden (test) product is still orderable", () => {
    expect(build(request({ items: [{ productId: "hidden-test", quantity: 1 }] })).ok).toBe(true);
  });
});

describe("server order: order types and payment", () => {
  it("payment must fit the order type", () => {
    expect(build(request({ payment: "courier" }))).toEqual({ ok: false, error: { code: "PAYMENT_NOT_ALLOWED" } });
    expect(build(request({ payment: "table" }))).toEqual({ ok: false, error: { code: "PAYMENT_NOT_ALLOWED" } });
    const delivery = request({ payment: "counter", fulfillment: { type: "delivery", zoneId: "har-yona", address: "רחוב 1" } });
    expect(build(delivery, WITH_DELIVERY)).toEqual({ ok: false, error: { code: "PAYMENT_NOT_ALLOWED" } });
  });

  it("pickup is blocked when closed (Friday), with the next opening", () => {
    expect(build(request(), DEFAULT_FULFILLMENT, FRIDAY_NOON)).toEqual({
      ok: false,
      error: { code: "PICKUP_CLOSED", reason: "closed", nextAt: at(29, "07:00").toISOString() },
    });
    expect(build(request({ fulfillment: { type: "pickup", pickupTime: "12:30" } }), DEFAULT_FULFILLMENT, FRIDAY_NOON)).toMatchObject({
      ok: false,
      error: { code: "PICKUP_CLOSED" },
    });
  });

  it("pickup switched off in the settings → closed (disabled)", () => {
    const off = { ...DEFAULT_FULFILLMENT, pickup: { ...DEFAULT_FULFILLMENT.pickup, enabled: false } };
    expect(build(request(), off)).toEqual({ ok: false, error: { code: "PICKUP_CLOSED", reason: "disabled", nextAt: null } });
  });

  it("after the last pickup time of the day → closed until tomorrow 07:00", () => {
    expect(build(request(), DEFAULT_FULFILLMENT, at(24, "21:50"))).toEqual({
      ok: false,
      error: { code: "PICKUP_CLOSED", reason: "closed", nextAt: at(25, "07:00").toISOString() },
    });
  });

  it("before opening the same day: the earliest time is opening + preparation", () => {
    const result = build(request(), DEFAULT_FULFILLMENT, at(24, "06:30"));
    expect(result.ok && result.order.pickupTime).toBe("07:15");
  });

  it("a chosen pickup time on the list is stored", () => {
    const result = build(request({ fulfillment: { type: "pickup", pickupTime: "12:30" } }));
    expect(result.ok && result.order.pickupTime).toBe("12:30");
  });

  it("a time picked a minute or two earlier is still accepted (10-minute grace)", () => {
    // At 12:00 the list starts at 12:15; the customer presses the button at 12:02 (list now starts 12:30).
    const result = build(request({ fulfillment: { type: "pickup", pickupTime: "12:15" } }), DEFAULT_FULFILLMENT, at(24, "12:02"));
    expect(result.ok && result.order.pickupTime).toBe("12:15");
  });

  it("a time that passed, is off the grid, or is outside the hours → PICKUP_TIME_UNAVAILABLE", () => {
    for (const [time, now] of [["12:15", "12:16"], ["12:20", "12:00"], ["23:00", "12:00"], ["06:45", "06:30"]] as const) {
      const result = build(request({ fulfillment: { type: "pickup", pickupTime: time } }), DEFAULT_FULFILLMENT, at(24, now));
      expect(result, `${time} at ${now}`).toEqual({ ok: false, error: { code: "PICKUP_TIME_UNAVAILABLE" } });
    }
  });

  it("delivery is rejected while switched off (as it is live now)", () => {
    const result = build(request({ payment: "online", fulfillment: { type: "delivery", zoneId: "har-yona", address: "x" } }));
    expect(result).toEqual({ ok: false, error: { code: "DELIVERY_UNAVAILABLE", reason: "disabled", nextAt: null } });
  });

  it("delivery outside delivery hours → closed, with the next opening", () => {
    const result = build(
      request({ payment: "courier", fulfillment: { type: "delivery", zoneId: "har-yona", address: "x" } }),
      WITH_DELIVERY,
      FRIDAY_NOON
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "DELIVERY_UNAVAILABLE", reason: "closed" });
  });

  it("Har Yona / Nof HaGalil: fee 25, minimum 50", () => {
    const small = request({ items: [{ productId: "latte", quantity: 1 }], payment: "courier", fulfillment: { type: "delivery", zoneId: "har-yona", address: "x" } });
    expect(build(small, WITH_DELIVERY)).toEqual({ ok: false, error: { code: "BELOW_MINIMUM", minOrder: 50 } });
    const result = build(
      request({
        items: [{ productId: "latte", quantity: 2 }, { productId: "crepe", quantity: 1 }],
        payment: "courier",
        fulfillment: { type: "delivery", zoneId: "har-yona", address: " רחוב הזית 4 " },
      }),
      WITH_DELIVERY
    );
    expect(result.ok && result.order).toMatchObject({
      orderType: "delivery",
      deliveryAddress: "רחוב הזית 4",
      deliveryZoneId: "har-yona",
      deliveryZoneName: "הר יונה / נוף הגליל",
      subtotal: 70,
      delivery: 25,
      total: 95,
      paymentMethod: "cash",
      paymentCollection: "courier",
    });
  });

  it("Ein Mahel: fee 15, minimum 50 on the products before the coupon", () => {
    const small = request({ items: [{ productId: "latte", quantity: 3 }], payment: "online", fulfillment: { type: "delivery", zoneId: "ein-mahel", address: "x" } });
    expect(build(small, WITH_DELIVERY)).toEqual({ ok: false, error: { code: "BELOW_MINIMUM", minOrder: 50 } });
    const enough = request({ items: [{ productId: "latte", quantity: 2 }, { productId: "crepe", quantity: 1 }], couponCode: "MISHKAT10", payment: "online", fulfillment: { type: "delivery", zoneId: "ein-mahel", address: "x" } });
    const result = build(enough, WITH_DELIVERY);
    expect(result.ok && result.order).toMatchObject({ subtotal: 70, discount: 7, delivery: 15, total: 78, paymentMethod: "card" });
  });

  it("an area that is not in the settings is rejected", () => {
    const result = build(request({ payment: "online", fulfillment: { type: "delivery", zoneId: "tel-aviv", address: "x" } }), WITH_DELIVERY);
    expect(result).toEqual({ ok: false, error: { code: "UNKNOWN_ZONE" } });
  });

  it("dine-in while \"Dine-in active\" is off is refused (details: tests/dine-in.test.ts)", () => {
    const result = build(request({ payment: "table", fulfillment: { type: "dine_in", tableId: "inside-4" } }));
    expect(result).toEqual({ ok: false, error: { code: "DINE_IN_UNAVAILABLE", reason: "disabled", nextAt: null } });
  });
});

describe("card charge: delivery fee from the settings", () => {
  it("the area's fee, or null for an unknown area", () => {
    expect(deliveryFeeForZone(WITH_DELIVERY, "ein-mahel")).toBe(15);
    expect(deliveryFeeForZone(WITH_DELIVERY, "har-yona")).toBe(25);
    expect(deliveryFeeForZone(WITH_DELIVERY, "nope")).toBeNull();
  });

  it("the charge adds the fee it is given, not one stored on the order", () => {
    // process.ts passes { ...order, delivery: <fee from settings> }.
    expect(chargeFromCatalogSum(70, { couponCode: "MISHKAT10", delivery: 15 })).toEqual({ amount: 78, discount: 7, subtotal: 70 });
    expect(chargeFromCatalogSum(16, { delivery: 0 })).toEqual({ amount: 16, discount: 0, subtotal: 16 });
  });
});

describe("POST /api/orders/create handler (in-memory stand-ins)", () => {
  function deps(patch: Partial<CreateOrderDeps> = {}) {
    const saved: unknown[] = [];
    const d: CreateOrderDeps = {
      now: () => TUESDAY_NOON,
      loadProducts: async (ids) => new Map(ids.map((id) => [id, PRODUCTS.get(id)])),
      loadModifierConfigs: async () => MODIFIERS,
      loadContext: async () => ({ fulfillment: DEFAULT_FULFILLMENT, openingHours: DEFAULT_OPENING_HOURS }),
      rateLimit: async () => true,
      saveOrder: async (draft) => {
        saved.push(draft);
        return "order-id-1";
      },
      ...patch,
    };
    return { d, saved };
  }

  it("saves the order and returns its id, number and total", async () => {
    const { d, saved } = deps();
    const res = await handleCreateOrder(request(), "1.2.3.4", d);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, id: "order-id-1", total: 76 });
    expect((res.body as { orderNumber: string }).orderNumber).toMatch(/^MC-2026-/);
    expect(saved).toHaveLength(1);
  });

  it("bad body or short phone → 400, nothing saved", async () => {
    const { d, saved } = deps();
    expect((await handleCreateOrder({ items: [] }, "", d)).status).toBe(400);
    expect((await handleCreateOrder(null, "", d)).status).toBe(400);
    expect((await handleCreateOrder(request({ customer: { name: "a", phone: "123" } }), "", d)).status).toBe(400);
    expect(saved).toHaveLength(0);
  });

  it("rate limit by phone and by IP → 429", async () => {
    const byPhone = deps({ rateLimit: async (key) => !key.includes("|phone|") });
    expect((await handleCreateOrder(request(), "1.2.3.4", byPhone.d)).status).toBe(429);
    const byIp = deps({ rateLimit: async (key) => !key.includes("|ip|") });
    expect((await handleCreateOrder(request(), "1.2.3.4", byIp.d)).status).toBe(429);
    expect(byPhone.saved).toHaveLength(0);
  });

  it("a product switched off → 409 with its name, nothing saved", async () => {
    const { d, saved } = deps();
    const res = await handleCreateOrder(request({ items: [{ productId: "off", quantity: 1 }] }), "", d);
    expect(res).toEqual({ status: 409, body: { ok: false, code: "PRODUCT_UNAVAILABLE", productNames: ["מאפה"] } });
    expect(saved).toHaveLength(0);
  });

  it("database failures → 500 ORDER_SAVE_FAILED", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const saveFails = deps({ saveOrder: async () => { throw new Error("write failed"); } });
    expect(await handleCreateOrder(request(), "", saveFails.d)).toEqual({ status: 500, body: { ok: false, code: "ORDER_SAVE_FAILED" } });
    const readFails = deps({ loadContext: async () => { throw new Error("read failed"); } });
    expect((await handleCreateOrder(request(), "", readFails.d)).status).toBe(500);
  });
});
