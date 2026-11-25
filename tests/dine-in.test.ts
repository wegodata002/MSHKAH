// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { dineInAvailability, findTable, localToDate } from "@/lib/fulfillment/availability";
import {
  DEFAULT_FULFILLMENT,
  makeTable,
  normalizeFulfillmentSettings,
  tableDisplayName,
  tablesByArea,
  type FulfillmentSettings,
} from "@/lib/fulfillment/settings";
import { buildServerOrder, type CatalogProduct, type CreateOrderRequest } from "@/lib/orders/server-order";
import { handleCreateOrder, type CreateOrderDeps } from "@/lib/orders/create-order-handler";
import { buildReceiptModelFromOrder } from "@/lib/print-jobs/receipt-model";
import { renderNewOrderEmail } from "@/lib/email/templates";
import { kitchenTicketHtml } from "@/lib/orders/kitchen-ticket";
import { buildTrackingView, trackingHeadline } from "@/lib/orders/tracking-view";
import { resolveOrderType } from "@/features/checkout/checkout-fulfillment";
import { parseScannedTable, SCANNED_TABLE_TTL_MS } from "@/lib/dine-in/scanned-table";
import { tableQrUrl } from "@/lib/admin-qr-links";
import { isCustomerOnlyPath, isOrderingPath } from "@/lib/domains/host-routing";
import type { Order } from "@/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Exactly the tables saved in the live settings (read 2026-11-26): outside 1–3, inside 4–8. */
const SAVED_TABLES = [
  { id: "outside-1", area: "outside", number: 1 },
  { id: "outside-2", area: "outside", number: 2 },
  { id: "outside-3", area: "outside", number: 3 },
  { id: "inside-4", area: "inside", number: 4 },
  { id: "inside-5", area: "inside", number: 5 },
  { id: "inside-6", area: "inside", number: 6 },
  { id: "inside-7", area: "inside", number: 7 },
  { id: "inside-8", area: "inside", number: 8 },
];
const DINE_IN: FulfillmentSettings = normalizeFulfillmentSettings({ ...DEFAULT_FULFILLMENT, dineIn: { enabled: true, tables: SAVED_TABLES } });

const TUESDAY_NOON = localToDate({ year: 2026, month: 11, day: 24 }, 12 * 60);
const TUESDAY_LATE = localToDate({ year: 2026, month: 11, day: 24 }, 23 * 60 + 30);
const PRODUCTS = new Map<string, CatalogProduct | undefined>([["latte", { price: 16, nameHe: "לאטה", nameAr: "لاتيه", nameEn: "Latte", available: true, active: true }]]);

function request(patch: Partial<CreateOrderRequest> = {}): CreateOrderRequest {
  return {
    items: [{ productId: "latte", quantity: 2 }],
    customer: { name: "רנא", phone: "" },
    locale: "he",
    payment: "table",
    fulfillment: { type: "dine_in", tableId: "inside-4" },
    ...patch,
  } as CreateOrderRequest;
}
const build = (req: CreateOrderRequest, fulfillment = DINE_IN, now = TUESDAY_NOON) =>
  buildServerOrder(req, { products: PRODUCTS, fulfillment, openingHours: DEFAULT_OPENING_HOURS, now, orderNumber: "MC-2026-TABLE001" });

describe("the saved tables, exactly as they are", () => {
  it("settings keep the ids outside-1..3 and inside-4..8", () => {
    expect(DINE_IN.dineIn.tables.map((t) => t.id)).toEqual(SAVED_TABLES.map((t) => t.id));
    expect(tablesByArea(DINE_IN.dineIn.tables).map((g) => [g.area, g.tables.map((t) => t.number)])).toEqual([
      ["inside", [4, 5, 6, 7, 8]],
      ["outside", [1, 2, 3]],
    ]);
    expect(findTable(DINE_IN, "inside-1")).toBeNull();
    expect(findTable(DINE_IN, "inside-4")).toEqual(makeTable("inside", 4));
  });

  it("table names in three languages", () => {
    expect(tableDisplayName({ area: "inside", number: 4 }, "he")).toBe("שולחן 4 · פנים");
    expect(tableDisplayName({ area: "outside", number: 2 }, "ar")).toBe("طاولة 2 · خارج");
    expect(tableDisplayName({ area: "inside", number: 8 }, "en")).toBe("Table 8 · Inside");
  });
});

