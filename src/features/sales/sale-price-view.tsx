"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/components/providers/locale-provider";
import { cn, formatPrice } from "@/lib/utils";
import { priceNow, saleUntilText, type PriceNow, type ProductSale } from "@/lib/sales/sale-price";

/**
 * Sale prices on the storefront: the same look everywhere (menu card, product window, builder,
 * cart, checkout, offers, assistant, menu display, waiter screen). New price bold in red, the
 * regular one in grey with a line through it. The price is worked out with the same function as the
 * server (`priceNow`), so what is shown is what is charged.
 */

/* One clock for the whole page: ticks every 20 seconds, so a sale starts and ends on time by itself. */
const TICK_MS = 20_000;
let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
const snapshot = () => now || (now = Date.now());
// Server render: no clock (0 = no sale shown); the browser shows the sale right after loading.
const serverSnapshot = () => 0;

/** The time the sale prices are worked out at (updates by itself). */
export function useSaleClock(): number {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** The product's price now (sale price while a sale is on). */
export function useProductPrice(product: { price: unknown; sales?: unknown }): PriceNow {
  const t = useSaleClock();
  return t ? priceNow(product, t) : priceNow({ price: product.price }, 0);
}

/** "−20%", "−₪5", or "Sale" (a new price). */
export function useSaleBadgeText(): (sale: ProductSale) => string {
  const t = useT();
  return (sale) =>
    sale.kind === "percent" ? `‎−${sale.value}%` : sale.kind === "amount" ? `‎−${formatPrice(sale.value)}` : t("sale.badge");
}

/** The red tag on a product picture while a sale is on (nothing otherwise). */
export function SaleBadge({ product, className }: { product: { price: unknown; sales?: unknown }; className?: string }) {
  const { sale } = useProductPrice(product);
  const label = useSaleBadgeText();
  if (!sale) return null;
  return (
    <span className={cn("inline-flex items-center rounded-full bg-[#B4331F] px-2 py-0.5 text-[11px] font-bold text-white shadow-soft md:text-xs", className)} data-sale-badge={sale.kind}>
      {label(sale)}
    </span>
  );
}

type Size = "sm" | "md" | "lg";
const NEW: Record<Size, string> = { sm: "text-[13px] sm:text-base", md: "text-base md:text-lg lg:text-xl", lg: "text-2xl" };
const OLD: Record<Size, string> = { sm: "text-[11px] sm:text-xs", md: "text-xs md:text-sm", lg: "text-base" };

/**
 * A price: the regular one as before (`className`), or while a sale is on the new price in red and
 * the regular one struck through. `amount` = what to price (default the product's own price; e.g. a
 * line total), with `regularAmount` its regular value. `until`: the "until 30.11" line.
 */
export function SalePrice({
  product,
  size = "md",
  className,
  amount,
  regularAmount,
  until = false,
}: {
  product: { price: unknown; sales?: unknown };
  size?: Size;
  className?: string;
  amount?: number;
  regularAmount?: number;
  until?: boolean;
}) {
  const t = useT();
  const priced = useProductPrice(product);
  const shown = amount ?? priced.price;
  const regular = regularAmount ?? priced.regular;
  if (!priced.sale || !(shown < regular)) {
    return (
      <span dir="ltr" className={cn("text-price tabular-nums", className)} data-price>
        {formatPrice(shown)}
      </span>
    );
  }
  return (
    <span className="inline-flex min-w-0 flex-col" data-sale-price>
      <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <span dir="ltr" className={cn("font-bold tabular-nums text-[#B4331F] dark:text-[#FF8A73]", NEW[size])} data-price-now>
          {formatPrice(shown)}
        </span>
        <s dir="ltr" className={cn("tabular-nums text-coffee/60", OLD[size])} aria-label={t("sale.regularPrice").replace("{price}", formatPrice(regular))} data-price-regular>
          {formatPrice(regular)}
        </s>
      </span>
      {until && (
        <span className="text-[11px] text-coffee/65" data-sale-until>
          {t("sale.until").replace("{date}", saleUntilText(priced.sale.endsAt))}
        </span>
      )}
    </span>
  );
}
