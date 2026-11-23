import { describe, expect, it } from "vitest";
import { processQuickAction } from "@/lib/assistant/engine";
import {
  DEFAULT_ASSISTANT_CONFIG,
  type AssistantContext,
  type AssistantProduct,
} from "@/lib/assistant/types";

/** Pure, in-memory context — no Firebase, no network. */
type Cat = AssistantContext["categories"][number];

function cat(id: string, names: [string, string, string], parentId: string | null = null): Cat {
  return { id, name: names[0], searchText: names.join(" "), parentId, names };
}

function product(id: string, categoryId: string, overrides: Partial<AssistantProduct> = {}): AssistantProduct {
  return {
    id,
    name: id,
    description: "",
    price: 30,
    image: "",
    categoryId,
    available: true,
    isPopular: false,
    isNew: false,
    ...overrides,
  };
}

function ctx(categories: Cat[], products: AssistantProduct[]): AssistantContext {
  return {
    locale: "he",
    products,
    categories,
    config: DEFAULT_ASSISTANT_CONFIG,
    settings: { phone: "", address: "", hours: "", whatsapp: "", mapsUrl: "" },
    banners: [],
  };
}

function run(c: AssistantContext, actionId: string) {
  return processQuickAction(actionId, c, { message: "", locale: "he", quickActionId: actionId });
}

const ids = (products: AssistantProduct[]) => products.map((p) => p.id).sort();

describe("assistant quick actions resolve real categories", () => {
  it("'All desserts' finds a desserts category with an auto-generated id (by name)", () => {
    const c = ctx(
      [cat("aB3xYz9Q", ["קינוחים", "حلويات", "Desserts"]), cat("other", ["סלטים", "سلطات", "Salads"])],
      [product("cake", "aB3xYz9Q"), product("salad", "other")]
    );
    const res = run(c, "desserts");
    expect(ids(res.products)).toEqual(["cake"]);
    expect(res.message).toContain("קינוחים");
  });

  it("includes products from subcategories of 'desserts'", () => {
    const c = ctx(
      [
        cat("desserts", ["קינוחים", "حلويات", "Desserts"]),
        cat("crepes-sweet", ["קרפים מתוקים", "كريب حلو", "Sweet crepes"], "desserts"),
        cat("waffles", ["וופלים", "وافل", "Waffles"], "crepes-sweet"),
      ],
      [product("crepe", "crepes-sweet"), product("waffle", "waffles"), product("direct", "desserts")]
    );
    expect(ids(run(c, "desserts").products)).toEqual(["crepe", "direct", "waffle"]);
  });

  it("does not return unavailable products", () => {
    const c = ctx(
      [cat("desserts", ["קינוחים", "حلويات", "Desserts"])],
      [product("on", "desserts"), product("off", "desserts", { available: false })]
    );
    expect(ids(run(c, "desserts").products)).toEqual(["on"]);
  });

  it("falls back to 'no results' + popular products when the category does not exist", () => {
    const c = ctx(
      [cat("drinks", ["שתייה", "مشروبات", "Drinks"])],
      [product("latte", "drinks", { isPopular: true }), product("tea", "drinks")]
    );
    const res = run(c, "desserts");
    expect(res.message).toBe("לא מצאתי מוצרים מתאימים. נסו לחפש שם מוצר, קטגוריה, או בחרו מהכפתורים למטה.");
    expect(res.products.length).toBeGreaterThan(0);
    expect(res.products[0]!.id).toBe("latte");
  });

  it("'All beverages' resolves seed ids by id, by name and via subcategories", () => {
    const c = ctx(
      [
        cat("hot-drinks", ["שתייה חמה", "مشروبات ساخنة", "Hot Drinks"]),
        cat("espresso", ["אספרסו", "إسبريسو", "Espresso"], "hot-drinks"),
        cat("Kx81", ["משקאות אייס", "مشروبات مثلجة", "Iced Drinks"]),
        cat("desserts", ["קינוחים", "حلويات", "Desserts"]),
      ],
      [
        product("tea", "hot-drinks"),
        product("double-shot", "espresso"),
        product("iced-latte", "Kx81"),
        product("cake", "desserts"),
      ]
    );
    expect(ids(run(c, "beverages").products)).toEqual(["double-shot", "iced-latte", "tea"]);
  });
});

describe("assistant quick actions match categories whose name contains the seed name", () => {
  // Names as they exist in the live catalog (with emoji and Hebrew/Arabic prefixes).
  const live = () =>
    ctx(
      [
        cat("trwzhFEiUaJwEGHdyMWN", ["מאפים  וקינוחים 🍰🥐  ", "مخبوزات وحلويات 🍰🥐", "Bakery & Sweets 🍰🥐"]),
        cat("0RPzpBGlV9jAsA1JGVOn", ["הסלטים שלנו 🥗 ", "سلطاتنا 🥗", "Our Salads 🥗"]),
        cat("oqfxEBhy2Ydvqspeuz3J", ["מילקשייקים ושייקי פירות 🥤", "ميلك شييك - شيك فواكه 🥤", "Milkshakes & Fruit Shake 🥤"]),
        cat("soft-drinks", ["שתייה ", "مشروبات ", " Drinks"]),
      ],
      [
        product("croissant", "trwzhFEiUaJwEGHdyMWN"),
        product("salad", "0RPzpBGlV9jAsA1JGVOn"),
        product("milkshake", "oqfxEBhy2Ydvqspeuz3J"),
        product("cola", "soft-drinks"),
      ]
    );

  it("'All desserts' finds 'מאפים וקינוחים' (contains קינוחים / حلويات)", () => {
    const res = run(live(), "desserts");
    expect(ids(res.products)).toEqual(["croissant"]);
    expect(res.message).toContain("מאפים");
  });

  it("'Salads' finds 'Our Salads' / 'הסלטים שלנו'", () => {
    expect(ids(run(live(), "salads").products)).toEqual(["salad"]);
  });

  it("'All beverages' also picks up 'מילקשייקים ושייקי פירות' (contains שייקים)", () => {
    expect(ids(run(live(), "beverages").products)).toEqual(["cola", "milkshake"]);
  });

  it("does not match unrelated categories (no false positives)", () => {
    const c = ctx(
      [cat("drinks", ["שתייה", "مشروبات", "Drinks"])],
      [product("cola", "drinks", { isPopular: true })]
    );
    const res = run(c, "desserts");
    expect(res.message).toBe("לא מצאתי מוצרים מתאימים. נסו לחפש שם מוצר, קטגוריה, או בחרו מהכפתורים למטה.");
  });
});
