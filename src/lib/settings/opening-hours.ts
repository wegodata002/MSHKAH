import type { Locale } from "@/lib/i18n/types";

/** Week order used everywhere (Israel: Sunday first). */
export const OPENING_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type OpeningDayKey = (typeof OPENING_DAY_KEYS)[number];

export type OpeningDayHours = {
  open: boolean;
  /** "HH:MM", 24h. */
  from: string;
  /** "HH:MM", 24h. May be earlier than `from` for hours past midnight. */
  to: string;
};

export type OpeningHours = Record<OpeningDayKey, OpeningDayHours>;

const DEFAULT_FROM = "07:00";
const DEFAULT_TO = "22:00";

/** First-time default: Sun–Thu 07:00–22:00, Fri and Sat closed. */
export const DEFAULT_OPENING_HOURS: OpeningHours = {
  sun: { open: true, from: DEFAULT_FROM, to: DEFAULT_TO },
  mon: { open: true, from: DEFAULT_FROM, to: DEFAULT_TO },
  tue: { open: true, from: DEFAULT_FROM, to: DEFAULT_TO },
  wed: { open: true, from: DEFAULT_FROM, to: DEFAULT_TO },
  thu: { open: true, from: DEFAULT_FROM, to: DEFAULT_TO },
  fri: { open: false, from: DEFAULT_FROM, to: DEFAULT_TO },
  sat: { open: false, from: DEFAULT_FROM, to: DEFAULT_TO },
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME_RE.test(value);
}

/** Accepts "7:00" as well as "07:00". */
function normalizeTime(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const padded = /^\d:\d\d$/.test(value.trim()) ? `0${value.trim()}` : value.trim();
  return isValidTime(padded) ? padded : fallback;
}

/**
 * Parses the stored `openingHours` map. Returns null when nothing usable is stored.
 * Missing days are treated as closed.
 */
export function normalizeOpeningHours(raw: unknown): OpeningHours | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  if (!OPENING_DAY_KEYS.some((key) => source[key] && typeof source[key] === "object")) return null;

  const result = {} as OpeningHours;
  for (const key of OPENING_DAY_KEYS) {
    const day = (source[key] && typeof source[key] === "object" ? source[key] : {}) as Record<string, unknown>;
    result[key] = {
      open: day.open === true,
      from: normalizeTime(day.from, DEFAULT_FROM),
      to: normalizeTime(day.to, DEFAULT_TO),
    };
  }
  return result;
}

/** The text that was the built-in default before the weekly schedule existed. */
function isLegacyDefaultText(hours: string): boolean {
  const compact = hours.replace(/\s+/g, "").replace(/[-‐‑–—]/g, "-").toLowerCase();
  return compact === "sun-thu7:00-22:00" || compact === "sun-thu07:00-22:00";
}

/**
 * Weekly schedule to display. A stored schedule wins; with none stored, the built-in default
 * is used when the old free-text field is empty or still the old default text. Otherwise
 * null, so callers keep showing the custom free text (backwards compatible).
 */
export function resolveOpeningHours(data: { openingHours?: unknown; hours?: string | null } | undefined): OpeningHours | null {
  const stored = normalizeOpeningHours(data?.openingHours);
  if (stored) return stored;
  const legacy = (data?.hours ?? "").trim();
  if (!legacy || isLegacyDefaultText(legacy)) return DEFAULT_OPENING_HOURS;
  return null;
}

const DAY_NAMES: Record<Locale, Record<OpeningDayKey, string>> = {
  he: { sun: "ראשון", mon: "שני", tue: "שלישי", wed: "רביעי", thu: "חמישי", fri: "שישי", sat: "שבת" },
  ar: { sun: "الأحد", mon: "الاثنين", tue: "الثلاثاء", wed: "الأربعاء", thu: "الخميس", fri: "الجمعة", sat: "السبت" },
  en: { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" },
};

const CLOSED: Record<Locale, string> = { he: "סגור", ar: "مغلق", en: "Closed" };

export function openingDayName(day: OpeningDayKey, locale: Locale): string {
  return (DAY_NAMES[locale] ?? DAY_NAMES.en)[day];
}

function sameHours(a: OpeningDayHours, b: OpeningDayHours): boolean {
  if (!a.open && !b.open) return true;
  return a.open === b.open && a.from === b.from && a.to === b.to;
}

/**
 * One line per run of consecutive days with the same hours, e.g.
 * "ראשון–חמישי: 07:00–22:00\nשישי–שבת: סגור".
 */
export function formatOpeningHours(hours: OpeningHours, locale: Locale): string {
  const lines: string[] = [];
  let start = 0;
  for (let i = 1; i <= OPENING_DAY_KEYS.length; i += 1) {
    const prev = hours[OPENING_DAY_KEYS[i - 1]!];
    const current = i < OPENING_DAY_KEYS.length ? hours[OPENING_DAY_KEYS[i]!] : null;
    if (current && sameHours(prev, current)) continue;

    const first = openingDayName(OPENING_DAY_KEYS[start]!, locale);
    const last = openingDayName(OPENING_DAY_KEYS[i - 1]!, locale);
    const days = start === i - 1 ? first : `${first}–${last}`;
    const value = prev.open ? `${prev.from}–${prev.to}` : (CLOSED[locale] ?? CLOSED.en);
    lines.push(`${days}: ${value}`);
    start = i;
  }
  return lines.join("\n");
}

/** Text for the footer / assistant: the weekly schedule when known, else the legacy free text. */
export function openingHoursText(
  settings: { openingHours?: OpeningHours | null; hours?: string | null } | null | undefined,
  locale: Locale
): string {
  if (settings?.openingHours) return formatOpeningHours(settings.openingHours, locale);
  return settings?.hours ?? "";
}

/** Legacy `hours` string kept in sync for older readers. */
export function legacyHoursText(hours: OpeningHours): string {
  return formatOpeningHours(hours, "en");
}
