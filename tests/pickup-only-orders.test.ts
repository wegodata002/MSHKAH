import { describe, expect, it } from "vitest";
import { forcePickupForNewOrder } from "@/lib/orders/fulfillment";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Oct 29 policy update: pickup OR delivery is allowed.
 * Delivery surcharge stays 0 (no fee change vs this production build).
 */
describe("new order fulfillment", () => {
  it("allows delivery type/address and keeps delivery fee at 0", () => {
    const result = forcePickupForNewOrder({
      subtotal: 100,
      discount: 10,
      delivery: 15,
      total: 105,
      orderType: "delivery",
      deliveryAddress: "Some street 1",
    });

    expect(result.orderType).toBe("delivery");
    expect(result.delivery).toBe(0);
    expect(result.deliveryAddress).toBe("Some street 1");
    expect(result.total).toBe(90);
  });

  it("recalculates total from products only (fee stays 0)", () => {
    const result = forcePickupForNewOrder({
      subtotal: 30,
      delivery: 15,
      total: 45,
      orderType: "delivery",
    });
    expect(result.total).toBe(30);
    expect(result.delivery).toBe(0);
  });

  it("checkout offers pickup (with a time) and delivery (by area) from the settings", () => {
    const checkout = readFileSync(
      resolve(process.cwd(), "src/app/checkout/page.tsx"),
      "utf8"
    );
    expect(checkout).toMatch(/useFulfillmentAvailability\(\)/);
    expect(checkout).toMatch(/<OrderTypePicker/);
    expect(checkout).toMatch(/type: "delivery", zoneId: deliveryZone\.id, address: address\.trim\(\)/);
    expect(checkout).toMatch(/type: "pickup", pickupTime/);
    // The old fixed "pickup only" note is gone from the cart.
    const cart = readFileSync(resolve(process.cwd(), "src/features/cart/cart-panel.tsx"), "utf8");
    expect(cart).not.toMatch(/cart\.pickupOnly/);
  });

  it("createOrder still normalizes fulfillment fields", () => {
    const service = readFileSync(
      resolve(process.cwd(), "src/services/orderService.ts"),
      "utf8"
    );
    expect(service).toMatch(/forcePickupForNewOrder/);
    expect(service).toMatch(/deliveryAddress/);
  });
});
