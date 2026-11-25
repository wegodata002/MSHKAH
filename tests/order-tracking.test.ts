// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTrackingToken, readTrackingToken, trackingPath } from "@/lib/orders/tracking-token";
import {
  awaitingCardPayment,
  buildTrackingView,
  isTrackingActive,
  trackingHeadline,
  trackingSteps,
} from "@/lib/orders/tracking-view";
import { handleTrackingLookup, normalizeOrderNumber, type TrackingLookupDeps } from "@/lib/orders/tracking-lookup";
import { MY_ORDERS_KEEP_MS, pruneMyOrders } from "@/lib/orders/my-orders";
import { renderCustomerPaymentSuccessEmail } from "@/lib/email/customer-payment-templates";
import type { Order } from "@/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function order(overrides: Partial<Order & { outForDeliveryAt: string | null; tableId: string | null }> = {}) {
  return {
    id: "AbCdEfGhIjKlMnOpQrSt",
    orderNumber: "MC-2026-AB12CD34",
    customerId: "cust-1",
    customerName: "Yousef H.",
    customerFullName: "Yousef Haddad",
    customerPhone: "050-123-4567",
    customerEmail: "yousef@example.com",
    deliveryAddress: "12 Olive St, entrance B",
    notes: "ring twice",
    status: "pending",
    items: [
      { productId: "p1", productName: "Cappuccino", quantity: 2, price: 14, modifiers: [{ groupId: "g", groupName: "Milk", optionId: "oat", optionName: "Oat milk", priceDelta: 3, quantity: 1 }] },
    ],
    subtotal: 28,
    discount: 0,
    delivery: 15,
    total: 43,
    paymentMethod: "cash",
    paymentStatus: "pending",
    orderType: "delivery",
    deliveryZoneName: "Ein Mahel",
    createdAt: "2026-11-25T10:21:00.000Z",
    receivedAt: "2026-11-25T10:21:00.000Z",
    ...overrides,
  } as Order & { outForDeliveryAt?: string | null; tableId?: string | null };
}

