// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  courierStage,
  decideCourierAction,
  googleMapsUrl,
  openDeliveryCount,
  sortCourierDeliveries,
  toCourierDelivery,
  wazeUrl,
  type CourierOrderInput,
} from "@/lib/couriers/deliveries";
import { buildTrackingView } from "@/lib/orders/tracking-view";
import type { Order } from "@/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function order(over: Partial<CourierOrderInput> = {}): CourierOrderInput {
  return {
    id: "Order0000001",
    orderNumber: "MC-2026-AB12CD34",
    status: "preparing",
    orderType: "delivery",
    customerName: "Yousef",
    customerFullName: "Yousef Haddad",
    customerPhone: "050-123-4567",
    deliveryAddress: "12 Olive St, entrance B",
    deliveryZoneName: "Ein Mahel",
    notes: "ring twice",
    items: [{ productName: "Cappuccino", quantity: 2, modifiers: [{ optionName: "Oat", quantity: 1 }] }],
    total: 79,
    paymentMethod: "cash",
    paymentStatus: "pending",
    readyAt: null,
    outForDeliveryAt: null,
    deliveredAt: null,
    ...over,
  };
}

describe("what the courier sees", () => {
  it("stage follows the order", () => {
    expect(courierStage(order({ status: "pending" }))).toBe("in_kitchen");
    expect(courierStage(order({ status: "preparing" }))).toBe("in_kitchen");
    expect(courierStage(order({ status: "ready" }))).toBe("pickup_now");
    expect(courierStage(order({ status: "ready", outForDeliveryAt: "2026-11-26T10:48:00Z" }))).toBe("on_the_way");
    expect(courierStage(order({ status: "delivered" }))).toBe("delivered");
    expect(courierStage(order({ status: "cancelled", outForDeliveryAt: "2026-11-26T10:48:00Z" }))).toBe("cancelled");
  });

  it("customer, phone, address, zone, notes, items and how much to collect", () => {
    const d = toCourierDelivery(order());
    expect(d).toMatchObject({
      customerName: "Yousef Haddad",
      customerPhone: "050-123-4567",
      address: "12 Olive St, entrance B",
      zone: "Ein Mahel",
      notes: "ring twice",
      collect: 79,
      paidWith: null,
    });
    expect(d.items).toEqual([{ name: "Cappuccino", quantity: 2, extras: ["Oat"] }]);
    // Paid online: nothing to collect.
    expect(toCourierDelivery(order({ paymentMethod: "card", paymentProvider: "HYP", paymentStatus: "paid" }))).toMatchObject({ collect: null, paidWith: "online" });
    expect(toCourierDelivery(order({ paymentStatus: "paid", paidVia: "courier_card" }))).toMatchObject({ collect: null, paidWith: "card" });
  });

  it("list order: cancelled (don't leave), pick up now, on the way, in the kitchen, delivered", () => {
    const list = sortCourierDeliveries(
      [
        order({ id: "d", status: "delivered", deliveredAt: "2026-11-26T09:00:00Z" }),
        order({ id: "k", status: "preparing" }),
        order({ id: "w", status: "ready", outForDeliveryAt: "2026-11-26T10:48:00Z" }),
        order({ id: "p", status: "ready" }),
        order({ id: "x", status: "cancelled" }),
      ].map(toCourierDelivery)
    );
    expect(list.map((d) => d.id)).toEqual(["x", "p", "w", "k", "d"]);
  });

  it("navigation links carry the address and the area", () => {
    const d = toCourierDelivery(order());
    expect(wazeUrl(d)).toBe(`https://waze.com/ul?q=${encodeURIComponent("12 Olive St, entrance B, Ein Mahel")}&navigate=yes`);
    expect(googleMapsUrl(d)).toBe(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent("12 Olive St, entrance B, Ein Mahel")}`);
  });
});

describe("'I'm leaving' and 'Delivered'", () => {
  it("leaving while still in the kitchen also marks it ready", () => {
    const decision = decideCourierAction(order({ status: "preparing" }), "out", null, "Samir");
    expect(decision).toEqual({ ok: true, patch: { status: "ready", readyAt: "now", outForDeliveryAt: "now" }, paidAtDoor: null });
    // Already ready: only the out-for-delivery stamp.
    expect(decideCourierAction(order({ status: "ready", readyAt: "2026-11-26T10:41:00Z" }), "out", null, "Samir")).toEqual({
      ok: true,
      patch: { outForDeliveryAt: "now" },
      paidAtDoor: null,
    });
  });

  it("delivered cash order: must say how it was paid; marks it paid by the courier", () => {
    const out = order({ status: "ready", readyAt: "x", outForDeliveryAt: "y" });
    expect(decideCourierAction(out, "delivered", null, "Samir")).toEqual({ ok: false, code: "PAYMENT_REQUIRED" });
    expect(decideCourierAction(out, "delivered", "card", "Samir")).toEqual({
      ok: true,
      patch: { status: "delivered", deliveredAt: "now", completedAt: "now", paymentStatus: "paid", paidAt: "now", paidBy: "Samir", paidVia: "courier_card" },
      paidAtDoor: "card",
    });
    expect(decideCourierAction(out, "delivered", "cash", "Samir")).toMatchObject({ ok: true, paidAtDoor: "cash", patch: { paidVia: "courier_cash" } });
  });

  it("delivered order paid online: no payment question, no payment fields", () => {
    const paid = order({ status: "ready", readyAt: "x", outForDeliveryAt: "y", paymentMethod: "card", paymentProvider: "HYP", paymentStatus: "paid" });
    expect(decideCourierAction(paid, "delivered", null, "Samir")).toEqual({
      ok: true,
      patch: { status: "delivered", deliveredAt: "now", completedAt: "now" },
      paidAtDoor: null,
    });
  });

  it("'Delivered' straight from the kitchen fills the missing stamps", () => {
    const decision = decideCourierAction(order({ status: "preparing", paymentMethod: "card", paymentProvider: "HYP", paymentStatus: "paid" }), "delivered", null, "S");
    expect(decision).toMatchObject({ ok: true, patch: { status: "delivered", readyAt: "now", outForDeliveryAt: "now", deliveredAt: "now" } });
  });

  it("refused: cancelled, already delivered (only the manager can undo), not a delivery", () => {
    expect(decideCourierAction(order({ status: "cancelled" }), "out", null, "S")).toEqual({ ok: false, code: "CANCELLED" });
    expect(decideCourierAction(order({ status: "delivered" }), "delivered", "cash", "S")).toEqual({ ok: false, code: "ALREADY_DELIVERED" });
    expect(decideCourierAction(order({ status: "delivered" }), "out", null, "S")).toEqual({ ok: false, code: "ALREADY_DELIVERED" });
    expect(decideCourierAction(order({ orderType: "pickup" }), "out", null, "S")).toEqual({ ok: false, code: "NOT_DELIVERY" });
  });
});

describe("shift: 'Started my shift' / 'Finished my shift'", () => {
  it("can't finish while deliveries are still open", () => {
    const list = [
      order({ id: "a", status: "preparing" }),
      order({ id: "b", status: "ready" }),
      order({ id: "c", status: "ready", outForDeliveryAt: "x" }),
      order({ id: "d", status: "delivered" }),
      order({ id: "e", status: "cancelled" }),
    ].map(toCourierDelivery);
    expect(openDeliveryCount(list)).toBe(3);
    expect(openDeliveryCount(list.filter((d) => d.stage === "delivered" || d.stage === "cancelled"))).toBe(0);
  });

  it("courier marks themselves working today (Jerusalem) or not; signing in alone does not", () => {
    const store = read("src/lib/couriers/admin/store.ts");
    expect(store).toMatch(/workingDate: input\.on \? jerusalemDate\(now\) : null/);
    expect(store).toMatch(/if \(open > 0\) return \{ ok: false, code: "OPEN_DELIVERIES", open \}/);
    const route = read("src/app/api/staff/shift/route.ts");
    expect(route).toMatch(/member\.role !== "courier"/);
    // The sign-in route never touches workingDate.
    expect(read("src/app/api/staff/login/route.ts")).not.toMatch(/workingDate/);
    expect(read("src/lib/staff/login.ts")).not.toMatch(/workingDate/);
  });

  it("shift not started: only the start button instead of the list", () => {
    const screen = read("src/features/staff/courier-deliveries.tsx");
    expect(screen).toMatch(/\) : !worksToday \? \(/);
    expect(screen).toMatch(/data-shift-start/);
    expect(screen).toMatch(/data-shift-end-confirm/);
    const ui = read("src/data/ui-translations-seed.ts");
    for (const key of ["courier.shift.start", "courier.shift.end", "courier.shift.endBlocked"]) expect(ui.split(`"${key}":`).length - 1, key).toBe(3);
  });
});

describe("the customer never sees the courier", () => {
  it("tracking view has no courier id or name", () => {
    const view = buildTrackingView({
      id: "Order0000001", orderNumber: "MC-1", customerId: "c", customerName: "Y", status: "ready", items: [], total: 79,
      orderType: "delivery", createdAt: "2026-11-26T10:00:00Z", courierId: "StaffSamir01", courierName: "Samir Courier",
      outForDeliveryAt: "2026-11-26T10:48:00Z",
    } as Order);
    const json = JSON.stringify(view);
    expect(json).not.toContain("StaffSamir01");
    expect(json).not.toContain("Samir");
  });
});

describe("wiring", () => {
  it("courier API: only the signed-in courier, only their own delivery, today's list", () => {
    const route = read("src/app/api/staff/deliveries/route.ts");
    expect(route).toMatch(/member\.role === "courier"/);
    const store = read("src/lib/couriers/admin/store.ts");
    expect(store).toMatch(/data\.courierId !== input\.courier\.id\) return \{ ok: false as const, code: "NOT_YOURS"/);
    expect(store).toMatch(/where\("courierAssignedDate", "==", jerusalemDate\(now\)\)/);
    // Assigning checks the courier is active and working today.
    expect(store).toMatch(/courier\.workingDate !== jerusalemDate\(now\)/);
    // Club points when paid at the door.
    expect(store).toMatch(/if \(result\.paidAtDoor\) await awardLoyaltyPointsForOrder/);
  });

  it("admin couriers API is for any staff; card shows the picker; courier screen polls every 10 s with an alert", () => {
    expect(read("src/app/api/admin/couriers/route.ts")).toMatch(/requireStaff\(request\)/);
    expect(read("src/features/admin/orders/order-card.tsx")).toMatch(/<OrderCourierPicker/);
    const screen = read("src/features/staff/courier-deliveries.tsx");
    expect(screen).toMatch(/COURIER_POLL_MS = 10_000/);
    expect(screen).toMatch(/navigator\.vibrate/);
    expect(screen).toMatch(/createOscillator/);
  });

  it("translations in three languages", () => {
    const ui = read("src/data/ui-translations-seed.ts");
    for (const key of ["courier.leaving", "courier.delivered", "courier.howPaid", "courier.collect", "courier.cancelledHint"]) {
      expect(ui.split(`"${key}":`).length - 1, key).toBe(3);
    }
    const admin = read("src/data/admin-translations.ts");
    for (const key of ["admin.orders.courier.choose", "admin.orders.courier.noneWorking", "admin.payment.paidCourierCard"]) {
      expect(admin.split(`"${key}":`).length - 1, key).toBe(3);
    }
  });
});
