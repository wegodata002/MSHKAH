import { describe, expect, it } from "vitest";
import { applyDisplayFilters, sortProducts } from "@/lib/menu/category-tree";
import type { Product } from "@/types";

/** Pure, in-memory products — no Firebase, no network. */
function product(id: string, overrides: Partial<Product> = {}): Product {
  return {
    id,
    name_he: id,
    name_ar: id,
    name_en: id,
    description_he: "",
    description_ar: "",
    description_en: "",
    categoryId: "cat",
    price: 30,
    cost: 0,
    profit: 0,
    businessType: "food",
    image: "",
    isPopular: false,
    isNew: false,
    available: true,
    active: true,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const ids = (products: Product[]) => products.map((p) => p.id);

const menu = [
  product("latte", { price: 18, sortOrder: 2, isPopular: true, name_he: "לאטה", name_ar: "لاتيه", name_en: "Latte" }),
  product("cake", { price: 42, sortOrder: 1, name_he: "עוגה", name_ar: "كعكة", name_en: "Cake" }),
  product("salad", { price: 36, sortOrder: 3, isNew: true, name_he: "סלט", name_ar: "سلطة", name_en: "Salad", createdAt: "2026-06-01T00:00:00.000Z" }),
  product("espresso", { price: 12, sortOrder: 4, available: false, name_he: "אספרסו", name_ar: "إسبريسو", name_en: "Espresso" }),
];

describe("applyDisplayFilters (customer catalog)", () => {
  it("default / popular sort is identical to sortProducts", () => {
    expect(ids(applyDisplayFilters(menu, undefined, "he"))).toEqual(ids(sortProducts(menu)));
    expect(ids(applyDisplayFilters(menu, { sortBy: "popular" }, "he"))).toEqual(ids(sortProducts(menu)));
  });

  it("'menu' sorts by the admin's sortOrder only (popular items are not pulled to the top)", () => {
    expect(ids(applyDisplayFilters(menu, { sortBy: "menu" }, "he"))).toEqual(["cake", "latte", "salad", "espresso"]);
  });

  it("sorts by price ascending and descending", () => {
    expect(ids(applyDisplayFilters(menu, { sortBy: "price-asc" }, "he"))).toEqual(["espresso", "latte", "salad", "cake"]);
    expect(ids(applyDisplayFilters(menu, { sortBy: "price-desc" }, "he"))).toEqual(["cake", "salad", "latte", "espresso"]);
  });

  it("sorts by the name in the current locale", () => {
    expect(ids(applyDisplayFilters(menu, { sortBy: "name-asc" }, "en"))).toEqual(["cake", "espresso", "latte", "salad"]);
    // Hebrew alphabet: א (אספרסו) < ל (לאטה) < ס (סלט) < ע (עוגה)
    expect(ids(applyDisplayFilters(menu, { sortBy: "name-asc" }, "he"))).toEqual(["espresso", "latte", "salad", "cake"]);
  });

  it("applies price ranges (inclusive)", () => {
    expect(ids(applyDisplayFilters(menu, { maxPrice: 25, sortBy: "price-asc" }, "he"))).toEqual(["espresso", "latte"]);
    expect(ids(applyDisplayFilters(menu, { minPrice: 25, maxPrice: 40, sortBy: "price-asc" }, "he"))).toEqual(["salad"]);
    expect(ids(applyDisplayFilters(menu, { minPrice: 40 }, "he"))).toEqual(["cake"]);
  });

  it("applies popular / new / available toggles and newest sort", () => {
    expect(ids(applyDisplayFilters(menu, { isPopular: true }, "he"))).toEqual(["latte"]);
    expect(ids(applyDisplayFilters(menu, { isNew: true }, "he"))).toEqual(["salad"]);
    expect(ids(applyDisplayFilters(menu, { available: true, sortBy: "price-asc" }, "he"))).toEqual(["latte", "salad", "cake"]);
    expect(ids(applyDisplayFilters(menu, { sortBy: "newest" }, "he"))[0]).toBe("salad");
  });

  it("does not mutate the input array", () => {
    const copy = [...menu];
    applyDisplayFilters(menu, { sortBy: "price-desc" }, "he");
    expect(ids(menu)).toEqual(ids(copy));
  });
});
