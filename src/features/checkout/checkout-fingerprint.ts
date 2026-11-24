import type { CartItem } from "@/types";

/**
 * A string that changes whenever anything that goes into the order changes (cart lines and
 * quantities, add-ons, notes, coupon, order type, area, address, pickup time, payment method).
 * The checkout forgets a created-but-unpaid card order when it changes. Pure.
 */
export function checkoutFingerprint(input: {
  items: CartItem[];
  couponCode: string;
  orderType: string;
  zoneId: string;
  address: string;
  pickupTime: string;
  payment: string;
}): string {
  const lines = input.items.map((item) => [
    item.lineId,
    item.product.id,
    item.quantity,
    item.unitPrice,
    item.notes?.trim() ?? "",
    item.selections.map((s) => `${s.groupId}:${s.optionId}:${s.quantity}`).join(","),
  ]);
  return JSON.stringify([lines, input.couponCode, input.orderType, input.zoneId, input.address, input.pickupTime, input.payment]);
}
