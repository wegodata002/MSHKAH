import { money, priceNow } from "@/lib/sales/sale-price";
import { bundleActive, bundleUnitPrice, freeDeliveryFrom, picksFitBundle, type Bundle, type FreeDeliveryOffer } from "@/lib/bundles/bundle";

/**
 * A bundle in the cart, priced NOW like the server will (see price-lines): the bundle price, never
 * above its products bought separately (sale prices included), plus the add-ons at full price.
 * Pure: the cart, the checkout and the waiter screen use it.
 */

type PickProduct = { id: string; price: unknown; sales?: unknown; categoryId?: unknown };

export type CartBundlePick = {
  slotId: string;
  product: PickProduct;
  selections: ReadonlyArray<{ priceDelta: number; quantity: number }>;
  notes?: string;
};

export type PricedCartBundle = {
  /** One bundle with its add-ons. */
  unitPrice: number;
  /** What it would cost separately now, add-ons included (the struck-through price). */
  regularUnitPrice: number;
  /** The bundle's own price (products only). */
  bundlePrice: number;
  extras: number;
  /** false: the bundle is over, gone, or its products changed — it can't be ordered as it is. */
  available: boolean;
};

export function priceCartBundle(
  bundle: Bundle | undefined,
  picks: readonly CartBundlePick[],
  live: ReadonlyMap<string, PickProduct>,
  now: number
): PricedCartBundle {
  const products = picks.map((p) => live.get(p.product.id) ?? p.product);
  const separately = money(products.reduce((sum, p) => sum + (Number.isFinite(priceNow(p, now).price) ? priceNow(p, now).price : 0), 0));
  const extras = money(picks.reduce((sum, p) => sum + p.selections.reduce((s, x) => s + (Number(x.priceDelta) || 0) * (Number(x.quantity) || 0), 0), 0));
  const catalog = new Map(products.map((p) => [p.id, p]));
  const available = !!bundle && bundleActive(bundle, now) && picksFitBundle(bundle, picks.map((p) => ({ slotId: p.slotId, productId: p.product.id })), catalog);
  const bundlePrice = bundle ? bundleUnitPrice(bundle, separately) : separately;
  return { unitPrice: money(bundlePrice + extras), regularUnitPrice: money(separately + extras), bundlePrice, extras, available };
}

/**
 * The cart's free delivery, as the server works it out: from a product on a sale with free delivery,
 * or a bundle with free delivery (the easier minimum counts; the minimum is on all the products).
 */
export function cartFreeDeliveryFrom(
  saleLines: ReadonlyArray<{ sale?: { freeDelivery?: true; freeDeliveryMin?: number } | null }>,
  bundles: ReadonlyArray<{ bundle?: Pick<Bundle, "freeDelivery" | "freeDeliveryMin">; available: boolean }>
): number | null {
  const offers: FreeDeliveryOffer[] = [];
  for (const l of saleLines) if (l.sale?.freeDelivery) offers.push({ min: l.sale.freeDeliveryMin ?? 0 });
  for (const b of bundles) if (b.available && b.bundle?.freeDelivery) offers.push({ min: b.bundle.freeDeliveryMin });
  return freeDeliveryFrom(offers);
}
