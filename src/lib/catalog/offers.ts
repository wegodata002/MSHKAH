import { isPublicMenuProduct } from "@/lib/menu/category-tree";
import { priceNow } from "@/lib/sales/sale-price";
import type { Product } from "@/types";

/** One recommended product as the server sends it (sale prices come with the product itself). */
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

/**
 * The "Offers" page in two parts: products on sale now (Admin → Sales; available ones first, in
 * menu order), then the recommended ones not already on sale. Pure.
 */
export function splitOffers(
  products: readonly Product[],
  offers: readonly OfferEntry[],
  now: number
): { onSale: Product[]; recommended: Product[] } {
  const sale = products.filter((p) => isPublicMenuProduct(p) && priceNow(p, now).sale !== null);
  const onSale = [...sale.filter((p) => p.available), ...sale.filter((p) => !p.available)];
  const saleIds = new Set(onSale.map((p) => p.id));
  return { onSale, recommended: orderOfferProducts(products, offers).filter((p) => !saleIds.has(p.id)) };
}
