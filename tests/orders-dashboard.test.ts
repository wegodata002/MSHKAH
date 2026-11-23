import { describe, expect, it } from "vitest";
import { computeOrderDashboard, isAwaitingCashPayment } from "@/lib/orders/dashboard";
import { overdueLevel, shouldSendCriticalEmail, stageAgeMs } from "@/lib/orders/overdue";
import { normalizeOrderStatus } from "@/lib/orders/status";
import { describeAge, isJerusalemToday, jerusalemDayBounds } from "@/lib/orders/time";
import type { Order } from "@/types";

function order(partial: Partial<Order> & Pick<Order, "id" | "status">): Order {
  return {
    orderNumber: partial.orderNumber ?? partial.id,
    customerId: "c",
    customerName: "Guest",
    items: [],
    total: partial.total ?? 50,
    createdAt: partial.createdAt ?? new Date().toISOString(),
    paymentStatus: partial.paymentStatus ?? "pending",
    ...partial,
  };
}

describe("order status normalization", () => {
  it("maps legacy and stored statuses to one operational set", () => {
    expect(normalizeOrderStatus("pending")).toBe("received");
    expect(normalizeOrderStatus("confirmed")).toBe("received");
    expect(normalizeOrderStatus("RECEIVED")).toBe("received");
    expect(normalizeOrderStatus("preparing")).toBe("preparing");
    expect(normalizeOrderStatus("ready")).toBe("ready");
    expect(normalizeOrderStatus("completed")).toBe("delivered");
    expect(normalizeOrderStatus("canceled")).toBe("cancelled");
  });
});

describe("human readable age", () => {
  it("formats 121 minutes as hours not raw minutes", () => {
    expect(describeAge(121 * 60_000)).toEqual({ kind: "hoursMinutes", hours: 2, minutes: 1 });
  });

  it("formats 6417 minutes as days and hours", () => {
    expect(describeAge(6417 * 60_000)).toEqual({ kind: "daysHours", days: 4, hours: 11 });
  });
});

