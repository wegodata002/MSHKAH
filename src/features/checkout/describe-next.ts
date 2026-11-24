import { addLocalDays, formatLocalTime, localDateOf } from "@/lib/fulfillment/availability";
import { OPENING_DAY_KEYS } from "@/lib/settings/opening-hours";
import type { Locale } from "@/lib/i18n/types";

const FULL_DAY_NAMES: Record<Locale, Record<(typeof OPENING_DAY_KEYS)[number], string>> = {
  he: { sun: "ראשון", mon: "שני", tue: "שלישי", wed: "רביעי", thu: "חמישי", fri: "שישי", sat: "שבת" },
  ar: { sun: "الأحد", mon: "الاثنين", tue: "الثلاثاء", wed: "الأربعاء", thu: "الخميس", fri: "الجمعة", sat: "السبت" },
  en: { sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday" },
};

/**
 * "today at 07:00" / "tomorrow at 07:00" / "Sunday at 07:00" (style "at"), or the "from" form
 * used for delivery ("from 07:00", "tomorrow from 07:00", "Sunday from 07:00"). Israel time.
 */
export function describeNext(
  t: (key: string) => string,
  locale: Locale,
  next: Date,
  now: Date,
  style: "at" | "from"
): string {
  const time = formatLocalTime(next);
  const today = localDateOf(now);
  const day = localDateOf(next);
  const same = (a: typeof today, b: typeof today) => a.year === b.year && a.month === b.month && a.day === b.day;
  const which = same(day, today) ? "today" : same(day, addLocalDays(today, 1)) ? "tomorrow" : "day";
  const dayKey = OPENING_DAY_KEYS[new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()]!;
  return t(`checkout.when.${which}.${style}`)
    .replace("{time}", time)
    .replace("{day}", (FULL_DAY_NAMES[locale] ?? FULL_DAY_NAMES.en)[dayKey]);
}