describe("server: table orders", () => {
  it("open, on, saved table: accepted with the table, pay at the end, no phone needed", () => {
    const result = build(request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order).toMatchObject({
      orderType: "dine_in",
      tableId: "inside-4",
      tableArea: "inside",
      tableNumber: 4,
      paymentCollection: "table",
      paymentMethod: "cash",
      customerName: "רנא",
      customerPhone: "",
      delivery: 0,
    });
  });

  it("refused: off, no tables, closed (with when it opens), unknown table, paying online", () => {
    expect(build(request(), { ...DINE_IN, dineIn: { ...DINE_IN.dineIn, enabled: false } })).toEqual({
      ok: false,
      error: { code: "DINE_IN_UNAVAILABLE", reason: "disabled", nextAt: null },
    });
    expect(build(request(), { ...DINE_IN, dineIn: { enabled: true, tables: [] } })).toMatchObject({ ok: false, error: { reason: "no_tables" } });
    const closed = build(request(), DINE_IN, TUESDAY_LATE);
    expect(closed).toMatchObject({ ok: false, error: { code: "DINE_IN_UNAVAILABLE", reason: "closed" } });
    expect(closed.ok === false && closed.error.code === "DINE_IN_UNAVAILABLE" && closed.error.nextAt).toBeTruthy();
    expect(build(request({ fulfillment: { type: "dine_in", tableId: "inside-1" } }))).toEqual({ ok: false, error: { code: "UNKNOWN_TABLE" } });
    expect(build(request({ payment: "online" }))).toEqual({ ok: false, error: { code: "PAYMENT_NOT_ALLOWED" } });
  });

  it("opening hours only, no cut before closing", () => {
    const noon = dineInAvailability(DINE_IN, DEFAULT_OPENING_HOURS, TUESDAY_NOON);
    expect(noon.available).toBe(true);
    if (!noon.available) return;
    // Still open one minute before closing; closed at closing time.
    expect(dineInAvailability(DINE_IN, DEFAULT_OPENING_HOURS, new Date(noon.until.getTime() - 60_000)).available).toBe(true);
    expect(dineInAvailability(DINE_IN, DEFAULT_OPENING_HOURS, noon.until).available).toBe(false);
  });

  it("phone: optional only at the table; a given phone must be valid; table orders limited per table", async () => {
    const keys: string[] = [];
    const deps: CreateOrderDeps = {
      now: () => TUESDAY_NOON,
      loadProducts: async (ids) => new Map(ids.map((id) => [id, PRODUCTS.get(id)])),
      loadContext: async () => ({ fulfillment: DINE_IN, openingHours: DEFAULT_OPENING_HOURS }),
      rateLimit: async (key) => {
        keys.push(key);
        return true;
      },
      saveOrder: async () => "order-1",
    };
    expect((await handleCreateOrder(request(), "1.2.3.4", deps)).status).toBe(200);
    expect(keys).toContain("create-order|table|inside-4");
    expect((await handleCreateOrder(request({ customer: { name: "x", phone: "12" } }), "", deps)).status).toBe(400);
    const pickupNoPhone = request({ payment: "counter", fulfillment: { type: "pickup" }, customer: { name: "x", phone: "" } });
    expect((await handleCreateOrder(pickupNoPhone, "", deps)).status).toBe(400);
  });
});

