/**
 * Personal club coupons (pure; safe in the browser too).
 *
 * One document per code in `loyaltyCoupons/{code}`, always tied to one member:
 *   - "welcome": the 10% code for the first purchase since joining (30 days);
 *   - "manual":  later, created by the manager in the admin (percent, expiry, member).
 * The member page lists every coupon of the member, so manual coupons show up there with no
 * extra work. Only the server reads or writes this collection.
 */

export type LoyaltyCouponKind = "welcome" | "manual";
export type LoyaltyCouponStatus = "active" | "redeemed" | "void";
export type LoyaltyCouponChannel = "web" | "pos";

export interface LoyaltyCoupon {
  /** Same as `code` (the document id). */
  id: string;
  code: string;
  memberId: string;
  kind: LoyaltyCouponKind;
  /** Whole percent, e.g. 10. */
  percent: number;
  status: LoyaltyCouponStatus;
  /** Only valid while the member has no completed (paid, not cancelled) order other than this one. */
  firstPurchaseOnly: boolean;
  expiresAt: string;
  createdAt: string;
  /** "system" for the welcome code; the manager's email for manual coupons. */
  createdBy: string;
  /** The order the code is used on (null after a cancelled order gave it back). */
  orderId?: string | null;
  redeemedAt?: string | null;
  channel?: LoyaltyCouponChannel | null;
  restoredAt?: string;
  updatedAt?: string;
}

/** What the member sees: active / used / expired. */
export type CouponState = "active" | "used" | "expired";

export interface LoyaltyCouponView {
  code: string;
  kind: LoyaltyCouponKind;
  percent: number;
  firstPurchaseOnly: boolean;
  expiresAt: string;
  state: CouponState;
}

export const WELCOME_COUPON_PERCENT = 10;
export const WELCOME_COUPON_DAYS = 30;
/** A code given back after a cancelled order stays valid at least this long. */
export const RESTORE_MIN_DAYS = 3;
/** An unpaid card order frees its code after this long (the customer left the payment page). */
export const CARD_HOLD_MINUTES = 30;

const DAY_MS = 24 * 60 * 60 * 1000;
/** MK-XXXX-XXXX, without look-alike characters (no 0/O, 1/I). */
export const PERSONAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PERSONAL_CODE_REGEX = /^MK-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function isPersonalCouponCode(code: unknown): boolean {
  return typeof code === "string" && PERSONAL_CODE_REGEX.test(code.trim().toUpperCase());
}

/** Builds a code from 8 random indexes (the server passes crypto-random ones). */
export function personalCodeFromIndexes(indexes: number[]): string {
  const chars = indexes.slice(0, 8).map((i) => PERSONAL_CODE_ALPHABET[Math.abs(i) % PERSONAL_CODE_ALPHABET.length]);
  return `MK-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
}

export function addDaysIso(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

/** New expiry for a code given back after a cancellation: the original one, but at least 3 days from now. */
export function restoredExpiry(expiresAt: string, now: Date): string {
  const minimum = now.getTime() + RESTORE_MIN_DAYS * DAY_MS;
  const original = Date.parse(expiresAt);
  return new Date(Number.isFinite(original) ? Math.max(original, minimum) : minimum).toISOString();
}

/** Order createdAt as ms: Firestore Timestamp, Date, ISO string or ms. */
export function orderCreatedMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) return value.getTime();
  const maybe = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
  if (typeof maybe.toMillis === "function") return maybe.toMillis();
  const seconds = maybe.seconds ?? maybe._seconds;
  return typeof seconds === "number" ? seconds * 1000 : null;
}

export type HoldingOrder = {
  status?: unknown;
  paymentStatus?: unknown;
  paymentCollection?: unknown;
  createdAt?: unknown;
} | null;

/**
 * Whether the order a code is held by no longer holds it: gone, cancelled, or a card order still
 * unpaid after 30 minutes (left the payment page / payment failed).
 */
export function holdIsReleased(order: HoldingOrder, now: Date): boolean {
  if (!order) return true;
  if (order.status === "cancelled") return true;
  if (order.paymentStatus === "paid") return false;
  if (order.paymentCollection !== "online") return false;
  const created = orderCreatedMs(order.createdAt);
  return created !== null && now.getTime() - created >= CARD_HOLD_MINUTES * 60_000;
}

/**
 * What the member sees for a coupon.
 * `completedOrderIds`: the member's paid, not cancelled orders since joining.
 * `holdReleased`: for a used code, whether its order no longer holds it (see holdIsReleased).
 */
export function couponState(
  coupon: Pick<LoyaltyCoupon, "status" | "expiresAt" | "firstPurchaseOnly" | "orderId">,
  input: { now: Date; completedOrderIds: ReadonlySet<string>; holdReleased?: boolean }
): CouponState {
  if (coupon.status === "void") return "expired";
  const held = coupon.status === "redeemed" && !input.holdReleased;
  if (held) return "used";
  const expires = Date.parse(coupon.expiresAt);
  if (!Number.isFinite(expires) || expires <= input.now.getTime()) return "expired";
  if (coupon.firstPurchaseOnly) {
    for (const id of input.completedOrderIds) {
      if (id !== coupon.orderId) return "expired";
    }
  }
  return "active";
}

export function couponView(coupon: LoyaltyCoupon, state: CouponState): LoyaltyCouponView {
  return {
    code: coupon.code,
    kind: coupon.kind,
    percent: coupon.percent,
    firstPurchaseOnly: coupon.firstPurchaseOnly,
    expiresAt: coupon.expiresAt,
    state,
  };
}

/** Thrown inside the order transaction when the code was taken in the meantime. */
export class CouponUnavailableError extends Error {
  constructor(readonly reason: "used" | "expired" | "invalid") {
    super(`coupon_${reason}`);
    this.name = "CouponUnavailableError";
  }
}
