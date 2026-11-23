import { describe, expect, it } from "vitest";
import { buildCatalogSections, matchesCatalogSearch } from "@/lib/menu/category-tree";
import type { Category, Product } from "@/types";

/** Pure, in-memory data — no Firebase, no network. */
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

const categories = [
  category("drinks", 2),
  category("desserts", 1),
  category("hidden", 3, { active: false }),
  category("cakes", 1, { parentId: "desserts", name_he: "עוגות" }),
];

const products = [
  product("cola", "drinks", 2, { price: 12 }),
  product("tea", "drinks", 1, { price: 14, isPopular: true }),
  product("brownie", "desserts", 2, { price: 28 }),
  product("cookie", "desserts", 1, { price: 18, name_en: "Choco cookie", description_he: "עוגייה" }),
  product("cheesecake", "cakes", 1, { price: 42 }),
  product("secret", "hidden", 1),
  product("draft", "drinks", 0, { active: false }),
];

const shape = (sections: ReturnType<typeof buildCatalogSections>) =>
  sections.map((s) => ({
    id: s.category.id,
    count: s.count,
    groups: s.groups.map((g) => [g.subcategory?.id ?? "-", g.products.map((p) => p.id)]),
  }));

describe("buildCatalogSections (single-page catalog)", () => {
  it("lists root categories in the admin's order, products in menu order, subcategories as groups", () => {
    expect(shape(buildCatalogSections(products, categories, { sortBy: "menu" }, "he"))).toEqual([
      { id: "desserts", count: 3, groups: [["-", ["cookie", "brownie"]], ["cakes", ["cheesecake"]]] },
      { id: "drinks", count: 2, groups: [["-", ["tea", "cola"]]] },
    ]);
  });

  it("skips inactive categories and inactive products", () => {
    const ids = buildCatalogSections(products, categories, { sortBy: "menu" }, "he").flatMap((s) =>
      s.groups.flatMap((g) => g.products.map((p) => p.id))
    );
    expect(ids).not.toContain("secret");
    expect(ids).not.toContain("draft");
  });

  it("applies filters and sort to every section and drops empty sections/groups", () => {
    expect(shape(buildCatalogSections(products, categories, { sortBy: "price-asc", maxPrice: 25 }, "he"))).toEqual([
      { id: "desserts", count: 1, groups: [["-", ["cookie"]]] },
      { id: "drinks", count: 2, groups: [["-", ["cola", "tea"]]] },
    ]);
    expect(shape(buildCatalogSections(products, categories, { minPrice: 40 }, "he"))).toEqual([
      { id: "desserts", count: 1, groups: [["cakes", ["cheesecake"]]] },
    ]);
  });

  it("search matches names/descriptions in any language across all sections", () => {
    expect(matchesCatalogSearch(products[3]!, "COOKIE")).toBe(true);
    expect(shape(buildCatalogSections(products, categories, { sortBy: "menu" }, "he", "עוגייה"))).toEqual([
      { id: "desserts", count: 1, groups: [["-", ["cookie"]]] },
    ]);
    expect(buildCatalogSections(products, categories, { sortBy: "menu" }, "he", "zzz")).toEqual([]);
  });
});
