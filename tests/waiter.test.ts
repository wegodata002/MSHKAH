// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  actorLabel,
  decidePaid,
  decideServed,
  isOpenAtTable,
  summarizeTable,
  toWaiterOrder,
  waiterStage,
  type WaiterOrderInput,
} from "@/lib/waiter/tables";
import {
  checkPairing,
  DEVICE_SESSION_TTL_SECONDS,
  newPairingCode,
  PAIRING_CODE_PATTERN,
  pairingCodeHash,
  readDeviceSession,
  signDeviceSession,
} from "@/lib/staff/device";
import { parseStaffAdminRequest } from "@/lib/staff/admin-input";
import { makeTable, normalizeFulfillmentSettings, DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { localToDate } from "@/lib/fulfillment/availability";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { buildServerOrder, type CatalogProduct, type CreateOrderRequest } from "@/lib/orders/server-order";
import { toStoredOrderStatus } from "@/lib/orders/status";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function order(over: Partial<WaiterOrderInput> = {}): WaiterOrderInput {
  return {
    id: "Order0000001",
    orderNumber: "MC-2026-TABLE001",
    orderType: "dine_in",
    status: "preparing",
    tableId: "inside-4",
    customerName: "רנא",
    items: [{ productName: "Latte", quantity: 2, modifiers: [{ optionName: "Oat", quantity: 1 }] }],
    notes: "",
    total: 32,
    paymentMethod: "cash",
    paymentStatus: "pending",
    readyAt: null,
    deliveredAt: null,
    createdAt: "2026-11-24T10:00:00.000Z",
    ...over,
  };
}

describe("waiter: stage and view", () => {
  it("maps kitchen statuses to the waiter's four stages", () => {
    expect(waiterStage({ status: "pending" })).toBe("in_kitchen");
    expect(waiterStage({ status: "preparing" })).toBe("in_kitchen");
    expect(waiterStage({ status: "ready" })).toBe("ready");
    expect(waiterStage({ status: toStoredOrderStatus("delivered") })).toBe("served");
    expect(waiterStage({ status: "cancelled" })).toBe("cancelled");
  });

  it("how it was paid", () => {
    expect(toWaiterOrder(order()).paidWith).toBeNull();
    expect(toWaiterOrder(order({ paymentStatus: "paid", paidVia: "waiter_cash", paidBy: "רנא" }))).toMatchObject({ paid: true, paidWith: "cash", paidBy: "רנא" });
    expect(toWaiterOrder(order({ paymentStatus: "paid", paidVia: "waiter_card" })).paidWith).toBe("card");
    expect(toWaiterOrder(order({ paymentStatus: "paid", paymentMethod: "card", paymentProvider: "HYP" })).paidWith).toBe("online");
    expect(toWaiterOrder(order({ paidBy: "x" })).paidBy).toBeNull();
  });

  it("open at the table until served and paid; cancelled is never open", () => {
    expect(isOpenAtTable({ stage: "served", paid: false })).toBe(true);
    expect(isOpenAtTable({ stage: "ready", paid: true })).toBe(true);
    expect(isOpenAtTable({ stage: "served", paid: true })).toBe(false);
    expect(isOpenAtTable({ stage: "cancelled", paid: false })).toBe(false);
  });

  it("table summary: ready first, then kitchen, then to pay, else free", () => {
    const table = makeTable("inside", 4);
    const o = (over: Partial<WaiterOrderInput>) => toWaiterOrder(order(over));
    expect(summarizeTable(table, []).state).toBe("free");
    expect(summarizeTable(table, [o({ tableId: "inside-5" })]).state).toBe("free");

    const mixed = [
      o({ id: "B0000000002", status: "ready", total: 20, createdAt: "2026-11-24T10:05:00.000Z" }),
      o({ id: "A0000000001", status: "preparing", total: 32 }),
      o({ id: "C0000000003", status: "cancelled", total: 99 }),
      o({ id: "D0000000004", status: toStoredOrderStatus("delivered"), paymentStatus: "paid", paidVia: "waiter_cash", total: 50 }),
    ];
    const summary = summarizeTable(table, mixed);
    expect(summary.state).toBe("ready");
    expect(summary.readyCount).toBe(1);
    expect(summary.openOrders.map((x) => x.id)).toEqual(["A0000000001", "B0000000002"]);
    expect(summary.cancelledOrders.map((x) => x.id)).toEqual(["C0000000003"]);
    expect(summary.toPay).toBe(52);

    expect(summarizeTable(table, [o({ status: "preparing" })]).state).toBe("in_kitchen");
    expect(summarizeTable(table, [o({ status: toStoredOrderStatus("delivered"), total: 10.1 }), o({ id: "E0000000005", status: toStoredOrderStatus("delivered"), total: 0.2 })])).toMatchObject({
      state: "to_pay",
      toPay: 10.3,
    });
  });
});

describe("waiter: Served", () => {
  it("in the kitchen → served, and marked ready too", () => {
    const result = decideServed(order(), "רנא");
    expect(result).toEqual({
      ok: true,
      paid: false,
      patch: { status: toStoredOrderStatus("delivered"), deliveredAt: "now", completedAt: "now", servedBy: "רנא", readyAt: "now" },
    });
  });

  it("ready → served keeps its ready time", () => {
    const result = decideServed(order({ status: "ready", readyAt: "2026-11-24T10:10:00.000Z" }), "רנא · טאבלט בר");
    expect(result.ok && result.patch.readyAt).toBeFalsy();
    expect(result.ok && result.patch.servedBy).toBe("רנא · טאבלט בר");
  });

  it("refuses cancelled, already served and non-table orders", () => {
    expect(decideServed(order({ status: "cancelled" }), "x")).toEqual({ ok: false, code: "CANCELLED" });
    expect(decideServed(order({ status: toStoredOrderStatus("delivered") }), "x")).toEqual({ ok: false, code: "ALREADY_SERVED" });
    expect(decideServed(order({ orderType: "delivery" }), "x")).toEqual({ ok: false, code: "NOT_TABLE_ORDER" });
  });
});

describe("waiter: Paid", () => {
  it("cash and card at the table, with who", () => {
    expect(decidePaid(order(), "cash", "רנא")).toEqual({ ok: true, paid: true, patch: { paymentStatus: "paid", paidAt: "now", paidBy: "רנא", paidVia: "waiter_cash" } });
    const card = decidePaid(order({ status: toStoredOrderStatus("delivered") }), "card", "רנא");
    expect(card.ok && card.patch.paidVia).toBe("waiter_card");
  });

  it("refuses already paid, paid online, cancelled and non-table orders", () => {
    expect(decidePaid(order({ paymentStatus: "paid" }), "cash", "x")).toEqual({ ok: false, code: "ALREADY_PAID" });
    expect(decidePaid(order({ paymentMethod: "card", paymentProvider: "HYP" }), "cash", "x")).toEqual({ ok: false, code: "PAID_ONLINE" });
    expect(decidePaid(order({ status: "cancelled" }), "cash", "x")).toEqual({ ok: false, code: "CANCELLED" });
    expect(decidePaid(order({ orderType: "pickup" }), "cash", "x")).toEqual({ ok: false, code: "NOT_TABLE_ORDER" });
  });

  it("who did it: name, plus the tablet when from a fixed device", () => {
    expect(actorLabel("רנא")).toBe("רנא");
    expect(actorLabel("רנא", null)).toBe("רנא");
    expect(actorLabel("רנא", "טאבלט בר")).toBe("רנא · טאבלט בר");
  });
});

describe("fixed device", () => {
  const NOW = Date.UTC(2026, 10, 24, 10, 0, 0);

  it("pairing codes are 6 digits and stored only as a keyed hash", () => {
    for (let i = 0; i < 50; i++) expect(newPairingCode()).toMatch(PAIRING_CODE_PATTERN);
    const hash = pairingCodeHash("123456");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("123456");
    expect(pairingCodeHash("123456")).toBe(hash);
    expect(pairingCodeHash("123457")).not.toBe(hash);
  });

  it("a pairing code works once, for 10 minutes", () => {
    const doc = { deviceName: "טאבלט בר", createdAt: "", createdBy: "admin", expiresAtMs: NOW + 1000, used: false };
    expect(checkPairing(doc, NOW)).toEqual({ ok: true });
    expect(checkPairing(undefined, NOW)).toEqual({ ok: false, code: "INVALID_CODE" });
    expect(checkPairing({ ...doc, used: true }, NOW)).toEqual({ ok: false, code: "USED" });
    expect(checkPairing(doc, NOW + 1000)).toEqual({ ok: false, code: "EXPIRED" });
  });

  it("the device sign-in lasts 30 days and can't be forged", () => {
    const session = signDeviceSession({ deviceId: "Device00000001", sessionVersion: 3, now: NOW });
    expect(session.maxAgeSeconds).toBe(DEVICE_SESSION_TTL_SECONDS);
    expect(DEVICE_SESSION_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
    expect(readDeviceSession(session.value, NOW + 1000)).toEqual({ deviceId: "Device00000001", sessionVersion: 3 });
    expect(readDeviceSession(session.value, NOW + DEVICE_SESSION_TTL_SECONDS * 1000)).toBeNull();

    const parts = session.value.split(".");
    const otherDevice = [parts[0], "Device00000002", ...parts.slice(2)].join(".");
    const olderVersion = [parts[0], parts[1], "2", ...parts.slice(3)].join(".");
    const longer = [...parts.slice(0, 3), String(Number(parts[3]) + 1e9), parts[4]].join(".");
    for (const forged of [otherDevice, olderVersion, longer, "", "v1.x.1.1.y", undefined, null]) expect(readDeviceSession(forged, NOW)).toBeNull();
  });

  it("admin requests for devices are checked", () => {
    expect(parseStaffAdminRequest({ action: "devices" })).toEqual({ ok: true, request: { action: "devices" } });
    expect(parseStaffAdminRequest({ action: "pair-device", deviceName: "  טאבלט בר  " })).toEqual({ ok: true, request: { action: "pair-device", deviceName: "טאבלט בר" } });
    expect(parseStaffAdminRequest({ action: "pair-device", deviceName: "" })).toEqual({ ok: false, error: "DEVICE_NAME" });
    expect(parseStaffAdminRequest({ action: "pair-device", deviceName: "x".repeat(41) })).toMatchObject({ ok: false });
    expect(parseStaffAdminRequest({ action: "revoke-device", deviceId: "Device00000001" })).toEqual({ ok: true, request: { action: "revoke-device", deviceId: "Device00000001" } });
    expect(parseStaffAdminRequest({ action: "revoke-device", deviceId: "../x" })).toEqual({ ok: false, error: "ID" });
  });
});

describe("table orders carry the service day", () => {
  it("a table order gets serviceDate (Jerusalem date) so the waiter screen finds it without an index", () => {
    const fulfillment = normalizeFulfillmentSettings({ ...DEFAULT_FULFILLMENT, dineIn: { enabled: true, tables: [{ id: "inside-4", area: "inside", number: 4 }] } });
    const products = new Map<string, CatalogProduct | undefined>([["latte", { price: 16, nameHe: "לאטה", nameAr: "لاتيه", nameEn: "Latte", available: true, active: true }]]);
    const req = {
      items: [{ productId: "latte", quantity: 1 }],
      customer: { name: "רנא", phone: "" },
      locale: "he",
      payment: "table",
      fulfillment: { type: "dine_in", tableId: "inside-4" },
    } as CreateOrderRequest;
    const now = localToDate({ year: 2026, month: 11, day: 24 }, 12 * 60);
    const result = buildServerOrder(req, { products, modifierConfigs: new Map(), fulfillment, openingHours: DEFAULT_OPENING_HOURS, now, orderNumber: "MC-2026-TABLE001" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.order.serviceDate).toBe("2026-11-24");
  });
});

describe("wiring", () => {
  it("the waiter API needs a waiter sign-in or a fixed device, and only reads today's table orders", () => {
    const route = read("src/app/api/staff/tables/route.ts");
    expect(route).toContain("readWaiterContext");
    expect(route).toMatch(/CHOOSE_WAITER/);
    const store = read("src/lib/waiter/admin/store.ts");
    expect(store).toMatch(/where\("orderType", "==", "dine_in"\)/);
    expect(store).toMatch(/where\("serviceDate", "==", /);
    expect(store).toContain("runTransaction");
    expect(store).toContain("awardLoyaltyPointsForOrder");
  });

  it("pairing is rate limited, and device admin is admin-only", () => {
    expect(read("src/app/api/staff/device/pair/route.ts")).toContain("consumeRateLimit");
    const admin = read("src/app/api/admin/staff/route.ts");
    expect(admin).toContain("pair-device");
    expect(admin).toContain("revoke-device");
    expect(admin).toContain("requireAdminOnly");
  });

  it("the staff screen opens the waiter screen for waiters and fixed devices", () => {
    const screen = read("src/features/staff/staff-screen.tsx");
    expect(screen).toContain("<WaiterTables");
    expect(screen).toContain('kind: "device"');
    expect(screen).toContain("data-pair-link");
    expect(read("src/features/admin/staff-admin.tsx")).toContain("<StaffDevicesSection");
  });

  it("every waiter/device key exists in three languages", () => {
    const ui = read("src/data/ui-translations-seed.ts");
    const admin = read("src/data/admin-translations.ts");
    const waiter = read("src/features/staff/waiter-tables.tsx") + read("src/features/staff/staff-screen.tsx");
    const uiKeys = new Set([...waiter.matchAll(/"((?:waiter|device)\.[a-zA-Z_.]+)"/g)].map((m) => m[1]!));
    // Keys built from a variable part.
    for (const k of ["waiter.tile.ready", "waiter.tile.in_kitchen", "waiter.tile.to_pay", "waiter.tile.free", "waiter.stage.cancelled", "waiter.stage.in_kitchen", "waiter.stage.ready", "waiter.paid.cash", "waiter.paid.card", "waiter.paid.online", "waiter.confirmPaid.cash", "waiter.confirmPaid.card"]) uiKeys.add(k);
    for (const key of uiKeys) {
      if (key.endsWith(".")) continue;
      expect(ui.split(`"${key}":`).length - 1, key).toBe(3);
    }
    const adminSrc = read("src/features/admin/staff-devices-section.tsx") + read("src/features/admin/orders/order-card.tsx");
    const adminKeys = [...adminSrc.matchAll(/"(admin\.(?:devices|payment\.paidWaiter|orders\.servedBy)[a-zA-Z_.]*)"/g)].map((m) => m[1]!);
    expect(adminKeys.length).toBeGreaterThan(10);
    for (const key of adminKeys) expect(admin.split(`"${key}":`).length - 1, key).toBe(3);
  });
});
