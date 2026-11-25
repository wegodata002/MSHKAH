import { normalizeOrderStatus } from "@/lib/orders/status";

/**
 * "Most popular": quantities actually sold, across every customer's orders. Pure — the server reads
 * the orders and stores the result (see `admin/popularity-store.ts`).
 */

/** The recent window; with fewer than MIN_UNITS sold in it, all time is used instead. */
export const POPULAR_WINDOW_DAYS = 30;
export const POPULAR_MIN_UNITS = 20;
/** Saved result is refreshed at most this often. */
export const POPULAR_REFRESH_MS = 6 * 60 * 60 * 1000;
/** How many products the badge / filter treats as "popular", and how many the ranking keeps. */
export const POPULAR_TOP = 10;
export const POPULAR_KEEP = 30;

export type SaleOrder = {
  status?: unknown;
  paymentStatus?: unknown;
  isTestOrder?: unknown;
  items?: Array<{ productId?: unknown; quantity?: unknown }>;
};

/**
 * Counts toward "popular": paid or completed; never cancelled, test, failed or refunded.
 * (A cash pickup that was completed but never marked paid still counts.)
 */
export function countsAsSale(order: SaleOrder): boolean {
  if (order.isTestOrder === true) return false;
  const status = normalizeOrderStatus(typeof order.status === "string" ? order.status : undefined);
  if (status === "cancelled") return false;
  const payment = typeof order.paymentStatus === "string" ? order.paymentStatus : "";
  if (payment === "failed" || payment === "refunded") return false;
  return payment === "paid" || status === "delivered";
}

/** Units sold per product id. */
export function unitsSold(orders: readonly SaleOrder[]): Map<string, number> {
  const units = new Map<string, number>();
  for (const order of orders) {
    if (!countsAsSale(order)) continue;
    for (const item of order.items ?? []) {
      const id = typeof item.productId === "string" ? item.productId.trim() : "";
      const qty = Math.floor(Number(item.quantity));
      if (!id || !Number.isFinite(qty) || qty <= 0) continue;
      units.set(id, (units.get(id) ?? 0) + qty);
    }
  }
  return units;
}

export function totalUnits(units: ReadonlyMap<string, number>): number {
  let sum = 0;
  units.forEach((n) => (sum += n));
  return sum;
}

/** Best sellers first (ties by id, so the order is stable); only products that sold. */
export function rankByUnits(units: ReadonlyMap<string, number>, keep = POPULAR_KEEP): string[] {
  return [...units.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, keep)
    .map(([id]) => id);
}

/**
 * The list customers see: real best sellers first, then products the admin pinned as "popular"
 * (the manual checkbox, e.g. a new product with no sales yet).
 */
export function mergePopular(ranking: readonly string[], pinnedIds: readonly string[]): string[] {
  const seen = new Set(ranking);
  return [...ranking, ...pinnedIds.filter((id) => !seen.has(id))];
}

/** Shown as "popular" (badge, filter): the top sellers plus pinned products. */
export function popularIdSet(ranking: readonly string[], pinnedIds: readonly string[], top = POPULAR_TOP): Set<string> {
  return new Set([...ranking.slice(0, top), ...pinnedIds]);
}
