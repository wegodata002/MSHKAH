import type { Category, Product, ProductFilters } from "@/types";
import type { Locale } from "@/lib/i18n/types";
import { getLocalizedName } from "@/lib/i18n/localized-content";

export function isPublicMenuCategory(category: Category): boolean {
  if (!category.active) return false;
  const names = [category.name_en, category.name_he, category.name_ar].map((name) =>
    (name ?? "").trim().toUpperCase()
  );
  return !names.includes("TEST") && category.id.trim().toUpperCase() !== "TEST";
}

export function getRootCategories(categories: Category[]): Category[] {
  return categories
    .filter((c) => !c.parentId && isPublicMenuCategory(c))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Compact category preview: first N roots, always including the active
 * category (swapped into the last slot when it would otherwise be hidden).
 */
export function getCollapsedVisibleCategories<T extends { id: string }>(
  roots: T[],
  selectedId: string | null,
  limit: number
): T[] {
  if (limit <= 0) return [];
  if (roots.length <= limit) return roots;

  const head = roots.slice(0, limit);
  if (!selectedId || head.some((c) => c.id === selectedId)) return head;

  const selected = roots.find((c) => c.id === selectedId);
  if (!selected) return head;

  return [...head.slice(0, Math.max(0, limit - 1)), selected];
}

export function getSubcategories(categories: Category[], parentId: string): Category[] {
  return categories
    .filter((c) => c.parentId === parentId && c.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function hasSubcategories(categories: Category[], parentId: string): boolean {
  return categories.some((c) => c.parentId === parentId && c.active);
}

export function getRootCategoriesForAdmin(categories: Category[]): Category[] {
  return categories
    .filter((c) => !c.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function isPublicMenuProduct(product: Product): boolean {
  if (!product.active || product.hidden || product.isTestProduct) return false;
  const names = [product.name_en, product.name_he, product.name_ar].map((name) =>
    (name ?? "").trim().toUpperCase()
  );
  return !names.includes("TEST");
}

/** Total active products under a root category (direct + via subcategories) */
export function countProductsInCategory(
  products: Product[],
  categoryId: string,
  categories: Category[]
): number {
  const subIds = new Set(
    categories.filter((c) => c.parentId === categoryId).map((c) => c.id)
  );
  return products.filter((p) => {
    if (!isPublicMenuProduct(p)) return false;
    if (p.categoryId !== categoryId) return false;
    if (p.subcategoryId) return subIds.has(p.subcategoryId);
    return true;
  }).length;
}

export function countProductsInSubcategory(products: Product[], subcategoryId: string): number {
  return products.filter((p) => isPublicMenuProduct(p) && p.subcategoryId === subcategoryId).length;
}

export function filterMenuProducts(
  products: Product[],
  categoryId: string | null,
  subcategoryId: string | null,
  categories: Category[]
): Product[] {
  const active = products.filter(isPublicMenuProduct);

  if (!categoryId) return active;

  if (subcategoryId) {
    return active.filter((p) => p.subcategoryId === subcategoryId);
  }

  if (hasSubcategories(categories, categoryId)) {
    return [];
  }

  return active.filter((p) => p.categoryId === categoryId && !p.subcategoryId);
}

/**
 * Digital menu display: ALL products for a root category (including subcategories), or for every
 * root when no category is picked ("All"). Same visibility as the storefront catalog
 * (buildCatalogSections): a product shows only under a visible root category or a visible
 * subcategory of one, so hiding a category in the admin hides its products here too.
 */
export function filterMenuDisplayProducts(
  products: Product[],
  categoryId: string | null,
  categories: Category[]
): Product[] {
  const roots = getRootCategories(categories).filter((root) => !categoryId || root.id === categoryId);
  const rootIds = new Set(roots.map((root) => root.id));
  const childIds = new Set(
    categories
      .filter((c) => c.parentId != null && rootIds.has(c.parentId) && isPublicMenuCategory(c))
      .map((c) => c.id)
  );

  return sortProducts(
    products.filter(
      (p) =>
        isPublicMenuProduct(p) &&
        (rootIds.has(p.categoryId) ||
          childIds.has(p.categoryId) ||
          (p.subcategoryId != null && childIds.has(p.subcategoryId)))
    )
  );
}

export function sortProducts(products: Product[]): Product[] {
  return [...products].sort(
    (a, b) =>
      Number(b.isPopular) - Number(a.isPopular) ||
      a.sortOrder - b.sortOrder
  );
}

function createdAtMs(product: Product): number {
  const ms = new Date(product.createdAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Storefront display filters + sort (customer catalog, browse and search).
 * Default / "popular" sort is identical to sortProducts(); ties fall back to sortOrder.
 */
export function applyDisplayFilters(
  products: Product[],
  filters: ProductFilters | undefined,
  locale: Locale
): Product[] {
  let result = products;
  if (filters?.minPrice !== undefined) {
    result = result.filter((p) => p.price >= filters.minPrice!);
  }
  if (filters?.maxPrice !== undefined) {
    result = result.filter((p) => p.price <= filters.maxPrice!);
  }
  if (filters?.isPopular) result = result.filter((p) => p.isPopular);
  if (filters?.isNew) result = result.filter((p) => p.isNew);
  if (filters?.available === true) result = result.filter((p) => p.available);

  const bySortOrder = (a: Product, b: Product) => a.sortOrder - b.sortOrder;
  switch (filters?.sortBy) {
    case "menu":
      return [...result].sort(bySortOrder);
    case "price-asc":
      return [...result].sort((a, b) => a.price - b.price || bySortOrder(a, b));
    case "price-desc":
      return [...result].sort((a, b) => b.price - a.price || bySortOrder(a, b));
    case "name-asc":
      return [...result].sort(
        (a, b) =>
          getLocalizedName(a, locale).localeCompare(getLocalizedName(b, locale), locale) ||
          bySortOrder(a, b)
      );
    case "newest":
      return [...result].sort((a, b) => createdAtMs(b) - createdAtMs(a) || bySortOrder(a, b));
    case "popular":
    default:
      return sortProducts(result);
  }
}

/** Case-insensitive match on product names and descriptions in all languages. */
export function matchesCatalogSearch(product: Product, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    product.name_he,
    product.name_ar,
    product.name_en,
    product.description_he,
    product.description_ar,
    product.description_en,
  ].some((text) => (text ?? "").toLowerCase().includes(q));
}

export interface CatalogSectionGroup {
  /** null = products directly in the root category. */
  subcategory: Category | null;
  products: Product[];
}

export interface CatalogSection {
  category: Category;
  groups: CatalogSectionGroup[];
  count: number;
}

/**
 * Single-page catalog: one section per root category (in the admin's sortOrder), each with
 * its products grouped by subcategory. Display filters + sort and the search query apply to
 * every section; sections (and subcategory groups) left empty are dropped.
 */
export function buildCatalogSections(
  products: Product[],
  categories: Category[],
  filters: ProductFilters | undefined,
  locale: Locale,
  search = ""
): CatalogSection[] {
  const visible = products.filter(
    (p) => isPublicMenuProduct(p) && matchesCatalogSearch(p, search)
  );

  return getRootCategories(categories)
    .map((root) => {
      const children = categories
        .filter((c) => c.parentId === root.id && isPublicMenuCategory(c))
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const childIds = new Set(children.map((c) => c.id));
      const subOf = (p: Product): string | null =>
        p.subcategoryId && childIds.has(p.subcategoryId)
          ? p.subcategoryId
          : childIds.has(p.categoryId)
            ? p.categoryId
            : null;
      const inRoot = visible.filter(
        (p) =>
          p.categoryId === root.id ||
          childIds.has(p.categoryId) ||
          (p.subcategoryId != null && childIds.has(p.subcategoryId))
      );

      const groups: CatalogSectionGroup[] = [
        { subcategory: null, products: inRoot.filter((p) => subOf(p) === null) },
        ...children.map((child) => ({
          subcategory: child,
          products: inRoot.filter((p) => subOf(p) === child.id),
        })),
      ]
        .map((group) => ({ ...group, products: applyDisplayFilters(group.products, filters, locale) }))
        .filter((group) => group.products.length > 0);

      const count = groups.reduce((sum, group) => sum + group.products.length, 0);
      return { category: root, groups, count };
    })
    .filter((section) => section.count > 0);
}