describe("dashboard counters", () => {
  const now = new Date("2026-10-07T10:00:00+03:00");

  it("counts active orders by their current stage, whatever the period, and ignores payment and test orders", () => {
    const orders = [
      order({
        id: "MC-2026-N67UFK6G",
        status: "confirmed",
        paymentStatus: "paid",
        createdAt: "2026-10-06T12:00:00+03:00",
      }),
      order({
        id: "MC-2026-QRNE4S0E",
        status: "pending",
        paymentStatus: "paid",
        createdAt: "2026-10-07T08:00:00+03:00",
      }),
      order({
        id: "old-delivered",
        status: "delivered",
        paymentStatus: "paid",
        createdAt: "2026-10-03T13:04:00+03:00",
        deliveredAt: "2026-10-03T14:00:00+03:00",
      }),
      order({
        id: "test",
        status: "pending",
        isTestOrder: true,
        paymentStatus: "paid",
        createdAt: "2026-10-07T09:00:00+03:00",
        total: 2,
      }),
    ];
    const stats = computeOrderDashboard(orders, now);
    expect(stats.received).toBe(2);
    expect(stats.preparing).toBe(0);
    expect(stats.ready).toBe(0);
    expect(stats.deliveredToday).toBe(0);
    expect(stats.todayRevenue).toBe(50);
    expect(computeOrderDashboard(orders, now, { period: "all" }).received).toBe(2);
    expect(computeOrderDashboard(orders, now, { period: "yesterday" }).received).toBe(2);
  });

  it("stage cards match the current status even when timestamps are from another day", () => {
    const orders = [
      order({ id: "r", status: "pending", createdAt: "2026-10-01T09:00:00+03:00" }),
      order({ id: "p1", status: "preparing", createdAt: "2026-10-07T09:00:00+03:00", preparationStartedAt: "2026-10-07T09:05:00+03:00" }),
      order({ id: "p2", status: "in_progress", createdAt: "2026-10-05T09:00:00+03:00" }),
      order({ id: "rd", status: "ready", createdAt: "2026-10-06T09:00:00+03:00", readyAt: "2026-10-06T09:20:00+03:00" }),
      // Moved on: was preparing/ready earlier today but is delivered or cancelled now.
      order({ id: "d", status: "delivered", createdAt: "2026-10-07T08:00:00+03:00", preparationStartedAt: "2026-10-07T08:05:00+03:00", readyAt: "2026-10-07T08:15:00+03:00", deliveredAt: "2026-10-07T08:30:00+03:00" }),
      order({ id: "c", status: "cancelled", createdAt: "2026-10-07T08:00:00+03:00" }),
    ];
    for (const period of ["today", "7d", "all"] as const) {
      const stats = computeOrderDashboard(orders, now, { period });
      expect([stats.received, stats.preparing, stats.ready]).toEqual([1, 2, 1]);
    }
    expect(computeOrderDashboard(orders, now).deliveredToday).toBe(1);
    expect(computeOrderDashboard(orders, now, { period: "yesterday" }).deliveredToday).toBe(0);
  });

  it("keeps stuck active orders in overdue even when they are not from today", () => {
    const stuck = order({
      id: "stuck",
      status: "preparing",
      createdAt: "2026-10-03T13:04:00+03:00",
      preparationStartedAt: "2026-10-03T13:10:00+03:00",
    });
    expect(overdueLevel(stuck, now.getTime())).toBe("critical");
    expect(computeOrderDashboard([stuck], now).overdue).toBe(1);
    expect(computeOrderDashboard([stuck], now).preparing).toBe(1);
    expect(computeOrderDashboard([stuck], now, { period: "all" }).preparing).toBe(1);
  });

  it("counts a delivered history order on its delivery day and ignores a pending payment", () => {
    const delivered = order({
      id: "delivered-today",
      status: "delivered",
      paymentStatus: "pending",
      paymentMethod: "cash",
      createdAt: "2026-10-03T13:04:00+03:00",
      deliveredAt: "2026-10-07T09:00:00+03:00",
      total: 80,
    });
    const stats = computeOrderDashboard([delivered], now);
    expect(stats.deliveredToday).toBe(1);
    expect(stats.received).toBe(0);
    expect(stats.todayRevenue).toBe(0);
    expect(computeOrderDashboard([delivered], now, { period: "yesterday" }).deliveredToday).toBe(0);
  });

  it("uses a verified card payment once and subtracts a refund", () => {
    const card = order({
      id: "card-1",
      status: "delivered",
      paymentStatus: "pending",
      paymentMethod: "card",
      createdAt: "2026-10-07T08:00:00+03:00",
      deliveredAt: "2026-10-07T08:20:00+03:00",
      total: 40,
    });
    const stats = computeOrderDashboard([card, card], now, {
      payments: [
        { orderId: "card-1", status: "paid", amount: 40, paidAt: "2026-10-07T08:05:00+03:00", provider: "HYP" },
        { orderId: "card-1", status: "paid", amount: 40, paidAt: "2026-10-07T08:05:00+03:00", provider: "HYP", refundAmount: 10 },
      ],
    });
    expect(stats.loaded).toBe(2);
    expect(stats.received).toBe(0);
    expect(stats.cardRevenue).toBe(30);
    expect(stats.cashRevenue).toBe(0);
    expect(stats.todayRevenue).toBe(30);
  });

  it("shows unpaid cash orders as awaiting payment, separately from paid revenue", () => {
    const delivered = order({
      id: "cash-delivered",
      status: "delivered",
      paymentMethod: "cash",
      createdAt: "2026-10-07T08:00:00+03:00",
      deliveredAt: "2026-10-07T08:30:00+03:00",
      total: 42,
    });
    const preparing = order({ id: "cash-prep", status: "preparing", paymentMethod: "cash", createdAt: "2026-10-07T09:00:00+03:00", total: 18 });
    const yesterday = order({ id: "cash-old", status: "delivered", paymentMethod: "cash", createdAt: "2026-10-06T09:00:00+03:00", total: 30 });
    const cardPending = order({ id: "card-pending", status: "received", paymentMethod: "card", createdAt: "2026-10-07T09:00:00+03:00" });
    const cancelled = order({ id: "cash-cancelled", status: "cancelled", paymentMethod: "cash", createdAt: "2026-10-07T09:00:00+03:00" });
    const test = order({ id: "cash-test", status: "pending", paymentMethod: "cash", isTestOrder: true, createdAt: "2026-10-07T09:00:00+03:00" });
    const all = [delivered, preparing, yesterday, cardPending, cancelled, test];

    const stats = computeOrderDashboard(all, now, { payments: [] });
    expect(stats.todayRevenue).toBe(0);
    expect(stats.pendingRevenue).toBe(60);
    expect(stats.pendingCount).toBe(2);
    expect(computeOrderDashboard(all, now, { period: "7d", payments: [] }).pendingRevenue).toBe(90);

    expect(isAwaitingCashPayment(delivered)).toBe(true);
    expect(isAwaitingCashPayment(cardPending)).toBe(false);
    expect(isAwaitingCashPayment(cancelled)).toBe(false);
    expect(isAwaitingCashPayment(test)).toBe(false);
    expect(isAwaitingCashPayment({ ...delivered, paymentMethod: undefined })).toBe(true);
    expect(isAwaitingCashPayment({ ...delivered, paymentProvider: "HYP" })).toBe(false);

    // After "cash payment received" the order moves from pending to paid revenue.
    const paid = { ...delivered, paymentStatus: "paid" as const, paidAt: "2026-10-07T08:31:00+03:00" };
    const after = computeOrderDashboard([paid, preparing], now, { payments: [] });
    expect(isAwaitingCashPayment(paid)).toBe(false);
    expect(after.cashRevenue).toBe(42);
    expect(after.todayRevenue).toBe(42);
    expect(after.pendingRevenue).toBe(18);
    expect(after.pendingCount).toBe(1);
  });

  it("keeps cash separate and drops cancelled or pending charges", () => {
    const cash = order({
      id: "cash-1",
      status: "delivered",
      paymentStatus: "paid",
      paymentMethod: "cash",
      paidAt: "2026-10-07T11:00:00+03:00",
      deliveredAt: "2026-10-07T11:10:00+03:00",
      total: 25,
    });
    const cancelled = order({
      id: "cancelled-paid",
      status: "cancelled",
      paymentStatus: "paid",
      paymentMethod: "card",
      paidAt: "2026-10-07T11:00:00+03:00",
      total: 25,
    });
    const waiting = order({
      id: "waiting",
      status: "delivered",
      paymentStatus: "pending",
      paymentMethod: "card",
      deliveredAt: "2026-10-07T11:00:00+03:00",
      total: 25,
    });
    const stats = computeOrderDashboard([cash, cancelled, waiting], now, { payments: [] });
    expect(stats.cashRevenue).toBe(25);
    expect(stats.cardRevenue).toBe(0);
    expect(stats.todayRevenue).toBe(25);
    expect(stats.deliveredToday).toBe(2);
  });

  it("shows no average when preparation did not actually start", () => {
    const guessed = order({
      id: "guess",
      status: "delivered",
      createdAt: "2026-10-07T08:00:00+03:00",
      readyAt: "2026-10-07T09:00:00+03:00",
      deliveredAt: "2026-10-07T09:10:00+03:00",
    });
    const measured = order({
      id: "measured",
      status: "delivered",
      createdAt: "2026-10-07T08:00:00+03:00",
      preparationStartedAt: "2026-10-07T08:10:00+03:00",
      readyAt: "2026-10-07T08:25:00+03:00",
      deliveredAt: "2026-10-07T08:40:00+03:00",
    });
    expect(computeOrderDashboard([guessed], now).averagePrepMinutes).toBeNull();
    expect(computeOrderDashboard([measured], now).averagePrepMinutes).toBe(15);
    expect(computeOrderDashboard([measured], now, { payments: null }).todayRevenue).toBeNull();
  });
});

