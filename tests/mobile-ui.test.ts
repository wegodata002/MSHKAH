import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCatalogSections, filterMenuDisplayProducts } from "@/lib/menu/category-tree";
import { isCustomerOnlyPath, isOrderingPath } from "@/lib/domains/host-routing";
import type { Category, Product } from "@/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function category(id: string, sortOrder: number, overrides: Partial<Category> = {}): Category {
  return {
    id,
    name_he: id,
    name_ar: id,
    name_en: id,
    icon: "coffee",
    image: "",
    color: "#000",
    sortOrder,
    active: true,
    parentId: null,
    ...overrides,
  } as Category;
}

function product(id: string, categoryId: string, sortOrder: number, overrides: Partial<Product> = {}): Product {
  return {
    id,
    name_he: id,
    name_ar: id,
    name_en: id,
    description_he: "",
    description_ar: "",
    description_en: "",
    categoryId,
    price: 30,
    cost: 0,
    profit: 0,
    businessType: "food",
    image: "",
    isPopular: false,
    isNew: false,
    available: true,
    active: true,
    sortOrder,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("digital menu (QR): same visibility as the catalog", () => {
  const categories = [
    category("drinks", 1),
    category("hot", 2, { parentId: "drinks" }),
    category("hiddenSub", 3, { parentId: "drinks", active: false }),
    category("hiddenRoot", 4, { active: false }),
  ];
  const products = [
    product("espresso", "drinks", 1),
    product("latte", "hot", 2),
    product("inHiddenSub", "hiddenSub", 3),
    product("inHiddenRoot", "hiddenRoot", 4),
    product("orphan", "deleted-category", 5),
    product("hiddenProduct", "drinks", 6, { hidden: true }),
  ];

  it('"All" leaves out products of hidden or missing categories', () => {
    const ids = filterMenuDisplayProducts(products, null, categories).map((p) => p.id);
    expect(ids).toEqual(["espresso", "latte"]);
  });

  it('"All" shows exactly what the storefront catalog shows', () => {
    const catalogIds = buildCatalogSections(products, categories, undefined, "he")
      .flatMap((section) => section.groups.flatMap((group) => group.products.map((p) => p.id)))
      .sort();
    const menuIds = filterMenuDisplayProducts(products, null, categories).map((p) => p.id).sort();
    expect(menuIds).toEqual(catalogIds);
  });

  it("a picked category includes its visible subcategories only", () => {
    expect(filterMenuDisplayProducts(products, "drinks", categories).map((p) => p.id)).toEqual([
      "espresso",
      "latte",
    ]);
    expect(filterMenuDisplayProducts(products, "hiddenRoot", categories)).toEqual([]);
  });

  it("cards are two per row on phones", () => {
    const view = read("src/features/menu-display/menu-display-view.tsx");
    expect(view).toMatch(/grid grid-cols-2 gap-3/);
    expect(view).not.toMatch(/grid-cols-1/);
  });
});

describe("floating buttons fade out while the footer is on screen", () => {
  it("assistant, accessibility and checkout buttons all follow the footer", () => {
    for (const file of [
      "src/features/assistant/assistant-fab.tsx",
      "src/components/accessibility/accessibility-center.tsx",
      "src/features/cart/checkout-fab.tsx",
    ]) {
      const src = read(file);
      expect(src, file).toMatch(/useFooterInView\(\)/);
      expect(src, file).toMatch(/footerInView && "pointer-events-none"|\(panelOpen \|\| footerInView\) && "pointer-events-none"/);
    }
    const hook = read("src/hooks/useFooterInView.ts");
    expect(hook).toMatch(/\[data-site-footer\]/);
    // Page that scrolls: hidden only after scrolling down with the footer on screen.
    expect(hook).toMatch(/const hide = !shortPage && footerOnScreen && window\.scrollY > 0;/);
    // "Short" ignores the footer's own room for the buttons, so adding it cannot flip the decision.
    expect(hook).toMatch(/scrollHeight - \(spacer\?\.offsetHeight \?\? 0\)/);
  });

  it("short page: the buttons stay and the footer keeps room for them instead", () => {
    const footer = read("src/components/layout/footer.tsx");
    expect(footer).toMatch(/\{shortPage && <div data-fab-spacer aria-hidden className="h-\[4\.75rem\]" \/>\}/);
  });

  it("pages that scroll keep no extra room at the bottom of the footer", () => {
    const css = read("src/app/globals.css");
    expect(css).toMatch(
      /\[data-site-footer\] \{\s*padding-bottom: calc\(var\(--mobile-bottom-nav-height\) \+ env\(safe-area-inset-bottom, 0px\) \+ 0\.5rem\);/
    );
  });

  it("the assistant shows on cart and checkout too (smaller on phones)", () => {
    const fab = read("src/features/assistant/assistant-fab.tsx");
    expect(fab).not.toMatch(/pathname\.startsWith\("\/checkout"\) \|\|/);
    expect(fab).toMatch(/compact && "max-lg:h-11 max-lg:w-11"/);
  });
});

describe("bottom bar: Favorites instead of Account", () => {
  it("links to /favorites and no longer to /account", () => {
    const nav = read("src/components/layout/bottom-nav.tsx");
    expect(nav).toMatch(/href: "\/favorites", labelKey: "nav\.favorites"/);
    expect(nav).not.toMatch(/href: "\/account"/);
    expect(existsSync(resolve(process.cwd(), "src/components/layout/mobile-bottom-nav.tsx"))).toBe(false);
    expect(existsSync(resolve(process.cwd(), "src/app/favorites/page.tsx"))).toBe(true);
  });

  it("is a storefront-only page (not on the portal or the view-only menu)", () => {
    expect(isCustomerOnlyPath("/favorites")).toBe(true);
    expect(isOrderingPath("/favorites")).toBe(true);
  });

  it("has labels in all three languages", () => {
    const seed = read("src/data/ui-translations-seed.ts");
    expect(seed.match(/"nav\.favorites":/g)).toHaveLength(3);
    expect(seed.match(/"favorites\.emptyTitle":/g)).toHaveLength(3);
  });

  it("favourites are one shared copy for the whole page", () => {
    const hook = read("src/hooks/useFavorites.ts");
    expect(hook).toMatch(/useSyncExternalStore/);
    expect(hook).toMatch(/"mishkat-favorites"/);
  });
});

describe("product cards are smaller on phones", () => {
  it("4:3 photo on every screen size", () => {
    const card = read("src/features/catalog/product-card.tsx");
    expect(card).toMatch(/relative aspect-\[4\/3\] w-full/);
    expect(card).not.toMatch(/aspect-square/);
  });
});
