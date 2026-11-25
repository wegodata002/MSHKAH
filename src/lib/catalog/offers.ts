import { isPublicMenuProduct } from "@/lib/menu/category-tree";
import type { Product } from "@/types";

/** One offer as the server sends it; later also a discount price and dates. */
export type OfferEntry = { productId: string };

/**
 * The "Offers" page list: the chosen products in the order set in the admin (▲▼); those not
 * available right now at the end (still in that order); hidden / removed products left out. Pure.
 */
export function orderOfferProducts(products: readonly Product[], offers: readonly OfferEntry[]): Product[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const chosen = offers
    .map((o) => byId.get(o.productId))
    .filter((p): p is Product => !!p && isPublicMenuProduct(p));
  return [...chosen.filter((p) => p.available), ...chosen.filter((p) => !p.available)];
}

/** Move one product up (-1) or down (+1) in the admin's offers order. Pure. */
export function moveOffer(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const next = [...ids];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
