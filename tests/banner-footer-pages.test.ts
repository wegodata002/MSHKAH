import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { bannerMissingLanguages, bannerText, legacyHebrewButton } from "@/lib/banners/display";
import { bannerToDraft } from "@/lib/banners/manager";
import {
  checkPublish,
  INFO_LANGS,
  INFO_PAGE_IDS,
  parseInfoPages,
  placeholdersIn,
  publishedText,
  textBlocks,
  tidyCopy,
  type InfoPageCopy,
} from "@/lib/info-pages/content";
import { INFO_PAGE_DRAFTS } from "@/lib/info-pages/drafts";
import { isCustomerOnlyPath } from "@/lib/domains/host-routing";
import { UI_TRANSLATIONS_SEED } from "@/data/ui-translations-seed";
import { ADMIN_TRANSLATIONS } from "@/data/admin-translations";
import type { BannerSlide } from "@/types";

const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");

// The live banner today: Hebrew title/subtitle only, the old button field "Order Now".
const LIVE: BannerSlide = {
  id: "b1",
  title: "ארוחת בוקר מיוחדת",
  subtitle: "שקשוקה טרייה מהמטבח — מומלץ!",
  title_he: "ארוחת בוקר מיוחדת",
  subtitle_he: "שקשוקה טרייה מהמטבח — מומלץ!",
  cta: "Order Now",
  ctaAction: "link",
  ctaUrl: "/catalog",
  image: "/x.jpg",
  active: true,
  sortOrder: 0,
} as BannerSlide;

describe("banner text per language", () => {
  it('the old "Order Now" is not shown in Hebrew: the translated default is used', () => {
    expect(legacyHebrewButton(LIVE)).toBe("");
    expect(bannerText(LIVE, "he").button).toBe("");
    expect(bannerToDraft(LIVE).buttonHe).toBe("");
    // An old Hebrew button text is kept.
    expect(bannerText({ ...LIVE, cta: "לתפריט" }, "he").button).toBe("לתפריט");
  });

  it("no title in the language → picture and button only (nothing borrowed from Hebrew)", () => {
    expect(bannerText(LIVE, "he")).toEqual({ title: "ארוחת בוקר מיוחדת", subtitle: "שקשוקה טרייה מהמטבח — מומלץ!", button: "" });
    expect(bannerText(LIVE, "ar")).toEqual({ title: "", subtitle: "", button: "" });
    expect(bannerText(LIVE, "en")).toEqual({ title: "", subtitle: "", button: "" });
    expect(bannerMissingLanguages(LIVE)).toEqual(["ar", "en"]);
  });

  it("each language's own texts", () => {
    const full = { ...LIVE, title_ar: "فطور مميّز", title_en: "Special Breakfast", subtitle_en: "Fresh shakshuka", button_en: "Order", button_ar: "اطلب" };
    expect(bannerText(full, "en")).toEqual({ title: "Special Breakfast", subtitle: "Fresh shakshuka", button: "Order" });
    expect(bannerText(full, "ar")).toEqual({ title: "فطور مميّز", subtitle: "", button: "اطلب" });
    expect(bannerMissingLanguages(full)).toEqual([]);
  });

  it("button default is translated in all three languages", () => {
    expect(UI_TRANSLATIONS_SEED.he["hero.orderNow"]).toBe("הזמינו עכשיו");
    expect(UI_TRANSLATIONS_SEED.ar["hero.orderNow"]).toBe("اطلب الآن");
    expect(UI_TRANSLATIONS_SEED.en["hero.orderNow"]).toBe("Order Now");
    const hero = read("src/features/catalog/banner-hero.tsx");
    expect(hero).toContain('content.button || t("hero.orderNow")');
    expect(hero).not.toMatch(/banner\.cta[^A-Za-z]/); // the old field (ctaAction/ctaUrl are fine)
  });

  it("layout: no text on the picture — a side column on desktop, a strip under it on the phone", () => {
    const hero = read("src/features/catalog/banner-hero.tsx");
    expect(hero).toContain('className="object-contain"');
    expect(hero).toContain("w-[32%] max-w-[380px]");
    expect(hero).not.toContain("bg-gradient-to-l");
    expect(hero).toContain('<div className="relative h-[clamp(150px,25svh,220px)] w-full">{picture}</div>');
    // The carousel dots sit on the picture, not on the text.
    expect(read("src/features/catalog/hero-banner.tsx")).toContain('<BannerHero banner={activeBanner} device="mobile">{dots}</BannerHero>');
  });

  it("admin: no button text required (translated default), missing languages noted", () => {
    const wizard = read("src/features/admin/banners/banner-wizard.tsx");
    expect(wizard).not.toContain('(draft.buttonHe || draft.cta || "").trim()');
    expect(wizard).toContain("data-banner-missing-note");
    expect(read("src/features/admin/banners-admin.tsx")).toContain("data-banner-missing");
  });
});

