import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { allowedTypos, foldWord, typoTextMatch } from "@/lib/search/typo";
import { buildCatalogSections, catalogSearchMatcher } from "@/lib/menu/category-tree";
import { processMessage } from "@/lib/assistant/engine";
import { buildAssistantContext } from "@/lib/assistant/build-context";
import { DEFAULT_ASSISTANT_CONFIG } from "@/lib/assistant/types";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { cartReducer } from "@/features/cart/cart-context";
import { UI_TRANSLATIONS_SEED } from "@/data/ui-translations-seed";
import type { Locale } from "@/lib/i18n/types";
import type { Category, Product } from "@/types";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

function product(id: string, he: string, ar: string, en: string): Product {
  return {
    id, name_he: he, name_ar: ar, name_en: en, description_he: "", description_ar: "", description_en: "",
    categoryId: "drinks", price: 16, cost: 0, profit: 0, businessType: "cafe", image: "", isPopular: false, isNew: false,
    available: true, active: true, sortOrder: 0, createdAt: "2026-01-01", updatedAt: "2026-01-01",
  } as Product;
}
const MENU = [
  product("latte", "לאטה", "لاتيه", "Latte"),
  product("lasagna", "לאזניה", "لازانيا", "Lasagna"),
  product("croissant", "קרואסון חמאה", "كرواسون بالزبدة", "Butter croissant"),
  product("mojito", "מוחיטו", "موهيتو", "Mojito"),
  product("crepe", "קרפ מתוק", "كريب حلو", "Sweet crepe"),
  product("coffee", "קפה שחור", "قهوة سوداء", "Black coffee"),
];
const CATEGORIES = [{ id: "drinks", name_he: "שתייה", name_ar: "مشروبات", name_en: "Drinks", active: true, sortOrder: 0, parentId: null }] as unknown as Category[];

describe("search that forgives a small typo", () => {
  it("evens out spelling that sounds the same (he / ar / en)", () => {
    expect(foldWord("לאטע")).toBe(foldWord("לאטה"));
    expect(foldWord("כפה")).toBe(foldWord("קפה"));
    expect(foldWord("טה")).toBe(foldWord("תה"));
    expect(foldWord("قهوة")).toBe(foldWord("قهوه"));
    expect(foldWord("Latte")).toBe(foldWord("late"));
    expect([allowedTypos(3), allowedTypos(5), allowedTypos(9)]).toEqual([0, 1, 2]);
  });

  it("typos match; unrelated words don't", () => {
    for (const [q, t] of [["לאטע", "לאטה"], ["קרואסן", "קרואסון חמאה"], ["קרוסון", "קרואסון חמאה"], ["latey", "Latte"], ["croisant", "Butter croissant"], ["لاته", "لاتيه"], ["אספרסוו", "אספרסו"]]) {
      expect(typoTextMatch(q!, t!), `${q} → ${t}`).toBe(true);
    }
    for (const [q, t] of [["לאטה", "לאזניה"], ["מוקה", "מוחיטו"], ["קפה", "קרפ מתוק"], ["קרפ", "קפה שחור"], ["פיצה", "פסטה"], ["סלט", "סלמון"], ["בורקס", "בורגר"]]) {
      expect(typoTextMatch(q!, t!), `${q} ≠ ${t}`).toBe(false);
    }
  });
});

describe("menu search", () => {
  const names = (query: string) =>
    buildCatalogSections(MENU, CATEGORIES, undefined, "he", query).flatMap((s) => s.groups.flatMap((g) => g.products.map((p) => p.id)));

  it("exact results only when there are any (close matches never sit next to real ones)", () => {
    expect(names("לאטה")).toEqual(["latte"]);
    expect(catalogSearchMatcher(MENU, "לאטה").fuzzy).toBe(false);
    expect(names("קפה")).toEqual(["coffee"]); // not the crepe
  });

  it("nothing exact: close matches, in all three languages, marked as close", () => {
    expect(names("לאטע")).toEqual(["latte"]);
    expect(catalogSearchMatcher(MENU, "לאטע").fuzzy).toBe(true);
    expect(names("latey")).toEqual(["latte"]);
    expect(names("كرواسن")).toEqual(["croissant"]);
    expect(names("קרואסן")).toEqual(["croissant"]);
    expect(names("זזזז")).toEqual([]);
    for (const l of ["he", "ar", "en"] as const) expect(UI_TRANSLATIONS_SEED[l]["catalog.searchClose"]).toContain("{query}");
    expect(read("src/features/catalog/catalog-view.tsx")).toContain("data-search-close");
  });
});

describe("assistant search", () => {
  const ctx = (locale: Locale) =>
    buildAssistantContext({
      locale,
      products: MENU,
      categories: CATEGORIES,
      config: DEFAULT_ASSISTANT_CONFIG,
      banners: [],
      store: { phone: "", address: "", hoursText: "", whatsapp: "", mapsUrl: "", fulfillment: DEFAULT_FULFILLMENT, openingHours: DEFAULT_OPENING_HOURS },
    });
  const ids = (message: string, locale: Locale) => (processMessage({ message, locale }, ctx(locale)).products ?? []).map((p) => p.id);

  it("finds the product despite a small typo, in he / ar / en, without unrelated ones", () => {
    expect(ids("לאטע", "he")).toEqual(["latte"]);
    expect(ids("יש לכם לאטע?", "he")).toEqual(["latte"]);
    expect(ids("latey", "en")).toEqual(["latte"]);
    expect(ids("كرواسن", "ar")).toEqual(["croissant"]);
    expect(ids("לאטה", "he")).toEqual(["latte"]);
  });
});

describe("/cart, fields on iPhone, tablet bars", () => {
  it("loading the saved cart never closes a cart already opened (/cart), empty or not", () => {
    const open = cartReducer({ items: [], isOpen: true, couponCode: "", couponDiscount: 0 }, { type: "HYDRATE", state: { items: [] } });
    expect(open.isOpen).toBe(true);
    const closed = cartReducer({ items: [], isOpen: false, couponCode: "", couponDiscount: 0 }, { type: "HYDRATE", state: { items: [] } });
    expect(closed.isOpen).toBe(false);
    const page = read("src/app/cart/page.tsx");
    expect(page).toContain("openCart();");
    expect(page).toContain('router.replace("/catalog")');
    expect(page).not.toContain("Your cart drawer should be open");
  });

  it("fields are 16px below desktop (no iPhone zoom); the page can still be zoomed", () => {
    for (const p of ["src/components/ui/input.tsx", "src/components/ui/textarea.tsx", "src/components/ui/select.tsx"]) {
      expect(read(p), p).toContain("text-base text-dark-brown placeholder:text-coffee/50 lg:text-sm");
    }
    expect(read("src/features/assistant/assistant-drawer.tsx")).toContain("text-base outline-none placeholder:text-coffee/40 lg:text-sm");
    expect(read("src/app/checkout/page.tsx")).toContain('className="h-9 text-base lg:text-sm"');
    const layout = read("src/app/layout.tsx");
    expect(layout).not.toMatch(/maximumScale|userScalable|maximum-scale/);
  });

  it("tablet: top bar 64px, bottom bar 56px (everything above it follows the same variable)", () => {
    expect(read("src/components/layout/header.tsx")).toContain('"h-14 md:h-16 lg:h-20"');
    const css = read("src/app/globals.css");
    expect(css).toMatch(/@media \(min-width: 768px\) and \(max-width: 1023\.98px\) \{\s*:root \{\s*--mobile-bottom-nav-height: 56px;/);
    expect(read("src/features/catalog/catalog-view.tsx")).toContain("md:top-16 lg:top-20");
  });
});
