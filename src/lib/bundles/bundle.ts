import { money } from "@/lib/sales/sale-price";

/**
 * Bundles (Admin → Sales → Bundles): several products together for one total price, e.g.
 * "2 coffees + a pastry for ₪30". Pure: the browser (cards, chooser, cart) and the server (order
 * pricing, card charge) use these same functions.
 *
 * A bundle is made of up to 6 parts ("slots"):
 *   fixed     — this product, this many (e.g. 1 × chocolate pastry)
 *   choice    — choose N from this list of products (repeats allowed: 2 × cappuccino is fine)
 *   category  — choose N from the products of this category (new products join by themselves)
 *
 * The bundle price is for the products' own prices; add-ons (size, milk, extra shot) are paid on
 * top at their full price. Sales on the products do not apply inside a bundle: the bundle price is
 * the price. A bundle never costs more than its products bought separately (then that is the price).
 */

export type BundleText = { he: string; ar: string; en: string };

export type BundleSlot =
  | { id: string; kind: "fixed"; productId: string; quantity: number }
  | { id: string; kind: "choice"; productIds: string[]; choose: number }
  | { id: string; kind: "category"; categoryId: string; choose: number };

export type BundleSlotKind = BundleSlot["kind"];

/** The bundle as the menu and the order pricing read it. */
export type Bundle = {
  id: string;
  name: BundleText;
  description: BundleText;
  imageUrl?: string;
  /** Total price (₪) of the products' own prices. */
  price: number;
  /** ISO (UTC); on while startsAt ≤ now < endsAt. */
  startsAt: string;
  endsAt: string;
  slots: BundleSlot[];
  /** Delivery fee 0 for an order with this bundle (the area's minimum order still applies). */
  freeDelivery: boolean;
  /** Free delivery only from this products total (₪, whole order); 0 = any amount. */
  freeDeliveryMin: number;
  /** Store / club coupons may also take off the bundle (off by default). */
  couponsAllowed: boolean;
};

export const BUNDLE_SLOT_KINDS: readonly BundleSlotKind[] = ["fixed", "choice", "category"];
export const MAX_BUNDLE_SLOTS = 6;
/** Per part: at most this many products to choose (or of a fixed product). */
export const MAX_SLOT_COUNT = 10;
export const MAX_CHOICE_PRODUCTS = 40;

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const isIso = (v: unknown): v is string => typeof v === "string" && v.length >= 10 && Number.isFinite(Date.parse(v));
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const readText = (v: unknown, max: number): BundleText => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { he: text(o.he, max), ar: text(o.ar, max), en: text(o.en, max) };
};

/** How many products a part takes. */
export function slotCount(slot: BundleSlot): number {
  return slot.kind === "fixed" ? slot.quantity : slot.choose;
}

/** One part, cleaned; null when malformed. */
export function readSlot(raw: unknown): BundleSlot | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && ID.test(r.id) ? r.id : null;
  if (!id) return null;
  const count = (v: unknown) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= MAX_SLOT_COUNT ? n : null;
  };
  if (r.kind === "fixed") {
    const quantity = count(r.quantity);
    if (typeof r.productId !== "string" || !ID.test(r.productId) || !quantity) return null;
    return { id, kind: "fixed", productId: r.productId, quantity };
  }
  if (r.kind === "choice") {
    const choose = count(r.choose);
    const ids = Array.isArray(r.productIds) ? [...new Set(r.productIds.filter((x): x is string => typeof x === "string" && ID.test(x)))] : [];
    if (!choose || ids.length === 0 || ids.length > MAX_CHOICE_PRODUCTS) return null;
    return { id, kind: "choice", productIds: ids, choose };
  }
  if (r.kind === "category") {
    const choose = count(r.choose);
    if (typeof r.categoryId !== "string" || !ID.test(r.categoryId) || !choose) return null;
    return { id, kind: "category", categoryId: r.categoryId, choose };
  }
  return null;
}

/** A bundle document, cleaned (anything malformed → null: never trusted as a price). */
export function readBundle(id: string, data: unknown): Bundle | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const price = money(Number(d.price));
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!isIso(d.startsAt) || !isIso(d.endsAt) || Date.parse(d.startsAt) >= Date.parse(d.endsAt)) return null;
  const rawSlots = Array.isArray(d.slots) ? d.slots : [];
  const slots = rawSlots.map(readSlot);
  if (slots.length === 0 || slots.length > MAX_BUNDLE_SLOTS || slots.some((s) => !s)) return null;
  const name = readText(d.name, 80);
  if (!name.he) return null;
  const min = money(Number(d.freeDeliveryMin));
  const imageUrl = text(d.imageUrl, 2000);
  return {
    id,
    name,
    description: readText(d.description, 300),
    ...(imageUrl ? { imageUrl } : {}),
    price,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    slots: slots as BundleSlot[],
    freeDelivery: d.freeDelivery === true,
    freeDeliveryMin: Number.isFinite(min) && min > 0 ? min : 0,
    couponsAllowed: d.couponsAllowed === true,
  };
}

export function bundleActive(bundle: Pick<Bundle, "startsAt" | "endsAt">, now: Date | number): boolean {
  const t = typeof now === "number" ? now : now.getTime();
  return Date.parse(bundle.startsAt) <= t && t < Date.parse(bundle.endsAt);
}

