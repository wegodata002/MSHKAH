/**
 * Single source of truth for storefront coupon codes.
 * Used by the cart (display) and by the server when computing the HYP charge,
 * so the server never has to trust a client-supplied discount amount.
 */
export const COUPON_RATES: Readonly<Record<string, number>> = {
  MISHKAT10: 0.1,
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

/**
 * "login_required" / "used" / "expired": personal club codes (checked on the server).
 * "members_only" / "already_used" / "min_order": store coupons from Admin → Coupons (checked on the server).
 */
export type CouponCheck =
  | "ok"
  | "invalid"
  | "too_large"
  | "login_required"
  | "used"
  | "expired"
  | "members_only"
  | "already_used"
  | "min_order";

/** Message key for a coupon that cannot be applied. */
export function couponMessageKey(check: Exclude<CouponCheck, "ok">): string {
  switch (check) {
    case "too_large":
      return "cart.couponTooLarge";
    case "login_required":
      return "cart.couponLogin";
    case "used":
      return "cart.couponUsed";
    case "expired":
      return "cart.couponExpired";
    case "members_only":
      return "cart.couponMembersOnly";
    case "already_used":
      return "cart.couponAlreadyUsed";
    case "min_order":
      return "cart.couponMinOrder";
    default:
      return "cart.couponInvalid";
  }
}

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
