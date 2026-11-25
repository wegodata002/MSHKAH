"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { Search, X } from "lucide-react";
import { SiteHeader } from "@/components/layout/header";
import { HeroBanner } from "@/features/catalog/hero-banner";
import { AvailabilityPill } from "@/features/catalog/availability-pill";
import { CategoryNav } from "@/features/catalog/category-nav";
import { CategoryProductSection } from "@/features/catalog/category-product-section";
import { FilterSortButton, FilterSortPanel } from "@/features/catalog/product-filters-bar";
import { ProductGrid } from "@/features/catalog/product-grid";
import { ProductDetailDrawer } from "@/features/catalog/product-detail-drawer";
import { CatalogModifierPreviewProvider } from "@/features/catalog/catalog-modifier-preview-context";
import { Input } from "@/components/ui/input";
import { useAllProducts, useCategories } from "@/hooks/useProducts";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { buildCatalogSections } from "@/lib/menu/category-tree";
import { cn } from "@/lib/utils";
import type { Product, ProductFilters } from "@/types";

/** How long scroll-spy stays paused after a programmatic scroll (fallback when `scrollend` is unsupported). */
const SPY_LOCK_MS = 1200;

export function CatalogView() {
  const t = useT();
  const { dir, locale } = useLocale();
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [filters, setFilters] = useState<ProductFilters>({ sortBy: "menu", active: true });
  const [activeId, setActiveId] = useState<string | null>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const spyLockUntil = useRef(0);
  const deepLinkApplied = useRef(false);

  const { categories } = useCategories();
  const { products: allProducts, loading } = useAllProducts();

  const sections = useMemo(
    () => buildCatalogSections(allProducts, categories, filters, locale, searchQuery),
    [allProducts, categories, filters, locale, searchQuery]
  );
  const navCategories = useMemo(() => sections.map((s) => s.category), [sections]);

  // Memoised so scroll-spy updates (activeId) re-render only the nav, not ~150 product cards.
  const sectionsContent = useMemo(
    () => {
      let offset = 0;
      return sections.map((section) => {
        const indexOffset = offset;
        offset += section.count;
        return (
          <CategoryProductSection
            key={section.category.id}
            category={section.category}
            groups={section.groups}
            count={section.count}
            indexOffset={indexOffset}
            onProductClick={setSelectedProduct}
          />
        );
      });
    },
    [sections]
  );

  /** Height covered by the stuck header + sticky bar (the bar's CSS `top` + its own height). */
  const stuckOffset = useCallback(() => {
    const el = stickyRef.current;
    if (!el) return 0;
    const top = parseFloat(getComputedStyle(el).top) || 0;
    return top + el.offsetHeight;
  }, []);

  const scrollToCategory = useCallback(
    (categoryId: string, behavior: ScrollBehavior = "smooth") => {
      const section = document.getElementById(`category-${categoryId}`);
      if (!section) return;
      setActiveId(categoryId);
      spyLockUntil.current = Date.now() + SPY_LOCK_MS;
      const y = section.getBoundingClientRect().top + window.scrollY - stuckOffset() - 8;
      window.scrollTo({ top: Math.max(0, y), behavior });
    },
    [stuckOffset]
  );

  // Scroll-spy: the active category is the last section whose top has passed under the sticky bar.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (Date.now() < spyLockUntil.current) return;
      const offset = stuckOffset() + 16;
      const els = sections
        .map((s) => document.getElementById(`category-${s.category.id}`))
        .filter((el): el is HTMLElement => el !== null);
      if (els.length === 0) return;
      let current = els[0]!.dataset.categoryId ?? null;
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) {
        current = els[els.length - 1]!.dataset.categoryId ?? current;
      } else {
        for (const el of els) {
          if (el.getBoundingClientRect().top - offset <= 0) current = el.dataset.categoryId ?? current;
          else break;
        }
      }
      setActiveId((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onScrollEnd = () => {
      spyLockUntil.current = 0;
      onScroll();
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("scrollend", onScrollEnd);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scrollend", onScrollEnd);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sections, stuckOffset]);

  // Banner deep links: ?category=<id> scrolls to that section, ?product=<id> opens the product.
  useEffect(() => {
    if (deepLinkApplied.current || loading || sections.length === 0) return;
    deepLinkApplied.current = true;
    const params = new URLSearchParams(window.location.search);
    const categoryId = params.get("category");
    const productId = params.get("product");
    if (categoryId) {
      const rootId = categories.find((c) => c.id === categoryId)?.parentId || categoryId;
      requestAnimationFrame(() => scrollToCategory(rootId, "auto"));
    } else if (productId) {
      const product = allProducts.find((item) => item.id === productId);
      if (product) setSelectedProduct(product);
    }
  }, [loading, sections.length, categories, allProducts, scrollToCategory]);

  const closeSearch = () => {
    setSearchQuery("");
    setSearchOpen(false);
  };

  const searchInput = (autoFocus: boolean) => (
    <div className="relative">
      <Search
        className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee/40"
        strokeWidth={1.75}
      />
      <Input
        autoFocus={autoFocus}
        placeholder={t("header.search")}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        aria-label={t("header.search")}
        dir={dir}
        className="h-10 border-beige-dark/25 bg-warm-white ps-10 pe-10 text-base shadow-none md:text-sm"
      />
      {searchQuery && (
        <button
          type="button"
          onClick={() => setSearchQuery("")}
          aria-label={t("filters.clear")}
          className="absolute end-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-coffee/50 hover:bg-beige/60"
        >
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );

  return (
    <CatalogModifierPreviewProvider>
    <>
      <SiteHeader />

      {isHome && <HeroBanner />}

      <div className="mx-auto max-w-[1280px] px-4 md:px-8 lg:px-10">
        {/* The footer below keeps the room for the phone's bottom bar and the cart button. */}
        <div className="mt-4 min-w-0 pb-8 md:mt-6 lg:pb-12">
          {/* What can be ordered now: one short line above the categories (under the banner on the home page). */}
          {/* Shown on the home page and on /catalog. */}
          <AvailabilityPill />
          {/* Sticky catalog bar: categories (+ mobile icons) and the desktop search/filter row. */}
          <div
            ref={stickyRef}
            id="menu"
            className="sticky top-12 z-30 -mx-4 border-b border-beige-dark/15 bg-cream/95 px-4 py-2 backdrop-blur-md md:top-20 md:-mx-8 md:px-8 lg:-mx-10 lg:px-10"
          >
            <CategoryNav
              categories={navCategories}
              activeId={activeId}
              onSelect={scrollToCategory}
              trailing={
                <div className="flex shrink-0 items-center gap-1.5 md:hidden">
                  <button
                    type="button"
                    onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
                    aria-label={t("header.search")}
                    aria-expanded={searchOpen}
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-warm-white transition-colors",
                      searchOpen || searchQuery ? "border-turquoise text-turquoise" : "border-beige-dark/30 text-coffee"
                    )}
                  >
                    <Search className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                  <FilterSortButton
                    variant="icon"
                    filters={filters}
                    open={showFilters}
                    onClick={() => setShowFilters((v) => !v)}
                  />
                </div>
              }
            />

            {searchOpen && <div className="mt-2 md:hidden">{searchInput(true)}</div>}

            <div className="mt-2 hidden items-center gap-3 md:flex">
              <div className="w-full max-w-xs">{searchInput(false)}</div>
              <FilterSortButton
                filters={filters}
                open={showFilters}
                onClick={() => setShowFilters((v) => !v)}
              />
            </div>

            {showFilters && (
              <div className="mt-2">
                <FilterSortPanel filters={filters} onFiltersChange={setFilters} />
              </div>
            )}
          </div>

          {loading && sections.length === 0 ? (
            <div className="pt-6">
              <ProductGrid products={[]} loading onProductClick={setSelectedProduct} />
            </div>
          ) : sections.length === 0 ? (
            <div className="pt-6">
              <ProductGrid products={[]} loading={false} onProductClick={setSelectedProduct} />
            </div>
          ) : (
            sectionsContent
          )}
        </div>
      </div>

      <ProductDetailDrawer
        product={selectedProduct}
        open={!!selectedProduct}
        onOpenChange={(open) => !open && setSelectedProduct(null)}
        onSelectProduct={setSelectedProduct}
      />

    </>
    </CatalogModifierPreviewProvider>
  );
}