describe("tracking link", () => {
  it("round-trips the order id and rejects anything changed", () => {
    const token = createTrackingToken("AbCdEfGhIjKlMnOpQrSt");
    expect(readTrackingToken(token)).toBe("AbCdEfGhIjKlMnOpQrSt");
    expect(trackingPath(token)).toBe(`/orders/${token}`);
    // Another order id with the same signature, a changed signature, junk.
    const [, sig] = token.split(".");
    expect(readTrackingToken(`ZZCdEfGhIjKlMnOpQrSt.${sig}`)).toBeNull();
    expect(readTrackingToken(`${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect(readTrackingToken("AbCdEfGhIjKlMnOpQrSt")).toBeNull();
    expect(readTrackingToken("")).toBeNull();
    expect(readTrackingToken(null)).toBeNull();
    expect(readTrackingToken("../../etc.passwd")).toBeNull();
  });
});

describe("what the customer's tracking page receives", () => {
  it("no phone, email, address, full name, notes or courier", () => {
    const json = JSON.stringify(buildTrackingView(order()));
    for (const secret of ["050-123-4567", "yousef@example.com", "Olive St", "Haddad", "ring twice", "cust-1", "AbCdEfGhIjKlMnOpQrSt"]) {
      expect(json, secret).not.toContain(secret);
    }
    const view = buildTrackingView(order());
    expect(view).toMatchObject({ orderNumber: "MC-2026-AB12CD34", orderType: "delivery", total: 43, deliveryZoneName: "Ein Mahel", payment: "cash" });
    expect(view.items[0]).toEqual({ name: "Cappuccino", quantity: 2, extras: ["Oat milk"], total: 28 });
  });
});

describe("tracking steps", () => {
  const states = (o: ReturnType<typeof order>) => trackingSteps(buildTrackingView(o)).map((s) => `${s.key}:${s.state}`);

  it("pickup: received → preparing → ready → picked up", () => {
    expect(states(order({ orderType: "pickup" }))).toEqual(["received:current", "preparing:todo", "ready:todo", "delivered:todo"]);
    expect(states(order({ orderType: "pickup", status: "ready", readyAt: "2026-11-25T10:41:00.000Z" }))).toEqual([
      "received:done",
      "preparing:done",
      "ready:current",
      "delivered:todo",
    ]);
    expect(trackingHeadline(buildTrackingView(order({ orderType: "pickup", status: "ready" })))).toBe("ready_pickup");
    expect(trackingHeadline(buildTrackingView(order({ orderType: "pickup", status: "delivered" })))).toBe("picked_up");
  });

  it("delivery: ready waits for the courier, then out for delivery, then delivered", () => {
    expect(states(order({ status: "ready" }))).toEqual(["received:done", "preparing:done", "ready:current", "out_for_delivery:todo", "delivered:todo"]);
    expect(trackingHeadline(buildTrackingView(order({ status: "ready" })))).toBe("ready_delivery");
    const out = order({ status: "ready", outForDeliveryAt: "2026-11-25T10:48:00.000Z" });
    expect(states(out)).toEqual(["received:done", "preparing:done", "ready:done", "out_for_delivery:current", "delivered:todo"]);
    expect(trackingHeadline(buildTrackingView(out))).toBe("out_for_delivery");
    expect(trackingSteps(buildTrackingView(out))[3]?.at).toBe("2026-11-25T10:48:00.000Z");
    expect(states(order({ status: "delivered" })).every((s) => s.endsWith(":done"))).toBe(true);
    expect(trackingHeadline(buildTrackingView(order({ status: "delivered" })))).toBe("delivered");
  });

  it("older statuses map onto the steps ('confirmed' = received, 'preparing')", () => {
    expect(states(order({ status: "confirmed" }))[0]).toBe("received:current");
    expect(states(order({ status: "preparing" })).slice(0, 2)).toEqual(["received:done", "preparing:current"]);
  });

  it("dine in: ready to serve → served", () => {
    const view = buildTrackingView(order({ orderType: "dine_in" as never, status: "ready", tableId: "inside-3" }));
    expect(trackingSteps(view).map((s) => s.key)).toEqual(["received", "preparing", "ready", "delivered"]);
    expect(trackingHeadline(view)).toBe("ready_table");
    expect(view.tableId).toBe("inside-3");
  });

  it("cancelled: no steps, red headline, polling stops", () => {
    const view = buildTrackingView(order({ status: "cancelled" }));
    expect(trackingSteps(view)).toEqual([]);
    expect(trackingHeadline(view)).toBe("cancelled");
    expect(isTrackingActive(view)).toBe(false);
    expect(isTrackingActive(buildTrackingView(order({ status: "delivered" })))).toBe(false);
    expect(isTrackingActive(buildTrackingView(order({ status: "preparing" })))).toBe(true);
  });

  it("card order not paid yet is flagged", () => {
    expect(awaitingCardPayment(buildTrackingView(order({ paymentMethod: "card", paymentProvider: "HYP", paymentStatus: "pending" })))).toBe(true);
    expect(awaitingCardPayment(buildTrackingView(order({ paymentMethod: "card", paymentProvider: "HYP", paymentStatus: "paid" })))).toBe(false);
    expect(awaitingCardPayment(buildTrackingView(order({ paymentMethod: "cash" })))).toBe(false);
  });
});

describe("find my order (order number + full phone)", () => {
  function deps(overrides: Partial<TrackingLookupDeps> = {}): TrackingLookupDeps & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      rateLimit: async (key) => {
        calls.push(key);
        return true;
      },
      findOrdersByNumber: async (n) => (n === "MC-2026-AB12CD34" ? [{ id: "AbCdEfGhIjKlMnOpQrSt", customerPhone: "050-123-4567" }] : []),
      createToken: (id) => `token-for-${id}`,
      ...overrides,
    };
  }

  it("matches the phone in any common format", async () => {
    for (const phone of ["0501234567", "050-123-4567", "+972 50-123-4567", "972501234567"]) {
      const result = await handleTrackingLookup({ orderNumber: " #mc-2026-ab12cd34 ", phone }, "1.2.3.4", deps());
      expect(result, phone).toEqual({ status: 200, body: { ok: true, token: "token-for-AbCdEfGhIjKlMnOpQrSt" } });
    }
  });

  it("same answer for a wrong phone and an unknown order", async () => {
    const wrongPhone = await handleTrackingLookup({ orderNumber: "MC-2026-AB12CD34", phone: "0529999999" }, "ip", deps());
    const unknown = await handleTrackingLookup({ orderNumber: "MC-2026-ZZZZZZZZ", phone: "0501234567" }, "ip", deps());
    expect(wrongPhone).toEqual(unknown);
    expect(wrongPhone.status).toBe(404);
  });

  it("rejects bad input before touching the database", async () => {
    const d = deps();
    expect((await handleTrackingLookup({ orderNumber: "", phone: "0501234567" }, "ip", d)).status).toBe(400);
    expect((await handleTrackingLookup({ orderNumber: "MC-2026-AB12CD34", phone: "123" }, "ip", d)).status).toBe(400);
    expect((await handleTrackingLookup(null, "ip", d)).status).toBe(400);
    expect(d.calls).toEqual([]);
  });

  it("limits attempts per network address and per order number", async () => {
    const blockedIp = await handleTrackingLookup({ orderNumber: "MC-2026-AB12CD34", phone: "0501234567" }, "ip", deps({ rateLimit: async (key) => !key.includes("|ip|") }));
    expect(blockedIp).toEqual({ status: 429, body: { ok: false, code: "RATE_LIMITED" } });
    const blockedOrder = await handleTrackingLookup({ orderNumber: "MC-2026-AB12CD34", phone: "0501234567" }, "ip", deps({ rateLimit: async (key) => !key.includes("|order|") }));
    expect(blockedOrder.status).toBe(429);
    expect(normalizeOrderNumber("  #mc-2026-ab12 cd34")).toBe("MC-2026-AB12CD34");
  });
});

describe("my orders on this device", () => {
  it("keeps 30 days, newest first, one entry per order", () => {
    const now = Date.parse("2026-11-25T12:00:00Z");
    const kept = pruneMyOrders(
      [
        { token: "a", orderNumber: "MC-1", savedAt: now - 1000 },
        { token: "b", orderNumber: "MC-2", savedAt: now - MY_ORDERS_KEEP_MS - 1 },
        { token: "c", orderNumber: "MC-3", savedAt: now - 5000 },
        { token: "a", orderNumber: "MC-1", savedAt: now - 9000 },
        { token: 5, orderNumber: "bad", savedAt: now },
        null,
      ],
      now
    );
    expect(kept.map((e) => e.token)).toEqual(["a", "c"]);
    expect(pruneMyOrders("junk", now)).toEqual([]);
  });
});

describe("links to the tracking page", () => {
  it("order create answer, card success redirect and confirmation email carry the link", () => {
    expect(read("src/app/api/orders/create/route.ts")).toMatch(/\{ \.\.\.result\.body, trackingToken \}/);
    expect(read("src/lib/payments/hyp/process.ts")).toMatch(/if \(trackingToken\) successParams\.set\("t", trackingToken\)/);
    const email = renderCustomerPaymentSuccessEmail(
      { orderId: "x", orderNumber: "MC-2026-AB12CD34", createdAt: "2026-11-25T10:21:00.000Z", customerName: "Y", items: [], total: 43, viewUrl: "" },
      "he",
      "https://mishkatcafe.dev/orders/tok.en"
    );
    expect(email.html).toContain('href="https://mishkatcafe.dev/orders/tok.en"');
    expect(email.html).toContain("מעקב אחרי ההזמנה");
    expect(email.text).toContain("https://mishkatcafe.dev/orders/tok.en");
  });

  it("customer pages: /orders lists device orders, /orders/<token> tracks; admin marks out for delivery", () => {
    expect(read("src/app/orders/page.tsx")).toMatch(/MyOrdersScreen/);
    expect(read("src/app/orders/[token]/page.tsx")).toMatch(/OrderTrackingScreen/);
    expect(read("src/features/orders/order-tracking-screen.tsx")).toMatch(/TRACKING_POLL_MS = 10_000/);
    expect(read("src/features/admin/orders/order-card.tsx")).toMatch(/t\("admin\.orders\.markOutForDelivery"\)/);
    expect(read("src/services/orderService.ts")).toMatch(/outForDeliveryAt: serverTimestamp\(\)/);
  });
});