export function bundleName(bundle: Pick<Bundle, "name">, locale: "he" | "ar" | "en" | undefined): string {
  const { he, ar, en } = bundle.name;
  if (locale === "ar") return ar || he || en;
  if (locale === "en") return en || he;
  return he || en;
}

export function bundleDescription(bundle: Pick<Bundle, "description">, locale: "he" | "ar" | "en" | undefined): string {
  const { he, ar, en } = bundle.description;
  if (locale === "ar") return ar || he || en;
  if (locale === "en") return en || he;
  return he || en;
}

/** What a product needs for a bundle part. */
export type SlotProduct = { id: string; categoryId?: unknown };

/** May this product fill this part? */
export function productFitsSlot(slot: BundleSlot, product: SlotProduct): boolean {
  if (slot.kind === "fixed") return slot.productId === product.id;
  if (slot.kind === "choice") return slot.productIds.includes(product.id);
  return typeof product.categoryId === "string" && product.categoryId === slot.categoryId;
}

/** One product chosen for a part (one unit; a part that takes 2 has 2 picks). */
export type BundlePickRef = { slotId: string; productId: string };

/**
 * The picks fill every part exactly (no part short or over, no unknown part, each product allowed
 * in its part). `products` = the catalog (for the category of a product).
 */
export function picksFitBundle(
  bundle: Pick<Bundle, "slots">,
  picks: readonly BundlePickRef[],
  products: ReadonlyMap<string, { categoryId?: unknown } | undefined>
): boolean {
  const bySlot = new Map<string, number>();
  for (const pick of picks) {
    const slot = bundle.slots.find((s) => s.id === pick.slotId);
    if (!slot) return false;
    const product = products.get(pick.productId);
    if (!product || !productFitsSlot(slot, { id: pick.productId, categoryId: product.categoryId })) return false;
    bySlot.set(slot.id, (bySlot.get(slot.id) ?? 0) + 1);
  }
  return bundle.slots.every((slot) => (bySlot.get(slot.id) ?? 0) === slotCount(slot));
}

/**
 * Split `total` (₪) over the picks by their prices now, in agorot, so the lines add up exactly to
 * the bundle price (the agorot left go to the largest remainders, the first line on a tie).
 * All prices 0 → equal shares.
 */
export function allocateBundlePrice(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const totalMinor = Math.round(total * 100);
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const raw = sum > 0 ? w.map((x) => (totalMinor * x) / sum) : w.map(() => totalMinor / w.length);
  const floor = raw.map((x) => Math.floor(x + 1e-9));
  let left = totalMinor - floor.reduce((a, b) => a + b, 0);
  const order = raw.map((x, i) => ({ i, rest: x - floor[i]! })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) floor[order[k]!.i]! += 1;
  return floor.map((m) => m / 100);
}

/** The bundle's price for these picks: the bundle price, never above the products bought separately. */
export function bundleUnitPrice(bundle: Pick<Bundle, "price">, separately: number): number {
  return money(Math.max(0, Math.min(bundle.price, separately)));
}

/**
 * For the card ("₪30 instead of ₪38", "save at least ₪8"): the cheapest and dearest the products
 * of this bundle cost separately now (sale prices included), from the products that can be ordered.
 * null when a part has no product to choose from now (the bundle can't be bought).
 */
export function bundleSeparateRange(
  bundle: Pick<Bundle, "slots">,
  products: ReadonlyArray<{ id: string; categoryId?: unknown; priceNow: number; orderable: boolean }>
): { min: number; max: number } | null {
  let min = 0;
  let max = 0;
  for (const slot of bundle.slots) {
    const fits = products.filter((p) => p.orderable && Number.isFinite(p.priceNow) && productFitsSlot(slot, p));
    if (fits.length === 0) return null;
    const prices = fits.map((p) => p.priceNow);
    min += Math.min(...prices) * slotCount(slot);
    max += Math.max(...prices) * slotCount(slot);
  }
  return { min: money(min), max: money(max) };
}

/* ── Free delivery (bundles and sales) ── */

/** One offer in the order that gives free delivery, from `min` (₪, products of the whole order; 0 = any). */
export type FreeDeliveryOffer = { min: number };

/**
 * The lowest products total from which the order's delivery is free, or null when nothing in the
 * order gives free delivery. (Two offers: the easier one counts.)
 */
export function freeDeliveryFrom(offers: readonly FreeDeliveryOffer[]): number | null {
  if (offers.length === 0) return null;
  return money(Math.min(...offers.map((o) => (Number.isFinite(o.min) && o.min > 0 ? o.min : 0))));
}

/**
 * The delivery fee after the offers: 0 when an offer applies and the products total (whole order,
 * after sales and bundles, before the coupon) reaches its minimum. The area's own minimum order is
 * checked separately and still applies.
 */
export function deliveryFeeAfterOffers(fee: number, productsTotal: number, freeFrom: number | null): { fee: number; free: boolean } {
  if (freeFrom !== null && productsTotal >= freeFrom) return { fee: 0, free: true };
  return { fee: money(Math.max(0, fee)), free: false };
}
