"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Package } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { useSaleClock } from "@/features/sales/sale-price-view";
import { useActiveBundles } from "@/features/bundles/use-bundles";
import { BundleSheet } from "@/features/bundles/bundle-sheet";
import { getProductImage } from "@/lib/menu/placeholders";
import { bundleDescription, bundleName, bundleSeparateRange, productFitsSlot, type Bundle } from "@/lib/bundles/bundle";
import { priceNow, saleUntilText } from "@/lib/sales/sale-price";
import { cn, formatPrice } from "@/lib/utils";
import type { CartBundleLine, Product } from "@/types";

/**
 * A bundle card: picture (or the products' pictures), name, what's in it, the new price bold with
 * what the products cost separately struck through (cheapest choice: "save at least"), "until",
 * and the 🚚 free delivery tag. A bundle that can't be put together now (a part has nothing to
 * order) is not shown.
 */
export function BundleCard({ bundle, products, onChoose }: { bundle: Bundle; products: readonly Product[]; onChoose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const clock = useSaleClock();
  const now = clock || Date.now();
  const range = useMemo(
    () => bundleSeparateRange(bundle, products.map((p) => ({ id: p.id, categoryId: p.categoryId, priceNow: priceNow(p, now).price, orderable: p.available !== false && p.active !== false && !p.hidden }))),
    [bundle, products, now]
  );
  const images = useMemo(() => {
    const shown: string[] = [];
    for (const slot of bundle.slots) {
      const first = products.find((p) => p.image && productFitsSlot(slot, p));
      if (first) shown.push(getProductImage(first.image, first.categoryId));
      if (shown.length === 3) break;
    }
    return shown;
  }, [bundle, products]);
  if (!range) return null;
  const save = Math.max(0, range.min - bundle.price);
  const name = bundleName(bundle, locale);
  return (
    <button
      type="button"
      onClick={onChoose}
      className="group flex h-full w-full flex-col overflow-hidden rounded-2xl bg-warm-white text-start shadow-soft ring-1 ring-beige-dark/10 transition-shadow hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-turquoise dark:bg-white/5"
      data-bundle-card={bundle.id}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-beige/30">
        {bundle.imageUrl ? (
          <Image src={bundle.imageUrl} alt="" fill sizes="(max-width: 768px) 100vw, 360px" className="object-cover" />
        ) : images.length > 0 ? (
          <div className={cn("grid h-full w-full gap-0.5", images.length === 1 ? "grid-cols-1" : images.length === 2 ? "grid-cols-2" : "grid-cols-3")}>
            {images.map((src, i) => (
              <div key={i} className="relative h-full w-full">
                <Image src={src} alt="" fill sizes="160px" className="object-cover" />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-coffee/30">
            <Package className="h-10 w-10" />
          </div>
        )}
        <span className="absolute start-2 top-2 rounded-full bg-[#9A2B1A] px-2.5 py-1 text-[11px] font-bold text-white">{t("bundles.tag")}</span>
        {bundle.freeDelivery && (
          <span className="absolute end-2 top-2 rounded-full bg-warm-white/95 px-2.5 py-1 text-[11px] font-bold text-turquoise shadow" data-bundle-free-delivery>
            🚚 {bundle.freeDeliveryMin ? t("offers.freeDeliveryFrom").replace("{min}", formatPrice(bundle.freeDeliveryMin)) : t("offers.freeDelivery")}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="font-semibold text-dark-brown dark:text-warm-white">{name}</p>
        {bundleDescription(bundle, locale) && <p className="line-clamp-2 text-xs text-coffee/60">{bundleDescription(bundle, locale)}</p>}
        <div className="mt-auto pt-2">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-display text-xl font-bold text-[#9A2B1A] dark:text-[#FF8A73]" data-bundle-card-price>{formatPrice(bundle.price)}</span>
            {save > 0 && <s className="text-sm text-coffee/45" data-bundle-card-regular>{formatPrice(range.min)}</s>}
          </p>
          {save > 0 && (
            <p className="text-xs font-semibold text-emerald-700" data-bundle-card-save>
              {t(range.max > range.min ? "bundles.saveAtLeast" : "bundles.save").replace("{amount}", formatPrice(save))}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-coffee/50">{t("sale.until").replace("{date}", saleUntilText(bundle.endsAt))}</p>
          <span className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-xl bg-turquoise text-sm font-semibold text-warm-white group-hover:bg-turquoise/90">
            {t("bundles.choose")}
          </span>
        </div>
      </div>
    </button>
  );
}

/**
 * "Bundles": the bundles on now, as cards, and the chooser window. Shown on the offers page and at
 * the top of the menu; nothing at all when there are no bundles. `onAdd` replaces the cart (waiter screen).
 */
export function BundlesSection({
  products,
  className,
  gridClassName,
  onAdd,
}: {
  products: readonly Product[];
  className?: string;
  gridClassName?: string;
  onAdd?: (line: Omit<CartBundleLine, "lineId">) => void;
}) {
  const t = useT();
  const { bundles } = useActiveBundles();
  const [chosen, setChosen] = useState<Bundle | null>(null);
  if (bundles.length === 0) return null;
  return (
    <section className={cn("mb-8", className)} data-bundles-section>
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-dark-brown md:text-xl dark:text-warm-white">
        <Package className="h-5 w-5 text-[#9A2B1A]" strokeWidth={1.75} />
        {t("bundles.title")}
      </h2>
      <div className={gridClassName ?? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"}>
        {bundles.map((b) => (
          <div key={b.id} className="h-full min-w-0 empty:hidden">
            <BundleCard bundle={b} products={products} onChoose={() => setChosen(b)} />
          </div>
        ))}
      </div>
      <BundleSheet bundle={chosen} products={products} open={!!chosen} onOpenChange={(open) => !open && setChosen(null)} onAdd={onAdd} />
    </section>
  );
}
