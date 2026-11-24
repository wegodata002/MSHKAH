import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { forcePickupForNewOrder } from "@/lib/orders/fulfillment";
import { kitchenTicketHtml } from "@/lib/orders/kitchen-ticket";
import { buildReceiptModelFromOrder } from "@/lib/print-jobs/receipt-model";
import type { Order } from "@/types";

describe("checkout fulfillment (pickup + delivery, fee stays 0)", () => {
  it("keeps delivery type and address, forces delivery fee to 0", () => {
    const result = forcePickupForNewOrder({
      subtotal: 100,
      discount: 10,
      delivery: 15,
      total: 105,
      orderType: "delivery",
      deliveryAddress: "  Some street 1  ",
    });

    expect(result.orderType).toBe("delivery");
    expect(result.delivery).toBe(0);
    expect(result.deliveryAddress).toBe("Some street 1");
    expect(result.total).toBe(90);
  });

  it("keeps pickup and clears address / fee", () => {
    const result = forcePickupForNewOrder({
      subtotal: 30,
      delivery: 15,
      total: 45,
      orderType: "pickup",
      deliveryAddress: "should-clear",
    });
    expect(result.orderType).toBe("pickup");
    expect(result.delivery).toBe(0);
    expect(result.deliveryAddress).toBeUndefined();
    expect(result.total).toBe(30);
  });

  it("checkout creates orders through the server, not by writing to Firestore", () => {
    const checkout = readFileSync(
      resolve(process.cwd(), "src/app/checkout/page.tsx"),
      "utf8"
    );
    const client = readFileSync(
      resolve(process.cwd(), "src/lib/orders/submit-order-client.ts"),
      "utf8"
    );
    expect(checkout).toMatch(/submitOrder\(/);
    expect(checkout).not.toMatch(/createOrderFromCart/);
    expect(client).toMatch(/\/api\/orders\/create/);
    // The browser sends no prices: only product ids, quantities and add-ons.
    const cartMapper = client.slice(client.indexOf("export function cartToOrderItems"), client.indexOf("export async function submitOrder"));
    expect(cartMapper).toMatch(/productId/);
    expect(cartMapper).not.toMatch(/unitPrice|subtotal|\bprice:|basePrice/);
  });

  it("createOrder still normalizes via forcePickupForNewOrder", () => {
    const service = readFileSync(
      resolve(process.cwd(), "src/services/orderService.ts"),
      "utf8"
    );
    expect(service).toMatch(/forcePickupForNewOrder/);
    expect(service).toMatch(/orderType/);
    expect(service).toMatch(/deliveryAddress/);
  });
});

describe("print labels without printer / Firebase", () => {
  const baseOrder = {
    id: "dry-1",
    orderNumber: "MC-DRY-1",
    customerId: "guest",
    customerName: "زبون تجريبي",
    customerPhone: "0500000000",
    items: [
      {
        productId: "p1",
        productName: "كرواسون",
        quantity: 1,
        price: 36,
      },
    ],
    status: "pending" as const,
    subtotal: 36,
    discount: 0,
    delivery: 0,
    total: 36,
    paymentMethod: "cash",
    paymentStatus: "pending" as const,
    createdAt: "2026-10-29T12:00:00+02:00",
    locale: "ar" as const,
  };

  it("kitchen ticket shows استلام ذاتي for pickup", () => {
    const html = kitchenTicketHtml({
      ...baseOrder,
      orderType: "pickup",
    } as Order);
    expect(html).toContain("استلام ذاتي");
    expect(html).not.toContain("العنوان");
  });

  it("kitchen ticket shows توصيل + address for delivery", () => {
    const html = kitchenTicketHtml({
      ...baseOrder,
      orderType: "delivery",
      deliveryAddress: "شارع النور 12",
    } as Order);
    expect(html).toContain("توصيل");
    expect(html).toContain("العنوان");
    expect(html).toContain("شارع النور 12");
  });

  it("receipt model uses delivery label and address", () => {
    const model = buildReceiptModelFromOrder({
      orderNumber: baseOrder.orderNumber,
      customerName: baseOrder.customerName,
      customerPhone: baseOrder.customerPhone,
      items: baseOrder.items,
      notes: "",
      total: baseOrder.total,
      subtotal: baseOrder.subtotal,
      discount: 0,
      paymentMethod: "cash",
      locale: "ar",
      createdAt: baseOrder.createdAt,
      orderType: "delivery",
      deliveryAddress: "شارع النور 12",
    });
    expect(model.pickupLabel).toBe("توصيل");
    expect(model.orderType).toBe("delivery");
    expect(model.deliveryAddress).toBe("شارع النور 12");
  });
});
