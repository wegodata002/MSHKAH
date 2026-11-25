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
import { orderOfferProducts, type OfferEntry } from "@/lib/catalog/offers";
import type { Product } from "@/types";

/**
 * "Offers": the products chosen in the admin as "Recommended (offers)", in the order set there.
 * None right now → "No offers right now" and the popular products.
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

  const offerProducts = useMemo(() => orderOfferProducts(products, offers ?? []), [offers, products]);
  const popular = useMemo(() => topPopular(products, 8), [products]);
  const ready = !loading && offers !== null;
  const list = offerProducts.length > 0 ? offerProducts : popular;

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
            {offerProducts.length === 0 && (
              <div className="mb-6 rounded-2xl bg-warm-white p-5 text-center shadow-soft" data-offers-empty>
                <p className="font-semibold text-dark-brown">{t("offers.none")}</p>
                {popular.length > 0 && <p className="mt-1 text-sm text-coffee/60">{t("offers.popularInstead")}</p>}
              </div>
            )}
            {list.length > 0 && (
              <div className={CATALOG_GRID_CLASS} data-offers-list={offerProducts.length > 0 ? "offers" : "popular"}>
                {list.map((product, index) => (
                  <div key={product.id} className="h-full min-w-0" data-offer-product={product.id}>
                    <ProductCard product={product} index={index} onClick={() => setSelectedProduct(product)} />
                  </div>
                ))}
              </div>
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
