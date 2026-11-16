import type { Order } from "@/types";

/** Legacy orders without orderType default to pickup. */
export function resolveOrderType(order: Order): "pickup" | "delivery" {
  if (order.orderType === "delivery") return "delivery";
  if (order.orderType === "pickup") return "pickup";
  if (order.deliveryAddress?.trim()) return "delivery";
  return "pickup";
}

export function orderTypeLabelAr(orderType: "pickup" | "delivery"): string {
  return orderType === "delivery" ? "توصيل" : "استلام ذاتي";
}

export function formatDeliveryAddressParts(parts: {
  city: string;
  street: string;
  building: string;
}): string {
  return [parts.city.trim(), parts.street.trim(), parts.building.trim()]
    .filter(Boolean)
    .join("، ");
}
