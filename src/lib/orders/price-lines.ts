import { collectKitchenNotes } from "@/lib/product-builder/engine";
import { priceLineModifiers, type RequestedModifier } from "@/lib/orders/modifier-pricing";
import { money, priceNow } from "@/lib/sales/sale-price";
import {
  allocateBundlePrice,
  bundleActive,
  bundleName,
  bundleUnitPrice,
  freeDeliveryFrom,
  picksFitBundle,
  type Bundle,
  type FreeDeliveryOffer,
} from "@/lib/bundles/bundle";
import type { ProductBuilderConfig, SelectedModifier } from "@/types/modifiers";
import type { CatalogProduct } from "@/lib/orders/server-order";

/**
 * The products of an order priced on the server: ONE function for the order route (site, waiter,
 * table) and the card charge (HYP), so the amount charged is always the amount the order was priced
 * at. Pure: products, add-on groups, bundles and "now" are passed in.
 *
 * Lines: a product on its own (sale price while a sale is on, add-ons at full price), or a bundle
 * (its products, the bundle price split over them by their prices now, add-ons at full price on top).
 * From the request only which product, which add-on, how many and which bundle part are read.
 */

type Locale = "he" | "ar" | "en";

export type RequestLine = { productId: string; quantity: number; modifiers?: RequestedModifier[]; notes?: string };
export type RequestBundlePick = { slotId: string; productId: string; modifiers?: RequestedModifier[]; notes?: string };
export type RequestBundle = { bundleId: string; quantity: number; picks: RequestBundlePick[] };

/** A bundle line on the order (on each of the bundle's products). */
export type OrderLineBundle = {
  /** Same for all the products of one bundle in this order ("b1", "b2", …). */
  lineId: string;
  bundleId: string;
  name: string;
  slotId: string;
  /** The bundle's price for one bundle (products only, add-ons not included). */
  price: number;
  /** What its products cost separately now (sale prices included), for one bundle. */
  regularPrice: number;
};

export type PricedOrderLine = {
  productId: string;
  productName: string;
  quantity: number;
  /** Unit price charged (own price + add-ons). */
  price: number;
  /** The product's own price charged: the sale price while a sale is on, or its share of a bundle. */
  basePrice: number;
  /** On sale, or in a bundle: the price it would cost on its own now. */
  regularBasePrice?: number;
  saleId?: string;
  bundle?: OrderLineBundle;
  modifiers?: SelectedModifier[];
  notes?: string;
  kitchenNotes?: string[];
};

export type LinePricingError =
  | { code: "PRODUCT_NOT_FOUND"; productIds: string[] }
  | { code: "PRODUCT_UNAVAILABLE"; productNames: string[] }
  | { code: "INVALID_PRICE" }
  | { code: "OPTIONS_UNAVAILABLE"; productNames: string[] }
  /** The bundle is over (or not started, or deleted): its name when known. */
  | { code: "BUNDLE_UNAVAILABLE"; bundleNames: string[] }
  /** The products chosen don't fill the bundle's parts. */
  | { code: "BUNDLE_INVALID"; bundleNames: string[] };

export type PricedLines = {
  items: PricedOrderLine[];
  /** Products total (after sales and bundles, add-ons included), before the coupon. */
  subtotal: number;
  /** The part of `subtotal` a coupon may take off (bundles without "coupons allowed" left out). */
  couponBase: number;
  /** Products total from which the delivery is free, or null when nothing in the order gives it. */
  freeDeliveryFrom: number | null;
  /** Saved on sales and bundles (vs. the regular prices), for the screens. */
  savings: number;
  isTest: boolean;
};