describe("where the table shows", () => {
  const order = {
    id: "o1", orderNumber: "MC-2026-TABLE001", customerId: "guest", customerName: "רנא", status: "pending",
    items: [{ productId: "latte", productName: "לאטה", quantity: 2, price: 16 }], total: 32, paymentMethod: "cash",
    orderType: "dine_in", tableId: "inside-4", tableArea: "inside", tableNumber: 4, createdAt: "2026-11-24T10:00:00.000Z", locale: "he",
  } as Order;

  it("thermal receipt, kitchen ticket and manager email", () => {
    expect(buildReceiptModelFromOrder(order).pickupLabel).toBe("שולחן 4 · פנים");
    expect(kitchenTicketHtml(order)).toContain("שולחן 4 · פנים");
    const email = renderNewOrderEmail({
      orderId: "o1", orderNumber: "MC-2026-TABLE001", createdAt: order.createdAt, customerName: "רנא", items: [], total: 32,
      orderType: "dine_in", tableArea: "inside", tableNumber: 4, viewUrl: "",
    });
    expect(email.html).toContain("ישיבה במקום");
    expect(email.html).toContain("שולחן 4 · פנים");
  });

  it("customer tracking: steps up to served", () => {
    const view = buildTrackingView({ ...order, status: "delivered" });
    expect(view).toMatchObject({ orderType: "dine_in", tableId: "inside-4" });
    expect(trackingHeadline(view)).toBe("served");
  });

  it("admin: table chip, 'served', dine-in filter, renumber warning", () => {
    const card = read("src/features/admin/orders/order-card.tsx");
    expect(card).toMatch(/data-table-chip/);
    expect(card).toMatch(/admin\.orders\.next\.readyDineIn/);
    expect(card).toMatch(/admin\.status\.served/);
    expect(read("src/features/admin/orders-admin.tsx")).toMatch(/<SelectItem value="dine_in">/);
    expect(read("src/features/admin/fulfillment-settings-card.tsx")).toMatch(/admin\.fulfillment\.dineIn\.renumberWarning/);
  });
});

describe("table QR codes and the scanned table", () => {
  it("QR link is /t/<id as saved>; /t is a storefront-only path", () => {
    expect(tableQrUrl("inside-4")).toMatch(/^https:\/\/[^/]+\/t\/inside-4$/);
    expect(isCustomerOnlyPath("/t/inside-4")).toBe(true);
    expect(isOrderingPath("/t/inside-4")).toBe(true);
  });

  it("QR page, change window and print page read the tables from the settings (no fixed list)", () => {
    const section = read("src/features/admin/table-qr-section.tsx");
    expect(section).toMatch(/useSettings\(\)/);
    expect(section).toMatch(/tablesByArea\(dineIn\?\.tables \?\? \[\]\)/);
    const picker = read("src/features/checkout/checkout-fulfillment.tsx");
    expect(picker).toMatch(/const groups = tablesByArea\(tables\)/);
    expect(read("src/app/checkout/page.tsx")).toMatch(/tables=\{availability\.tables\}/);
    for (const file of ["src/features/admin/table-qr-section.tsx", "src/features/checkout/checkout-fulfillment.tsx"]) {
      expect(read(file), file).not.toMatch(/defaultCafeTables|inside-1|"outside-1"/);
    }
  });

  it("scanned table kept 3 hours", () => {
    const now = Date.parse("2026-11-24T10:00:00Z");
    expect(parseScannedTable({ tableId: "inside-4", savedAt: now - 1000 }, now)).toEqual({ tableId: "inside-4", savedAt: now - 1000 });
    expect(parseScannedTable({ tableId: "inside-4", savedAt: now - SCANNED_TABLE_TTL_MS }, now)).toBeNull();
    expect(parseScannedTable({ tableId: "../x", savedAt: now }, now)).toBeNull();
    expect(SCANNED_TABLE_TTL_MS).toBe(3 * 60 * 60 * 1000);
  });

  it("checkout: 'At the table' only when available; falls back otherwise", () => {
    expect(resolveOrderType("dine_in", { pickup: true, delivery: true, dineIn: true })).toBe("dine_in");
    expect(resolveOrderType("dine_in", { pickup: true, delivery: false, dineIn: false })).toBe("pickup");
    expect(resolveOrderType("pickup", { pickup: false, delivery: false, dineIn: true })).toBe("dine_in");
    expect(resolveOrderType("delivery", { pickup: false, delivery: true, dineIn: true })).toBe("delivery");
  });

  it("translations in three languages", () => {
    const ui = read("src/data/ui-translations-seed.ts");
    for (const key of ["checkout.dineIn", "checkout.dineInPayAtEnd", "checkout.dineInChange", "dineIn.banner.ordering", "dineIn.landing.unknownTitle"]) {
      expect(ui.split(`"${key}":`).length - 1, key).toBe(3);
    }
    const admin = read("src/data/admin-translations.ts");
    for (const key of ["admin.qr.tables.title", "admin.qr.tables.printAll", "admin.orders.type.dine_in", "admin.status.served"]) {
      expect(admin.split(`"${key}":`).length - 1, key).toBe(3);
    }
  });
});
