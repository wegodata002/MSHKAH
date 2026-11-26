import type { BannerSlide } from "@/types";

type Locale = "he" | "ar" | "en";

const HEBREW = /[֐-׿]/;

/**
 * The old single button field (`cta`) was filled with "Order Now" on older banners and was shown
 * even in Hebrew. It counts only as the Hebrew button, and only when it is written in Hebrew.
 */
export function legacyHebrewButton(banner: Pick<BannerSlide, "cta">): string {
  const cta = (banner.cta ?? "").trim();
  return HEBREW.test(cta) ? cta : "";
}

const clean = (value: string | undefined | null) => (value ?? "").trim();

/**
 * What a banner shows in a language. Nothing is borrowed from another language: a banner without
 * a title in this language shows the picture and the button only. The button text falls back to
 * the site's translated default ("הזמינו עכשיו" / "اطلب الآن" / "Order Now") — `button` is then "".
 */
export function bannerText(banner: BannerSlide, locale: Locale): { title: string; subtitle: string; button: string } {
  const title =
    locale === "he" ? clean(banner.title_he) || clean(banner.title) : clean(locale === "ar" ? banner.title_ar : banner.title_en);
  const subtitle = !title
    ? ""
    : locale === "he"
      ? clean(banner.subtitle_he) || clean(banner.subtitle)
      : clean(locale === "ar" ? banner.subtitle_ar : banner.subtitle_en);
  const button =
    locale === "he" ? clean(banner.button_he) || legacyHebrewButton(banner) : clean(locale === "ar" ? banner.button_ar : banner.button_en);
  return { title, subtitle, button };
}

/** Languages (Arabic, English) where the banner has no title, for the admin's "missing" note. */
export function bannerMissingLanguages(banner: BannerSlide): Array<"ar" | "en"> {
  return (["ar", "en"] as const).filter((locale) => !bannerText(banner, locale).title);
}
