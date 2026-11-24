/**
 * Single source of truth for storefront coupon codes.
 * Used by the cart (display) and by the server when computing the HYP charge,
 * so the server never has to trust a client-supplied discount amount.
 */
export const COUPON_RATES: Readonly<Record<string, number>> = {
  MISHKAT10: 0.1,
  WELCOME15: 0.15,
};

export function normalizeCouponCode(code: unknown): string {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

/** Discount rate (0–1) for a coupon code; 0 for empty or unknown codes. */
export function couponRate(code: unknown): number {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return 0;
  return Object.prototype.hasOwnProperty.call(COUPON_RATES, normalized)
    ? COUPON_RATES[normalized]!
    : 0;
}

export type CouponCheck = "ok" | "invalid" | "too_large";

/**
 * Why a coupon can or cannot be applied: unknown code → "invalid"; a discount that would
 * cover the whole order (or more) → "too_large".
 */
export function checkCoupon(code: unknown, subtotal: number): CouponCheck {
  const rate = couponRate(code);
  if (rate <= 0) return "invalid";
  if (rate >= 1 || (subtotal > 0 && subtotal * rate >= subtotal)) return "too_large";
  return "ok";
}