describe("info pages: drafts", () => {
  it("every page has a first draft in Hebrew, Arabic and English", () => {
    for (const id of INFO_PAGE_IDS) {
      for (const lang of INFO_LANGS) {
        const text = INFO_PAGE_DRAFTS[id][lang];
        expect(id === "faq" ? text.items.length : text.body.length, `${id}/${lang}`).toBeGreaterThan(0);
      }
    }
    const faq = INFO_PAGE_DRAFTS.faq;
    expect(faq.ar.items).toHaveLength(faq.he.items.length);
    expect(faq.en.items).toHaveLength(faq.he.items.length);
  });

  it("the business's own details are marked [[...]] in every language, so they cannot be published by mistake", () => {
    for (const id of ["accessibility", "terms", "privacy"] as const) {
      for (const lang of INFO_LANGS) expect(placeholdersIn(INFO_PAGE_DRAFTS[id][lang]).length, `${id}/${lang}`).toBeGreaterThan(0);
      expect(checkPublish(id, INFO_PAGE_DRAFTS[id])).toMatchObject({ ok: false, reason: "PLACEHOLDERS" });
    }
    expect(checkPublish("faq", INFO_PAGE_DRAFTS.faq)).toEqual({ ok: true, missing: [] });
  });
});

describe("info pages: saving and showing", () => {
  const body = (he: string, ar = "", en = ""): InfoPageCopy => ({
    he: { body: he, items: [] },
    ar: { body: ar, items: [] },
    en: { body: en, items: [] },
  });

  it("nothing saved: drafts come from code, nothing is published", () => {
    const pages = parseInfoPages(null, INFO_PAGE_DRAFTS);
    for (const id of INFO_PAGE_IDS) {
      expect(pages[id].published).toBeNull();
      expect(pages[id].draft).toEqual(INFO_PAGE_DRAFTS[id]);
    }
  });

  it("the site shows only the published copy; an empty language shows the Hebrew", () => {
    const pages = parseInfoPages({ pages: { terms: { draft: body("טיוטה"), published: body("פורסם", "", "Published") } } }, INFO_PAGE_DRAFTS);
    expect(publishedText("terms", pages.terms, "en")).toEqual({ text: { body: "Published", items: [] }, lang: "en" });
    expect(publishedText("terms", pages.terms, "ar")).toEqual({ text: { body: "פורסם", items: [] }, lang: "he" });
    expect(publishedText("privacy", pages.privacy, "he")).toBeNull();
  });

  it("publish needs Hebrew and no [[...]]; empty languages are listed", () => {
    expect(checkPublish("terms", body(""))).toEqual({ ok: false, reason: "EMPTY_HEBREW" });
    expect(checkPublish("terms", body("x", "[[الاسم]]"))).toMatchObject({ ok: false, reason: "PLACEHOLDERS", placeholders: ["[[الاسم]]"] });
    expect(checkPublish("terms", body("x", "", "y"))).toEqual({ ok: true, missing: ["ar"] });
  });

  it("half-empty FAQ rows are dropped before saving", () => {
    const faq: InfoPageCopy = {
      he: { body: "", items: [{ q: " ש ", a: " ת " }, { q: "", a: "" }] },
      ar: { body: "", items: [] },
      en: { body: "", items: [] },
    };
    expect(tidyCopy("faq", faq).he.items).toEqual([{ q: "ש", a: "ת" }]);
  });

  it("text format: ## heading, - list, empty line = new paragraph; no HTML", () => {
    expect(textBlocks("## כותרת\nשורה 1\nשורה 2\n\n- א\n- ב\nסוף <b>x</b>")).toEqual([
      { kind: "heading", text: "כותרת" },
      { kind: "paragraph", text: "שורה 1\nשורה 2" },
      { kind: "list", items: ["א", "ב"] },
      { kind: "paragraph", text: "סוף <b>x</b>" },
    ]);
    const view = read("src/features/info-pages/info-page-view.tsx");
    expect(view).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("info pages: wiring", () => {
  it("footer links to the published pages, never to the account page", () => {
    const footer = read("src/components/layout/footer.tsx");
    expect(footer).not.toContain('href: "/account"');
    expect(footer).toContain("infoPages?.[id].published");
    expect(footer).toContain("setPanelOpen(true)");
  });

  it("4 routes, kept off the admin portal", () => {
    for (const path of ["/faq", "/accessibility", "/terms", "/privacy"]) {
      expect(isCustomerOnlyPath(path)).toBe(true);
      expect(read(`src/app${path}/page.tsx`)).toContain(`<InfoPageView id="${path.slice(1)}" />`);
    }
    expect(read("src/features/admin/admin-nav-config.ts")).toContain('{ segment: "info-pages", labelKey: "admin.infoPages", icon: BookOpen }');
  });

  it("every new text exists in Hebrew, Arabic and English", () => {
    const keys = (map: Record<string, string>, prefix: string) => Object.keys(map).filter((k) => k.startsWith(prefix)).sort();
    for (const [source, prefix] of [[UI_TRANSLATIONS_SEED, "info."], [ADMIN_TRANSLATIONS, "admin.infoPages"], [ADMIN_TRANSLATIONS, "admin.banners.lang."]] as const) {
      const he = keys(source.he, prefix);
      expect(he.length).toBeGreaterThan(0);
      expect(keys(source.ar, prefix)).toEqual(he);
      expect(keys(source.en, prefix)).toEqual(he);
    }
  });
});