export type LinePricingContext = {
  products: ReadonlyMap<string, CatalogProduct | undefined>;
  modifierConfigs: ReadonlyMap<string, ProductBuilderConfig>;
  /** The bundles of this order from the database (missing = deleted). */
  bundles?: ReadonlyMap<string, Bundle | undefined>;
  now: Date;
  locale?: Locale;
  /**
   * Card charge only: the order was placed at this time (a short while ago). A bundle that was on
   * then still counts, so a bundle ending while the customer is on the payment page doesn't change
   * the amount. Products switched off since the order are not refused at the charge (as before).
   */
  charge?: { placedAt: Date | null };
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Same fallbacks as getLocalizedName on the storefront. */
export function catalogProductName(product: CatalogProduct, locale: Locale | undefined): string {
  const he = str(product.nameHe);
  const ar = str(product.nameAr);
  const en = str(product.nameEn);
  if (locale === "ar") return ar || he || en;
  if (locale === "en") return en || he;
  if (locale === "he") return he || en;
  return he || en;
}

/** Unavailable = switched off in the catalog (`available: false` or `active: false`). */
export function isProductOrderable(product: CatalogProduct): boolean {
  return product.available !== false && product.active !== false;
}

/** The product ids an order request needs from the catalog (its lines and its bundles' picks). */
export function requestProductIds(lines: readonly RequestLine[], bundles: readonly RequestBundle[] = []): string[] {
  return [...new Set([...lines.map((l) => l.productId), ...bundles.flatMap((b) => b.picks.map((p) => p.productId))])];
}

export function priceOrderLines(
  input: { items: readonly RequestLine[]; bundles?: readonly RequestBundle[] },
  ctx: LinePricingContext
): { ok: true; value: PricedLines } | { ok: false; error: LinePricingError } {
  const locale = ctx.locale;
  const bundles = input.bundles ?? [];
  const allIds = requestProductIds(input.items, bundles);

  // Products: all must exist and be orderable.
  const missing = allIds.filter((id) => !ctx.products.get(id));
  if (missing.length > 0) return { ok: false, error: { code: "PRODUCT_NOT_FOUND", productIds: missing } };
  if (!ctx.charge) {
    const unavailable = [...new Set(allIds.map((id) => ctx.products.get(id)!).filter((p) => !isProductOrderable(p)).map((p) => catalogProductName(p, locale)))];
    if (unavailable.length > 0) return { ok: false, error: { code: "PRODUCT_UNAVAILABLE", productNames: unavailable } };
  }

  // Bundles: on now (or, at the card charge, when the order was placed), and the picks fill every part.
  const ended: string[] = [];
  const invalid: string[] = [];
  const placedAt = ctx.charge?.placedAt;
  const isOn = (bundle: Bundle) => bundleActive(bundle, ctx.now) || (!!placedAt && bundleActive(bundle, placedAt));
  for (const b of bundles) {
    const bundle = ctx.bundles?.get(b.bundleId);
    if (!bundle || !isOn(bundle)) ended.push(bundle ? bundleName(bundle, locale) : "");
    else if (!picksFitBundle(bundle, b.picks, ctx.products)) invalid.push(bundleName(bundle, locale));
  }
  if (ended.length > 0) return { ok: false, error: { code: "BUNDLE_UNAVAILABLE", bundleNames: [...new Set(ended.filter(Boolean))] } };
  if (invalid.length > 0) return { ok: false, error: { code: "BUNDLE_INVALID", bundleNames: [...new Set(invalid)] } };

  const badOptions = new Set<string>();
  let isTest = false;
  /** A product's own price now and its add-ons, priced from the catalog. */
  const priceProduct = (productId: string, modifiers: readonly RequestedModifier[] | undefined) => {
    const product = ctx.products.get(productId)!;
    if (product.isTestProduct === true) isTest = true;
    const pricing = priceNow(product, ctx.now);
    if (!Number.isFinite(pricing.price) || pricing.price < 0) return { error: "price" as const };
    const priced = priceLineModifiers(
      ctx.modifierConfigs.get(productId),
      modifiers ?? [],
      { productId, categoryId: str(product.categoryId) || undefined },
      locale ?? "he"
    );
    if (!priced.ok) {
      badOptions.add(catalogProductName(product, locale));
      return { error: "options" as const };
    }
    return { product, pricing, modifiers: priced.modifiers, extras: money(priced.extras) };
  };
  const finish = (line: PricedOrderLine, notes: string | undefined, modifiers: SelectedModifier[]) => {
    if (modifiers.length > 0) line.modifiers = modifiers;
    const note = notes?.trim();
    if (note) line.notes = note;
    const kitchenNotes = collectKitchenNotes(modifiers);
    if (kitchenNotes.length > 0) line.kitchenNotes = kitchenNotes;
    return line;
  };

  const items: PricedOrderLine[] = [];
  let subtotal = 0;
  let couponBase = 0;
  let savings = 0;
  const offers: FreeDeliveryOffer[] = [];

  for (const line of input.items) {
    const p = priceProduct(line.productId, line.modifiers);
    if ("error" in p) {
      if (p.error === "price") return { ok: false, error: { code: "INVALID_PRICE" } };
      continue;
    }
    const unit = money(p.pricing.price + p.extras);
    if (unit < 0) return { ok: false, error: { code: "INVALID_PRICE" } };
    const item: PricedOrderLine = {
      productId: line.productId,
      productName: catalogProductName(p.product, locale),
      quantity: line.quantity,
      price: unit,
      basePrice: p.pricing.price,
    };
    if (p.pricing.sale) {
      item.regularBasePrice = p.pricing.regular;
      item.saleId = p.pricing.sale.saleId;
      savings += (p.pricing.regular - p.pricing.price) * line.quantity;
      if (p.pricing.sale.freeDelivery) offers.push({ min: p.pricing.sale.freeDeliveryMin ?? 0 });
    }
    items.push(finish(item, line.notes, p.modifiers));
    subtotal += unit * line.quantity;
    couponBase += unit * line.quantity;
  }

  for (const [index, b] of bundles.entries()) {
    const bundle = ctx.bundles!.get(b.bundleId)!;
    const priced = b.picks.map((pick) => ({ pick, p: priceProduct(pick.productId, pick.modifiers) }));
    if (priced.some(({ p }) => "error" in p && p.error === "price")) return { ok: false, error: { code: "INVALID_PRICE" } };
    const ok = priced.filter((x): x is { pick: RequestBundlePick; p: Exclude<ReturnType<typeof priceProduct>, { error: unknown }> } => !("error" in x.p));
    if (ok.length !== priced.length) continue; // an add-on refused: reported below
    // Separately now = the products' prices now (sale prices included), without add-ons.
    const separately = money(ok.reduce((sum, { p }) => sum + p.pricing.price, 0));
    const bundlePrice = bundleUnitPrice(bundle, separately);
    const shares = allocateBundlePrice(bundlePrice, ok.map(({ p }) => p.pricing.price));
    const meta: Omit<OrderLineBundle, "slotId"> = {
      lineId: `b${index + 1}`,
      bundleId: bundle.id,
      name: bundleName(bundle, locale),
      price: bundlePrice,
      regularPrice: separately,
    };
    let bundleTotal = 0;
    ok.forEach(({ pick, p }, i) => {
      const share = shares[i]!;
      const unit = money(share + p.extras);
      items.push(
        finish(
          {
            productId: pick.productId,
            productName: catalogProductName(p.product, locale),
            quantity: b.quantity,
            price: unit,
            basePrice: share,
            regularBasePrice: p.pricing.price,
            bundle: { ...meta, slotId: pick.slotId },
          },
          pick.notes,
          p.modifiers
        )
      );
      bundleTotal += unit * b.quantity;
    });
    subtotal += bundleTotal;
    if (bundle.couponsAllowed) couponBase += bundleTotal;
    savings += (separately - bundlePrice) * b.quantity;
    if (bundle.freeDelivery) offers.push({ min: bundle.freeDeliveryMin });
  }

  if (badOptions.size > 0) return { ok: false, error: { code: "OPTIONS_UNAVAILABLE", productNames: [...badOptions] } };
  return {
    ok: true,
    value: {
      items,
      subtotal: money(subtotal),
      couponBase: money(couponBase),
      freeDeliveryFrom: freeDeliveryFrom(offers),
      savings: money(savings),
      isTest,
    },
  };
}

/**
 * The order's lines back as a request (for the card charge): products on their own, and the
 * products of each bundle grouped again by their bundle line. Only ids and quantities are read;
 * every price is worked out again. null when the stored lines don't make sense.
 */
export function linesFromStoredItems(
  stored: ReadonlyArray<{
    productId?: unknown;
    quantity?: unknown;
    modifiers?: ReadonlyArray<{ groupId?: unknown; optionId?: unknown; quantity?: unknown }>;
    bundle?: { lineId?: unknown; bundleId?: unknown; slotId?: unknown } | null;
  }>
): { items: RequestLine[]; bundles: RequestBundle[] } | null {
  const items: RequestLine[] = [];
  const groups = new Map<string, RequestBundle>();
  for (const s of stored) {
    const productId = typeof s.productId === "string" ? s.productId.trim() : "";
    const quantity = Number(s.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) return null;
    const modifiers = (s.modifiers ?? []).map((m) => ({ groupId: String(m.groupId ?? ""), optionId: String(m.optionId ?? ""), quantity: Number(m.quantity) }));
    const b = s.bundle;
    if (b && typeof b === "object") {
      const lineId = typeof b.lineId === "string" ? b.lineId : "";
      const bundleId = typeof b.bundleId === "string" ? b.bundleId : "";
      const slotId = typeof b.slotId === "string" ? b.slotId : "";
      if (!lineId || !bundleId || !slotId) return null;
      const group = groups.get(lineId) ?? { bundleId, quantity, picks: [] };
      if (group.bundleId !== bundleId || group.quantity !== quantity) return null;
      group.picks.push({ slotId, productId, modifiers });
      groups.set(lineId, group);
    } else {
      items.push({ productId, quantity, modifiers });
    }
  }
  return { items, bundles: [...groups.values()] };
}
