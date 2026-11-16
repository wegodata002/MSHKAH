/**
 * Fulfillment for storefront orders.
 * Delivery fee stays at 0 (this Oct 29 build has no delivery surcharge).
 */

export const NEW_ORDER_FULFILLMENT = "pickup" as const;

export type OrderFulfillmentType = "pickup" | "delivery";

/** Normalize fulfillment fields for newly created orders only. */
export function forcePickupForNewOrder<
  T extends {
    orderType?: OrderFulfillmentType;
    delivery?: number;
    deliveryAddress?: string;
    subtotal: number;
    discount?: number;
    total: number;
  },
>(input: T): T & {
  orderType: OrderFulfillmentType;
  delivery: 0;
  deliveryAddress: string | undefined;
} {
  const discount = input.discount ?? 0;
  const orderType: OrderFulfillmentType =
    input.orderType === "delivery" ? "delivery" : "pickup";
  const deliveryAddress =
    orderType === "delivery" ? input.deliveryAddress?.trim() || undefined : undefined;
  const total = Math.max(input.subtotal - discount, 0.01);

  return {
    ...input,
    orderType,
    delivery: 0,
    deliveryAddress,
    total,
  };
}
