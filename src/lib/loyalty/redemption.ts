import type { LoyaltySettings } from "@/lib/loyalty/types";

/**
 * Paying with club points at checkout. Pure: the checkout (to show the choice) and the server (which
 * decides) use the same rules.
 *
 * Order of discounts: sale price → coupon → points. Points pay only for the products left after the
 * coupon (never the delivery fee), in whole points, within the club's minimum / maximum per order,
 * and at least ₪1 is always left to pay (a card charge cannot be 0). Off until the manager has set
 * and approved the point value and switched redemption on.
 */

export type RedemptionSettings = Pick<LoyaltySettings, "redemptionEnabled" | "pointValueMinor" | "pointValueApproved" | "redemptionMinPoints" | "redemptionMaxPoints">;

export type PointsRefusal =
  | "disabled"
  | "login_required"
  | "not_member"
  /** Table orders: no points (for now). */
  | "not_here"
  | "below_minimum"
  | "insufficient_balance"
  /** More than this order (or the club maximum) allows: `maxPoints` says how many. */
  | "too_many";

export const MIN_LEFT_TO_PAY_MINOR = 100;

/** Thrown inside the save transaction when the balance changed meanwhile (nothing is saved). */
export class PointsUnavailableError extends Error {
  constructor(readonly reason: "insufficient_balance" | "not_member") {
    super(`points ${reason}`);
  }
}

const toMinor = (ils: number) => (Number.isFinite(ils) ? Math.round(ils * 100) : 0);

export function redemptionReady(settings: RedemptionSettings | null | undefined): boolean {
  return Boolean(settings && settings.redemptionEnabled && settings.pointValueApproved && settings.pointValueMinor > 0);
}

/** The value of `points` in ₪. */
export function pointsValue(points: number, settings: Pick<RedemptionSettings, "pointValueMinor">): number {
  return Math.max(0, Math.floor(points)) * Math.max(0, settings.pointValueMinor) / 100;
}

/**
 * The most points this order can take: the balance, the club maximum, and what the products left
 * after the coupon are worth (keeping ₪1 to pay). Below the club minimum → 0 (no points on this order).
 */
export function maxRedeemablePoints(input: {
  balancePoints: number;
  settings: RedemptionSettings;
  /** Products after the sale and the coupon (₪). */
  productsAfterCoupon: number;
  /** The order total before points, delivery included (₪). */
  totalBeforePoints: number;
}): number {
  const { settings } = input;
  if (!redemptionReady(settings)) return 0;
  const value = settings.pointValueMinor;
  const capMinor = Math.min(toMinor(input.productsAfterCoupon), toMinor(input.totalBeforePoints) - MIN_LEFT_TO_PAY_MINOR);
  if (capMinor <= 0) return 0;
  const byOrder = Math.floor(capMinor / value);
  const byClub = settings.redemptionMaxPoints > 0 ? settings.redemptionMaxPoints : Number.MAX_SAFE_INTEGER;
  const points = Math.max(0, Math.min(Math.floor(input.balancePoints || 0), byClub, byOrder));
  return points >= Math.max(1, settings.redemptionMinPoints) ? points : 0;
}

/** The server's decision on the points asked for. */
export function checkRedemption(
  requested: number,
  ctx: { member: { status?: string; balancePoints?: number } | null; settings: RedemptionSettings; productsAfterCoupon: number; totalBeforePoints: number; dineIn: boolean }
): { ok: true; points: number; discount: number } | { ok: false; reason: PointsRefusal; maxPoints: number } {
  const points = Math.floor(requested);
  const refuse = (reason: PointsRefusal, maxPoints = 0) => ({ ok: false as const, reason, maxPoints });
  if (!redemptionReady(ctx.settings)) return refuse("disabled");
  if (ctx.dineIn) return refuse("not_here");
  if (!ctx.member) return refuse("login_required");
  if (ctx.member.status !== "active") return refuse("not_member");
  const balance = Math.max(0, Math.floor(ctx.member.balancePoints ?? 0));
  if (points > balance) return refuse("insufficient_balance", maxRedeemablePoints({ ...ctx, balancePoints: balance }));
  if (points < Math.max(1, ctx.settings.redemptionMinPoints)) return refuse("below_minimum");
  const max = maxRedeemablePoints({ balancePoints: balance, settings: ctx.settings, productsAfterCoupon: ctx.productsAfterCoupon, totalBeforePoints: ctx.totalBeforePoints });
  if (points > max) return refuse("too_many", max);
  return { ok: true, points, discount: pointsValue(points, ctx.settings) };
}

/** The order with the points taken off its total. Pure. */
export function applyPointsToOrder<T extends { total: number }>(order: T, points: number, discount: number): T & { pointsRedeemed: number; pointsDiscount: number } {
  return { ...order, pointsRedeemed: points, pointsDiscount: discount, total: Math.round((order.total - discount) * 100) / 100 };
}

/**
 * Admin: points still held by an order that was not paid (a card payment never finished). The manager
 * sees "points held (X)" and can cancel the order, which gives them back. Pure.
 */
export function pointsHeldOnOrder(order: {
  pointsRedeemed?: number;
  pointsReleasedAt?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  paymentProvider?: string;
}): number {
  const points = Math.max(0, Math.floor(Number(order.pointsRedeemed) || 0));
  if (points === 0 || order.pointsReleasedAt || order.status === "cancelled") return 0;
  const card = order.paymentProvider === "HYP" || String(order.paymentMethod ?? "").toLowerCase() === "card";
  const unpaid = (order.paymentStatus ?? "pending") !== "paid";
  return card && unpaid ? points : 0;
}
