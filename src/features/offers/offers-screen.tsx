"use client";

import { useEffect, useMemo, useState } from "react";
import { Gift } from "lucide-react";
import { ProductGridSkeleton } from "@/components/ui/skeleton";
import { useT } from "@/components/providers/locale-provider";
import { useProducts } from "@/hooks/useProducts";
import { topPopular, usePopularProducts } from "@/hooks/usePopularity";
import { ProductCard } from "@/features/catalog/product-card";
import { ProductDetailDrawer } from "@/features/catalog/product-detail-drawer";
import { CatalogModifierPreviewProvider } from "@/features/catalog/catalog-modifier-preview-context";
import { CATALOG_GRID_CLASS } from "@/features/catalog/catalog-grid";
import { splitOffers, type OfferEntry } from "@/lib/catalog/offers";
import { useSaleClock } from "@/features/sales/sale-price-view";
import type { Product } from "@/types";

/**
 * "Offers": products on sale now (Admin → Sales) first, then the ones chosen in the admin as
 * "Recommended (offers)", in the order set there. Neither → "No offers right now" and the popular ones.
 */
export function OffersScreen() {
  const t = useT();
  const { products: raw, loading } = useProducts({ active: true });
  const products = usePopularProducts(raw);
  const [offers, setOffers] = useState<OfferEntry[] | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/catalog/offers")
      .then((res) => (res.ok ? (res.json() as Promise<{ offers?: OfferEntry[] }>) : null))
      .then((data) => alive && setOffers(Array.isArray(data?.offers) ? data.offers : []))
      .catch(() => alive && setOffers([]));
    return () => {
      alive = false;
    };
  }, []);

  const clock = useSaleClock();
  const { onSale, recommended } = useMemo(() => splitOffers(products, offers ?? [], clock || Date.now()), [offers, products, clock]);
  const popular = useMemo(() => topPopular(products, 8), [products]);
  const ready = !loading && offers !== null;
  const hasOffers = onSale.length > 0 || recommended.length > 0;
  const sections: Array<{ key: "onSale" | "recommended" | "popular"; title: string | null; list: Product[] }> = hasOffers
    ? [
        { key: "onSale" as const, title: recommended.length > 0 ? t("offers.onSale") : null, list: onSale },
        { key: "recommended" as const, title: onSale.length > 0 ? t("offers.recommended") : null, list: recommended },
      ].filter((s) => s.list.length > 0)
    : [{ key: "popular" as const, title: null, list: popular }];

  return (
    <CatalogModifierPreviewProvider>
      <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 lg:px-10" data-offers-page>
        <h1 className="mb-5 flex items-center gap-2 font-display text-2xl font-bold text-dark-brown md:text-3xl dark:text-warm-white">
          <Gift className="h-6 w-6 text-turquoise" strokeWidth={1.75} />
          {t("offers.title")}
        </h1>

        {!ready ? (
          <ProductGridSkeleton count={4} />
        ) : (
          <>
            {!hasOffers && (
              <div className="mb-6 rounded-2xl bg-warm-white p-5 text-center shadow-soft" data-offers-empty>
                <p className="font-semibold text-dark-brown">{t("offers.none")}</p>
                {popular.length > 0 && <p className="mt-1 text-sm text-coffee/60">{t("offers.popularInstead")}</p>}
              </div>
            )}
            {sections.map((section) =>
              section.list.length > 0 ? (
                <section key={section.key} className="mb-8" data-offers-section={section.key}>
                  {section.title && <h2 className="mb-3 font-display text-lg font-bold text-dark-brown md:text-xl dark:text-warm-white">{section.title}</h2>}
                  <div className={CATALOG_GRID_CLASS} data-offers-list={section.key === "popular" ? "popular" : "offers"}>
                    {section.list.map((product, index) => (
                      <div key={product.id} className="h-full min-w-0" data-offer-product={product.id}>
                        <ProductCard product={product} index={index} onClick={() => setSelectedProduct(product)} />
                      </div>
                    ))}
                  </div>
                </section>
              ) : null
            )}
          </>
        )}
      </div>

      <ProductDetailDrawer
        product={selectedProduct}
        open={!!selectedProduct}
        onOpenChange={(open) => !open && setSelectedProduct(null)}
        onSelectProduct={setSelectedProduct}
      />
    </CatalogModifierPreviewProvider>
  );
}
