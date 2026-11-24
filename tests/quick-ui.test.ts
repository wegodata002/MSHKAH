import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseAssistantConfig } from "@/lib/assistant/parse-config";
import { DEFAULT_ASSISTANT_CONFIG, PREVIOUS_DEFAULT_GREETING } from "@/lib/assistant/types";

/** Pure — no Firebase, no network. */
describe("assistant opening message", () => {
  it('says "pick a topic from the buttons, or type a product or category name", in three languages', () => {
    expect(DEFAULT_ASSISTANT_CONFIG.greeting.he).toMatch(/בחרו נושא מהכפתורים, או כתבו שם של מוצר או קטגוריה\.$/);
    expect(DEFAULT_ASSISTANT_CONFIG.greeting.ar).toMatch(/اختاروا موضوعاً من الأزرار، أو اكتبوا اسم منتج أو فئة\.$/);
    expect(DEFAULT_ASSISTANT_CONFIG.greeting.en).toMatch(/Pick a topic from the buttons, or type a product or category name\.$/);
  });

  it("the old default stored in the live settings shows the new text", () => {
    const config = parseAssistantConfig({ greeting: { ...PREVIOUS_DEFAULT_GREETING } });
    expect(config.greeting).toEqual(DEFAULT_ASSISTANT_CONFIG.greeting);
  });

  it("a greeting the manager wrote is kept as is (per language)", () => {
    const config = parseAssistantConfig({ greeting: { he: "ברוכים הבאים!", ar: PREVIOUS_DEFAULT_GREETING.ar, en: "Hi there" } });
    expect(config.greeting).toEqual({ he: "ברוכים הבאים!", ar: DEFAULT_ASSISTANT_CONFIG.greeting.ar, en: "Hi there" });
  });
});

