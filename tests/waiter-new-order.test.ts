// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { handleWaiterOrder, WAITER_GRACE_MINUTES, WAITER_ORDER_LIMIT, type WaiterOrderDeps } from "@/lib/waiter/new-order";
import { buildServerOrder, type CatalogProduct, type CreateOrderRequest, type ServerOrderDraft } from "@/lib/orders/server-order";
import { dineInAvailability, localToDate } from "@/lib/fulfillment/availability";
import { DEFAULT_FULFILLMENT, normalizeFulfillmentSettings } from "@/lib/fulfillment/settings";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { buildProductBuilderConfig } from "@/lib/product-builder/engine";
import { toWaiterOrder } from "@/lib/waiter/tables";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const DINE_IN = normalizeFulfillmentSettings({
  ...DEFAULT_FULFILLMENT,
  dineIn: { enabled: true, tables: [{ id: "inside-4", area: "inside", number: 4 }, { id: "outside-2", area: "outside", number: 2 }] },
});
const PRODUCTS = new Map<string, CatalogProduct | undefined>([
  ["latte", { price: 16, nameHe: "לאטה", nameEn: "Latte", available: true }],
  ["crepe", { price: 38, nameHe: "קרפ", nameEn: "Crepe", available: true }],
  ["off", { price: 20, nameHe: "מאפה", nameEn: "Pastry", available: false }],
]);
const LATTE_CONFIG = buildProductBuilderConfig({
  productId: "latte",
  groups: [{ id: "milk", name_he: "חלב", name_ar: "حليب", name_en: "Milk", selectionType: "single", requirement: "optional", minSelections: 0, maxSelections: 1, displayType: "buttons", sortOrder: 1, active: true, archived: false, createdAt: "", updatedAt: "" }],
  options: [{ id: "oat", groupId: "milk", name_he: "שיבולת שועל", name_ar: "شوفان", name_en: "Oat", priceDelta: 3, cost: 0, sortOrder: 1, active: true, archived: false, createdAt: "", updatedAt: "" }],
  productGroups: [{ id: "l-m", productId: "latte", groupId: "milk", sortOrder: 1, active: true }],
  productOptions: [],
  rules: [],
  suggestions: [],
  inventory: [],
});

const TUESDAY_NOON = localToDate({ year: 2026, month: 11, day: 24 }, 12 * 60);
/** Closing time on that Tuesday, from the opening hours themselves. */
const CLOSING = (() => {
  const a = dineInAvailability(DINE_IN, DEFAULT_OPENING_HOURS, TUESDAY_NOON);
  if (!a.available) throw new Error("expected open at noon");
  return a.until;
})();
const minutesAfterClosing = (m: number) => new Date(CLOSING.getTime() + m * 60_000);

function deps(over: Partial<WaiterOrderDeps> & { now?: () => Date } = {}) {
  const saved: ServerOrderDraft[] = [];
  const after: string[] = [];
  const calls: string[] = [];
  const d: WaiterOrderDeps = {
    now: () => TUESDAY_NOON,
    rateLimit: async () => true,
    loadProducts: async (ids) => {
      calls.push("products");
      return new Map(ids.map((id) => [id, PRODUCTS.get(id)]));
    },
    loadContext: async () => ({ fulfillment: DINE_IN, openingHours: DEFAULT_OPENING_HOURS }),
    loadModifierConfigs: async () => new Map([["latte", LATTE_CONFIG]]),
    saveOrder: async (draft) => {
      saved.push(draft);
      return "NewOrder00001";
    },
    afterSave: async (id) => {
      after.push(id);
    },
    ...over,
  };
  return { d, saved, after, calls };
}

const body = (over: Record<string, unknown> = {}) => ({
  tableId: "inside-4",
  customerName: " דנה ",
  locale: "he",
  items: [
    { productId: "latte", quantity: 2, modifiers: [{ groupId: "milk", optionId: "oat", quantity: 1 }], notes: "חם" },
    { productId: "crepe", quantity: 1 },
  ],
  ...over,
});