describe("jerusalem business day", () => {
  it("uses Asia/Jerusalem day boundaries instead of UTC", () => {
    const now = new Date("2026-10-07T00:30:00+03:00");
    expect(jerusalemDayBounds(now).day).toBe("2026-10-07");
    expect(isJerusalemToday("2026-10-06T22:10:00.000Z", now)).toBe(true);
    expect(isJerusalemToday("2026-10-06T20:00:00.000Z", now)).toBe(false);
  });
});

describe("stage timer", () => {
  it("uses preparationStartedAt rather than createdAt for preparing age", () => {
    const started = order({
      id: "prep",
      status: "preparing",
      createdAt: "2026-10-07T08:00:00+03:00",
      preparationStartedAt: "2026-10-07T09:50:00+03:00",
    });
    const now = new Date("2026-10-07T10:00:00+03:00").getTime();
    expect(Math.round(stageAgeMs(started, now) / 60_000)).toBe(10);
  });
});

describe("overdue email window", () => {
  it("does not email ancient stuck orders", () => {
    const ancient = order({
      id: "ancient",
      status: "pending",
      createdAt: "2026-10-03T13:04:00+03:00",
    });
    const now = new Date("2026-10-07T10:00:00+03:00").getTime();
    expect(overdueLevel(ancient, now)).toBe("critical");
    expect(shouldSendCriticalEmail(ancient, now)).toBe(false);
  });
});
