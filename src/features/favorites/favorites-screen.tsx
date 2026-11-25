"use client";

import { useMemo, useState } from "react";
import { Heart } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ProductGridSkeleton } from "@/components/ui/skeleton";
import { useT } from "@/components/providers/locale-provider";
import { useProducts } from "@/hooks/useProducts";
import { useFavorites } from "@/hooks/useFavorites";
import { ProductCard } from "@/features/catalog/product-card";
import { ProductDetailDrawer } from "@/features/catalog/product-detail-drawer";
import { CatalogModifierPreviewProvider } from "@/features/catalog/catalog-modifier-preview-context";
import { CATALOG_GRID_CLASS } from "@/features/catalog/catalog-grid";
import { isPublicMenuProduct, sortProducts } from "@/lib/menu/category-tree";
import type { Product } from "@/types";

/** The products this customer marked with the heart (stored in this browser). */
export function FavoritesScreen() {
  const t = useT();
  const { favorites } = useFavorites();
  const { products, loading } = useProducts({ active: true });
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Products removed or hidden from the menu since they were marked simply drop out of the list.
  const favoriteProducts = useMemo(
    () => sortProducts(products.filter((p) => favorites.has(p.id) && isPublicMenuProduct(p))),
    [products, favorites]
  );

  return (
    <CatalogModifierPreviewProvider>
      <div className="mx-auto max-w-[1400px] px-4 py-6 md:px-8 lg:px-10">
        <div className="mb-5 flex items-baseline justify-between gap-3">
          <h1 className="font-display text-2xl font-bold text-dark-brown md:text-3xl dark:text-warm-white">
            {t("favorites.title")}
          </h1>
          {!loading && favoriteProducts.length > 0 && (
            <p className="text-sm text-coffee/55">
              {t("favorites.count").replace("{count}", String(favoriteProducts.length))}
            </p>
          )}
        </div>

        {loading && favorites.size > 0 ? (
          <ProductGridSkeleton count={Math.min(favorites.size, 6)} />
        ) : favoriteProducts.length === 0 ? (
          <EmptyState
            icon={Heart}
            title={t("favorites.emptyTitle")}
            description={t("favorites.emptyHint")}
            actionLabel={t("favorites.browse")}
            actionHref="/catalog"
          />
        ) : (
          <div className={CATALOG_GRID_CLASS}>
            {favoriteProducts.map((product, index) => (
              <div key={product.id} className="h-full min-w-0">
                <ProductCard product={product} index={index} onClick={() => setSelectedProduct(product)} />
              </div>
            ))}
          </div>
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