describe("new order from the waiter", () => {
  it("goes through the server checks, priced from the catalog, paid at the end, with who entered it", async () => {
    const { d, saved, after } = deps();
    const result = await handleWaiterOrder(body({ notes: "ליד החלון" }), "רנא · טאבלט בר", d);
    expect(result).toEqual({ status: 200, body: { ok: true, id: "NewOrder00001", orderNumber: saved[0]!.orderNumber, total: 19 * 2 + 38 } });
    expect(saved[0]).toMatchObject({
      orderType: "dine_in",
      tableId: "inside-4",
      tableArea: "inside",
      tableNumber: 4,
      serviceDate: "2026-11-24",
      paymentCollection: "table",
      paymentMethod: "cash",
      paymentStatus: "pending",
      status: "pending",
      customerName: "דנה",
      customerPhone: "",
      notes: "ליד החלון",
      pricedBy: "server",
      createdBy: "רנא · טאבלט בר",
      source: "waiter",
    });
    expect(saved[0]!.items[0]).toMatchObject({ productName: "לאטה", price: 19, basePrice: 16, notes: "חם" });
    expect(saved[0]!.items[0]!.modifiers).toEqual([{ groupId: "milk", groupName: "חלב", optionId: "oat", optionName: "שיבולת שועל", priceDelta: 3, quantity: 1 }]);
    expect(saved[0]).not.toHaveProperty("couponCode");
    expect(saved[0]).not.toHaveProperty("loyalty");
    // Printed and emailed after saving.
    expect(after).toEqual(["NewOrder00001"]);
  });

  it("prices sent by the browser are not even accepted as input", async () => {
    const { d } = deps();
    const withPrice = body({ items: [{ productId: "latte", quantity: 1, modifiers: [{ groupId: "milk", optionId: "oat", quantity: 1, priceDelta: -19 }] }] });
    const result = await handleWaiterOrder(withPrice, "רנא", d);
    // Unknown keys are dropped by the schema: the add-on is priced +3 from the catalog.
    expect(result.status === 200 && result.body.total).toBe(19);
  });

  it("an unavailable product is blocked; an add-on not on the product is refused", async () => {
    expect(await handleWaiterOrder(body({ items: [{ productId: "off", quantity: 1 }] }), "רנא", deps().d)).toEqual({
      status: 409,
      body: { ok: false, code: "PRODUCT_UNAVAILABLE", productNames: ["מאפה"] },
    });
    expect(
      await handleWaiterOrder(body({ items: [{ productId: "crepe", quantity: 1, modifiers: [{ groupId: "milk", optionId: "oat", quantity: 1 }] }] }), "רנא", deps().d)
    ).toEqual({ status: 409, body: { ok: false, code: "OPTIONS_UNAVAILABLE", productNames: ["קרפ"] } });
  });

  it("unknown table, table ordering off: refused", async () => {
    expect(await handleWaiterOrder(body({ tableId: "inside-9" }), "רנא", deps().d)).toEqual({ status: 409, body: { ok: false, code: "UNKNOWN_TABLE" } });
    const off = deps({ loadContext: async () => ({ fulfillment: { ...DINE_IN, dineIn: { ...DINE_IN.dineIn, enabled: false } }, openingHours: DEFAULT_OPENING_HOURS }) });
    expect(await handleWaiterOrder(body(), "רנא", off.d)).toMatchObject({ status: 409, body: { code: "DINE_IN_UNAVAILABLE", reason: "disabled" } });
  });

  it(`up to ${WAITER_GRACE_MINUTES} minutes after closing: the waiter may, a guest may not`, async () => {
    expect(WAITER_GRACE_MINUTES).toBe(30);
    const at = (m: number) => deps({ now: () => minutesAfterClosing(m) }).d;
    expect((await handleWaiterOrder(body(), "רנא", at(1))).status).toBe(200);
    expect((await handleWaiterOrder(body(), "רנא", at(29))).status).toBe(200);
    expect(await handleWaiterOrder(body(), "רנא", at(31))).toMatchObject({ status: 409, body: { code: "DINE_IN_UNAVAILABLE", reason: "closed" } });

    // A guest's own table order at the same time: closed.
    const guest = buildServerOrder(
      { items: [{ productId: "latte", quantity: 1 }], customer: { name: "x", phone: "" }, payment: "table", fulfillment: { type: "dine_in", tableId: "inside-4" } } as CreateOrderRequest,
      { products: PRODUCTS, modifierConfigs: new Map(), fulfillment: DINE_IN, openingHours: DEFAULT_OPENING_HOURS, now: minutesAfterClosing(1), orderNumber: "MC-2026-GUEST001" }
    );
    expect(guest).toMatchObject({ ok: false, error: { code: "DINE_IN_UNAVAILABLE", reason: "closed" } });
  });

  it("closed all day (not right after closing): refused even for a waiter", async () => {
    const morning = localToDate({ year: 2026, month: 11, day: 24 }, 3 * 60);
    expect(await handleWaiterOrder(body(), "רנא", deps({ now: () => morning }).d)).toMatchObject({ status: 409, body: { code: "DINE_IN_UNAVAILABLE" } });
  });

  it("name required; phone optional, but a given phone must be real; bad input not looked up", async () => {
    const { d, calls } = deps();
    expect(await handleWaiterOrder(body({ customerName: "  " }), "רנא", d)).toEqual({ status: 400, body: { ok: false, code: "INVALID" } });
    expect(await handleWaiterOrder(body({ items: [] }), "רנא", d)).toEqual({ status: 400, body: { ok: false, code: "INVALID" } });
    expect(await handleWaiterOrder(null, "רנא", d)).toEqual({ status: 400, body: { ok: false, code: "INVALID" } });
    expect(await handleWaiterOrder(body({ phone: "123" }), "רנא", d)).toEqual({ status: 400, body: { ok: false, code: "INVALID_PHONE" } });
    expect(calls).toEqual([]);
    const ok = deps();
    await handleWaiterOrder(body({ phone: "050-123-4567" }), "רנא", ok.d);
    expect(ok.saved[0]!.customerPhone).toBe("050-123-4567");
  });

  it("limited per waiter / tablet", async () => {
    expect(WAITER_ORDER_LIMIT).toEqual({ windowSeconds: 600, limit: 60 });
    const { d, saved, calls } = deps({ rateLimit: async () => false });
    expect(await handleWaiterOrder(body(), "רנא", d)).toEqual({ status: 429, body: { ok: false, code: "RATE_LIMITED" } });
    expect(saved).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("a print or email problem never fails the saved order", async () => {
    const { d } = deps({ afterSave: async () => { throw new Error("printer"); } });
    expect((await handleWaiterOrder(body(), "רנא", d)).status).toBe(200);
  });

  it("the waiter screen shows who entered it", () => {
    expect(toWaiterOrder({ id: "A", createdBy: " רנא · טאבלט בר " }).createdBy).toBe("רנא · טאבלט בר");
    expect(toWaiterOrder({ id: "A" }).createdBy).toBeNull();
  });
});

describe("wiring", () => {
  it("the API needs a waiter (or a tablet with a chosen waiter), and prints + emails on the server", () => {
    const route = read("src/app/api/staff/tables/order/route.ts");
    expect(route).toContain("readWaiterContext(db, request)");
    expect(route).toContain("actorFor(db, ctx, body?.waiterId)");
    expect(route).toContain("CHOOSE_WAITER");
    expect(route).toContain("maybeEnqueueNewOrderPrint(orderId)");
    expect(route).toContain("notifyNewOrder(orderId)");
    expect(route).toContain("loadModifierConfigs(db, ids)");
  });

  it("the screen opens the new order from a table and sends the chosen waiter", () => {
    const screen = read("src/features/staff/waiter-tables.tsx");
    expect(screen).toContain("data-new-order-start");
    expect(screen).toContain("waiterId={chosen?.id}");
    expect(screen).toContain("disabled={needWho || !data.dineInEnabled}");
    const form = read("src/features/staff/waiter-new-order.tsx");
    expect(form).toContain('fetch("/api/staff/tables/order"');
    expect(form).not.toMatch(/priceDelta:/);
    expect(form).toContain("disabled={!p.available}");
  });

  it("who entered it shows in the admin", () => {
    expect(read("src/features/admin/orders/order-card.tsx")).toContain("data-created-by");
    expect(read("src/lib/mappers/index.ts")).toContain("createdBy: doc.createdBy || undefined");
  });

  it("every new-order key exists in three languages", () => {
    const ui = read("src/data/ui-translations-seed.ts");
    const src = read("src/features/staff/waiter-new-order.tsx") + read("src/features/staff/waiter-tables.tsx");
    const keys = [...new Set([...src.matchAll(/"(waiter\.(?:newOrder|createdBy)[a-zA-Z_.]*)"/g)].map((m) => m[1]!))];
    expect(keys.length).toBeGreaterThan(15);
    for (const key of keys) expect(ui.split(`"${key}":`).length - 1, key).toBe(3);
    expect(read("src/data/admin-translations.ts").split('"admin.orders.createdBy":').length - 1).toBe(3);
  });
});
