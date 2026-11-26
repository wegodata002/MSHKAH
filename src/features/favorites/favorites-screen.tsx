"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { Heart } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ProductGridSkeleton } from "@/components/ui/skeleton";
import { useT } from "@/components/providers/locale-provider";
import { useProducts } from "@/hooks/useProducts";
import { dropDeviceFavorites, useFavorites } from "@/hooks/useFavorites";
import { usePopularProducts } from "@/hooks/usePopularity";
import { ProductCard } from "@/features/catalog/product-card";
import { ProductDetailDrawer } from "@/features/catalog/product-detail-drawer";
import { CatalogModifierPreviewProvider } from "@/features/catalog/catalog-modifier-preview-context";
import { CATALOG_GRID_CLASS } from "@/features/catalog/catalog-grid";
import { isPublicMenuProduct, sortProducts } from "@/lib/menu/category-tree";
import type { Product } from "@/types";
import { ClubAccountLine, ClubInvite } from "@/features/club/club-account-note";

/**
 * The products this customer marked with the heart: on the club account for a signed-in member
 * (every device), otherwise in this browser — with an invitation to join the club.
 */
export function FavoritesScreen() {
  const t = useT();
  const { favorites, account, checked } = useFavorites();
  const { products: raw, loading, error, usingFallback } = useProducts({ active: true });
  // Same "popular" badge as the menu (real sales + manual pins).
  const products = usePopularProducts(raw);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Products removed or hidden from the menu since they were marked simply drop out of the list.
  const favoriteProducts = useMemo(
    () => sortProducts(products.filter((p) => favorites.has(p.id) && isPublicMenuProduct(p))),
    [products, favorites]
  );

  // This device's favourites (not signed in to the club): a product no longer on the menu is looked up
  // once; if its document is gone (deleted, not just hidden), it leaves the list so the ♡ count is
  // right. Only after the menu loaded from the server (never from the offline copy or on an error).
  useEffect(() => {
    if (loading || error || usingFallback || !checked || account || raw.length === 0) return;
    const onMenu = new Set(raw.map((p) => p.id));
    const missing = [...favorites].filter((id) => !onMenu.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(
      missing.map((id) =>
        getDoc(doc(getDb(), COLLECTIONS.products, id))
          .then((snap) => (snap.exists() ? null : id))
          .catch(() => null)
      )
    ).then((found) => {
      const deleted = found.filter((id): id is string => !!id);
      if (!cancelled && deleted.length) dropDeviceFavorites(deleted);
    });
    return () => {
      cancelled = true;
    };
  }, [loading, error, usingFallback, checked, account, raw, favorites]);

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
        {checked && account && <ClubAccountLine textKey="favorites.savedInAccount" className="-mt-3 mb-5" />}
        {checked && !account && <ClubInvite className="mb-5" />}

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
