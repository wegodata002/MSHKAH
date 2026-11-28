/**
 * Sale prices (Admin → Sales). Pure: the browser (menu, product, cart, offers, waiter screen) and the
 * server (order pricing, card charge) use these same functions, so they always agree.
 *
 * A product carries the sales it is in, as copied there by the server when a sale is saved
 * (`products/{id}.sales`, never written by the product editor). Only one of them can be on at a
 * time (overlaps are refused in the admin), so "the price now" is simply the sale whose window
 * holds `now`; before the start and after the end the regular price comes back by itself.
 *
 * The sale applies to the product's own price only; add-ons keep their full price.
 */

export type SaleKind = "percent" | "amount" | "price";

/** One sale as copied onto a product. `startsAt` ≤ now < `endsAt` (ISO, UTC) = on. */
export type ProductSale = {
  saleId: string;
  kind: SaleKind;
  /** percent: 1–99 (%); amount: ₪ off; price: the new price in ₪. */
  value: number;
  startsAt: string;
  endsAt: string;
  /** Free delivery for an order with this product at this sale (from `freeDeliveryMin` ₪ of products, whole order). */
  freeDelivery?: true;
  freeDeliveryMin?: number;
};

export const SALE_KINDS: readonly SaleKind[] = ["percent", "amount", "price"];

export function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && value.length >= 10 && Number.isFinite(Date.parse(value));
}

/** The product's `sales` field, cleaned: anything malformed is dropped (never trusted as a price). */
export function readProductSales(raw: unknown): ProductSale[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductSale[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const v = s as Record<string, unknown>;
    const kind = v.kind as SaleKind;
    const value = Number(v.value);
    if (typeof v.saleId !== "string" || !v.saleId || !SALE_KINDS.includes(kind) || !Number.isFinite(value) || value <= 0) continue;
    if (kind === "percent" && value >= 100) continue;
    if (!isIso(v.startsAt) || !isIso(v.endsAt) || Date.parse(v.startsAt) >= Date.parse(v.endsAt)) continue;
    const min = money(Number(v.freeDeliveryMin));
    out.push({
      saleId: v.saleId,
      kind,
      value,
      startsAt: v.startsAt,
      endsAt: v.endsAt,
      ...(v.freeDelivery === true ? { freeDelivery: true as const, ...(Number.isFinite(min) && min > 0 ? { freeDeliveryMin: min } : {}) } : {}),
    });
  }
  return out;
}

/** The sale on at `now`, or null. */
export function activeSale(sales: readonly ProductSale[] | undefined, now: Date | number): ProductSale | null {
  if (!sales || sales.length === 0) return null;
  const t = typeof now === "number" ? now : now.getTime();
  return sales.find((s) => Date.parse(s.startsAt) <= t && t < Date.parse(s.endsAt)) ?? null;
}

/** The sale price of a regular price (never below 0, never above the regular price). */
export function applySale(regular: number, sale: Pick<ProductSale, "kind" | "value">): number {
  const raw = sale.kind === "percent" ? regular * (1 - sale.value / 100) : sale.kind === "amount" ? regular - sale.value : sale.value;
  return money(Math.min(regular, Math.max(0, raw)));
}

export type PriceNow = {
  /** What is charged now for the product's own price (add-ons not included). */
  price: number;
  /** The regular price. */
  regular: number;
  /** The sale on now, when it lowers the price; otherwise null. */
  sale: ProductSale | null;
};

/** The product's price now: the sale price while a sale is on, else the regular price. */
export function priceNow(product: { price: unknown; sales?: unknown }, now: Date | number): PriceNow {
  const regular = Number(product.price);
  if (!Number.isFinite(regular) || regular < 0) return { price: regular, regular, sale: null };
  const sale = activeSale(readProductSales(product.sales), now);
  if (!sale) return { price: regular, regular, sale: null };
  const price = applySale(regular, sale);
  return price < regular ? { price, regular, sale } : { price: regular, regular, sale: null };
}

/** When the price next changes by itself (a sale starting or ending), or null. For the browser's clock. */
export function nextPriceChange(products: ReadonlyArray<{ sales?: unknown }>, now: Date | number): number | null {
  const t = typeof now === "number" ? now : now.getTime();
  let next: number | null = null;
  for (const p of products) {
    for (const s of readProductSales(p.sales)) {
      for (const edge of [Date.parse(s.startsAt), Date.parse(s.endsAt)]) {
        if (edge > t && (next === null || edge < next)) next = edge;
      }
    }
  }
  return next;
}

/* ── Israel time (the admin types dates in Israel time; stored as UTC ISO) ── */

const TZ = "Asia/Jerusalem";

function israelParts(ms: number): { y: number; m: number; d: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute") };
}

/** "2026-11-30T23:59" typed in Israel time → ISO (UTC). Null if not a valid date and time. */
export function israelLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const wanted = Date.UTC(y, mo - 1, d, h, mi);
  // Israel is UTC+2 or +3: start from +2, correct by what that moment shows in Israel.
  let guess = wanted - 2 * 3600_000;
  for (let i = 0; i < 2; i++) {
    const p = israelParts(guess);
    guess += wanted - Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  }
  const p = israelParts(guess);
  if (p.y !== y || p.m !== mo || p.d !== d || p.h !== h || p.min !== mi) return null; // e.g. a skipped hour
  return new Date(guess).toISOString();
}

/** ISO → "2026-11-30T23:59" in Israel time (for a datetime-local field). */
export function isoToIsraelLocal(iso: string): string {
  const p = israelParts(Date.parse(iso));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`;
}

/** "30.11" or "30.11 18:00" (Israel time) for "until …": the hour only when it is not the end of the day. */
export function saleUntilText(endsAtIso: string): string {
  const p = israelParts(Date.parse(endsAtIso) - 1); // an end at 00:00 reads as the day before
  const last = israelParts(Date.parse(endsAtIso));
  const pad = (n: number) => String(n).padStart(2, "0");
  const endOfDay = last.h === 0 && last.min === 0;
  const lastMinute = last.h === 23 && last.min === 59;
  const day = endOfDay ? `${pad(p.d)}.${pad(p.m)}` : `${pad(last.d)}.${pad(last.m)}`;
  return endOfDay || lastMinute ? day : `${day} ${pad(last.h)}:${pad(last.min)}`;
}

/**
 * A product write from the editor or a list (price, availability, …) with the sale fields taken out:
 * only the server's Sales code writes them, so a product edit (even one sent with a stale copy of the
 * product) can neither delete nor overwrite a sale.
 */
export function withoutSaleFields<T extends Record<string, unknown>>(patch: T): Omit<T, "sales" | "sale"> {
  const { sales: _sales, sale: _sale, ...rest } = patch as T & { sales?: unknown; sale?: unknown };
  void _sales;
  void _sale;
  return rest;
}
