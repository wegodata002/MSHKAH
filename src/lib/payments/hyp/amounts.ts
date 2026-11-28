import { couponRate } from "@/lib/orders/coupons";

/** Format the authoritative order total for Hyp Pay Amount (up to 2 decimal digits). */
export function formatHypAmount(total: number): string {
  if (!Number.isFinite(total)) return "";
  return (Math.round(total * 100) / 100).toFixed(2);
}

export function parseHypAmount(value: string | number | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

export function amountsMatch(expected: number, returned: string | number): boolean {
  const actual = parseHypAmount(returned);
  if (actual == null) return false;
  return Math.abs(expected - actual) < 0.009;
}

function money(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Sum stored lines. Ignores a manipulated `total` field. */
export function amountFromOrderItems(order: {
  items?: Array<{ price?: unknown; quantity?: unknown }>;
  discount?: unknown;
  /** Club points paid with (only compared here; the charge takes them from the server ledger). */
  pointsDiscount?: unknown;
  delivery?: unknown;
}): number {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsSum = items.reduce((sum, item) => {
    const qty = money(item.quantity);
    if (qty <= 0) return sum;
    return sum + money(item.price) * qty;
  }, 0);
  const discount = Math.max(0, money(order.discount));
  const points = Math.max(0, money(order.pointsDiscount));
  const delivery = Math.max(0, money(order.delivery));
  return Math.max(Math.round((itemsSum - discount - points + delivery) * 100) / 100, 0);
}

/**
 * Final HYP charge from a server-computed catalog sum.
 * The discount comes ONLY from the order's coupon code; any client-supplied
 * `discount` amount on the order is ignored.
 */
export function chargeFromCatalogSum(
  catalogSum: number,
  order: { couponCode?: unknown; delivery?: unknown },
  /** Rate of a personal club code, checked on the server against this order (see process.ts). */
  personalCouponRate?: number,
  /**
   * Store coupons (see process.ts): `discount` = the amount the server priced and saved with the order
   * (orderCoupons); `rate` = an order priced before that record existed (MISHKAT10 as it works now).
   */
  store?: { discount: number } | { rate: number },
  /**
   * Club points held by this order (server ledger, never the order document), in ₪. They pay for the
   * products left after the coupon only (never more), not the delivery fee.
   */
  heldPointsDiscount = 0,
  /**
   * The part of the products a coupon may take off (bundles without "coupons allowed" left out), as
   * priced by price-lines. Left out: all the products.
   */
  couponBase?: number
): { amount: number; discount: number; subtotal: number; pointsDiscount: number } {
  const subtotal = money(catalogSum);
  const base = couponBase === undefined ? subtotal : Math.min(subtotal, Math.max(0, money(couponBase)));
  let discount: number;
  if (personalCouponRate !== undefined) discount = money(base * personalCouponRate);
  else if (store && "discount" in store) discount = Math.min(money(Math.max(0, store.discount)), base);
  else if (store) discount = money(base * store.rate);
  else discount = money(base * couponRate(order.couponCode));
  const delivery = Math.max(0, money(order.delivery));
  const pointsDiscount = Math.min(money(Math.max(0, heldPointsDiscount)), Math.max(0, money(subtotal - discount)));
  const amount = Math.max(money(subtotal - discount - pointsDiscount + delivery), 0);
  return { amount, discount, subtotal, pointsDiscount };
}

/**
 * Never trust a client-supplied checkout total.
 * Prefer the sum of stored line items; fall back to order.total only if lines are empty.
 */
export function authoritativeOrderAmount(order: {
  total?: unknown;
  items?: Array<{ price?: unknown; quantity?: unknown }>;
  discount?: unknown;
  pointsDiscount?: unknown;
  delivery?: unknown;
}): number {
  const fromItems = amountFromOrderItems(order);
  if (fromItems > 0) return fromItems;
  return money(order.total);
}