describe("site footer", () => {
  it("compact and reaching the bottom of the page", () => {
    const footer = readFileSync(resolve(process.cwd(), "src/components/layout/footer.tsx"), "utf8");
    expect(footer).toMatch(/data-site-footer/);
    expect(footer).toMatch(/grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4/);
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(css).toMatch(/body:has\(\[data-site-footer\]\) \{\s*padding-bottom: 0;/);
    expect(css).toMatch(/\[data-site-footer\] \{\s*padding-bottom: calc\(var\(--mobile-bottom-nav-height\)/);
  });
});

// ── Assistant: questions it does not understand ───────────────────────
import { processMessage } from "@/lib/assistant/engine";
import { isRelevantMatch } from "@/lib/assistant/fuzzy";
import type { AssistantContext, AssistantProduct } from "@/lib/assistant/types";

function product(id: string, name: string, description: string, categoryId = "c1", isPopular = false): AssistantProduct {
  return { id, name, description, searchText: `${name} ${description}`, price: 20, image: "", categoryId, available: true, isPopular, isNew: false };
}
const CATALOG: AssistantProduct[] = [
  product("latte", "לאטה", "קפה עם חלב מוקצף", "hot", true),
  product("ice-latte", "אייס לאטה", "קפה קר עם קרח"),
  product("breakfast", "ארוחת בוקר זוגית", "שתי ביצים לבחירה, סלט, לאבנה, גבינת שמנת וסומק", "food", true),
  product("ice-box", "קופסת גלידה 1 ק״ג", "קופסת גלידה", "ice"),
  product("tres", "תרליצ׳י", "עוגה אוורירית ורכה עם רוטב קרמל מתוק", "dessert"),
  product("tea", "תה", "תה חם עם נענע", "hot"),
  product("scoop", "A scoop of ice cream", "Ice cream scoop flavors to choose from", "ice"),
];
function context(locale: "he" | "ar" | "en", phone = "0587887090"): AssistantContext {
  return {
    locale,
    products: CATALOG,
    categories: [
      { id: "hot", name: "משקאות חמים", searchText: "משקאות חמים مشروبات ساخنة Hot drinks", parentId: null, names: [] },
      { id: "dessert", name: "קינוחים", searchText: "קינוחים حلويات Desserts", parentId: null, names: [] },
    ],
    config: DEFAULT_ASSISTANT_CONFIG,
    settings: { phone, address: "", hours: "", whatsapp: "", mapsUrl: "" },
    banners: [],
  };
}
const ask = (message: string, locale: "he" | "ar" | "en" = "he", phone?: string) =>
  processMessage({ message, locale }, context(locale, phone));

describe("assistant: not understood → polite, buttons + phone (no random products as 'results')", () => {
  it.each([
    ["מה מזג האוויר מחר?", "he"],
    ["יש לכם חניה?", "he"],
    ["קשקשקש", "he"],
    ["what's the weather tomorrow?", "en"],
    ["qwxzv", "en"],
    ["كيف حال الطقس؟", "ar"],
  ] as const)("%s", (message, locale) => {
    const res = ask(message, locale);
    expect(res.message).not.toMatch(/תוצאות עבור|Results for|نتائج/);
    expect(res.message).toMatch(/סליחה, לא הבנתי|Sorry, I didn't understand|عذرًا، لم أفهم/);
    expect(res.message).toContain("0587887090");
    expect(res.showContact).toBe(true);
    expect(res.suggestions?.length).toBeGreaterThan(0);
  });

  it("the three languages, and without a phone in the settings the phone line is left out", () => {
    expect(ask("קשקשקש").message).toContain("אפשר לבחור נושא מהכפתורים, או לכתוב שם של מוצר או קטגוריה");
    expect(ask("ززززز", "ar").message).toContain("يمكنكم اختيار موضوع من الأزرار");
    expect(ask("qwxzv", "en").message).toContain("Pick a topic from the buttons, or type a product or category name");
    expect(ask("קשקשקש", "he", "").message).not.toMatch(/בטלפון/);
  });

  it("real product / category searches still work (also with a typo, a prefix, or a sentence)", () => {
    const found = (q: string, locale: "he" | "ar" | "en" = "he") => ask(q, locale).products.map((p) => p.id);
    expect(found("לאטה")).toContain("latte");
    expect(found("תה")).toContain("tea");
    expect(found("קפה קר")[0]).toBe("ice-latte"); // best match first
    expect(found("קפה קר")).not.toContain("breakfast");
    expect(found("יש לכם גלידה?")).toContain("ice-box");
    expect(found("בא לי משהו מתוק")).toContain("tres");
    expect(found("הלאטה")).toContain("latte");
    expect(found("אייס לאטה")[0]).toBe("ice-latte");
    expect(found("ice cream", "en")).toContain("scoop");
    expect(found("קינוחים")).toContain("tres");
  });

  it("isRelevantMatch: a shared small word is not enough", () => {
    expect(isRelevantMatch("מה מזג האוויר מחר", "ארוחת בוקר מה שתרצו")).toBe(false);
    expect(isRelevantMatch("קפה קר", "אייס לאטה קפה קר עם קרח")).toBe(true);
    expect(isRelevantMatch("what is the weather", "whipped cream")).toBe(false);
  });
});

describe("assistant: not understood shows no products; cappuccino = הפוך", () => {
  const CAPP: AssistantProduct = {
    id: "hafuch",
    name: "הפוך",
    description: "",
    searchText: "הפוך هفوخ Cappuccino",
    price: 14,
    image: "",
    categoryId: "hot",
    available: true,
    isPopular: true,
    isNew: false,
  };
  const withCapp = (locale: "he" | "ar" | "en"): AssistantContext => ({ ...context(locale), products: [...CATALOG, CAPP] });

  it("only the message (+ buttons + phone), no products and no 'favourites' line", () => {
    for (const [q, locale] of [["מה מזג האוויר מחר?", "he"], ["كيف حال الطقس؟", "ar"], ["qwxzv", "en"]] as const) {
      const res = processMessage({ message: q, locale }, withCapp(locale));
      expect(res.products).toEqual([]);
      expect(res.message).not.toMatch(/בינתיים|وإلى ذلك|Meanwhile/);
      expect(res.showContact).toBe(true);
      expect(res.suggestions?.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ["קפוצינו", "he"],
    ["קפוצ'ינו", "he"],
    ["קפוצ׳ינו", "he"],
    ["בא לי קפוצ'ינו", "he"],
    ["كابتشينو", "ar"],
    ["كابوتشينو", "ar"],
    ["cappuccino", "en"],
    ["capuccino", "en"],
  ] as const)("%s → הפוך", (q, locale) => {
    const res = processMessage({ message: q, locale }, withCapp(locale));
    expect(res.products.map((p) => p.id)).toContain("hafuch");
  });
});
