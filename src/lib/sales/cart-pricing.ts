import { money, priceNow, type ProductSale } from "@/lib/sales/sale-price";

/**
 * Cart lines priced NOW, like the server prices the order: the product's own price at this moment
 * (sale price while a sale is on, from the live menu when it is loaded, else the copy kept in the
 * cart) plus the chosen add-ons at their full price. So a sale that starts, ends or is ended in the
 * admin while the product is in the cart changes the cart's price by itself. Pure.
 */

type Line = {
  lineId: string;
  product: { id: string; price: unknown; sales?: unknown };
  selections: ReadonlyArray<{ priceDelta: number; quantity: number }>;
  unitPrice: number;
};

export type PricedLine = { unitPrice: number; regularUnitPrice: number; sale: ProductSale | null };

export function addOnsTotal(selections: Line["selections"]): number {
  return money(selections.reduce((sum, s) => sum + (Number(s.priceDelta) || 0) * (Number(s.quantity) || 0), 0));
}

export function priceCartLine(line: Line, live: { price: unknown; sales?: unknown } | undefined, now: number): PricedLine {
  const product = live ?? line.product;
  const p = priceNow(product, now);
  if (!Number.isFinite(p.price)) return { unitPrice: line.unitPrice, regularUnitPrice: line.unitPrice, sale: null };
  const extras = addOnsTotal(line.selections);
  return { unitPrice: money(p.price + extras), regularUnitPrice: money(p.regular + extras), sale: p.sale };
}

export type SaleChange = { lineId: string; productId: string; change: "started" | "ended" };

/**
 * Lines whose sale started or ended since last time (`before`: line id → sale id or null). Only lines
 * already seen are reported (adding a product on sale is not a "change").
 */
export function saleChanges(before: ReadonlyMap<string, string | null>, lines: ReadonlyArray<{ lineId: string; productId: string; saleId: string | null }>): SaleChange[] {
  const out: SaleChange[] = [];
  for (const l of lines) {
    if (!before.has(l.lineId)) continue;
    const was = before.get(l.lineId) ?? null;
    if (was && !l.saleId) out.push({ lineId: l.lineId, productId: l.productId, change: "ended" });
    else if (!was && l.saleId) out.push({ lineId: l.lineId, productId: l.productId, change: "started" });
  }
  return out;
}
