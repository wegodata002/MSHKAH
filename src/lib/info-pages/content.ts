import type { Locale } from "@/lib/i18n/types";

/**
 * The footer's "More info" pages: FAQ, accessibility statement, terms of use, privacy policy.
 * Kept in `settings/infoPages` (read by everyone, written by staff). Each page has a draft the
 * manager edits and a published copy the site shows; nothing is shown before "Publish".
 *
 * Text format (all pages but the FAQ): a line starting with "## " is a heading, "- " a list item,
 * an empty line starts a new paragraph. The FAQ is a list of question + answer (same format).
 * "[[...]]" marks a place the manager must fill in (e.g. the accessibility coordinator); a page
 * with such a mark cannot be published. Pure — shared by the site, the admin and the tests.
 */
export const INFO_PAGE_IDS = ["faq", "accessibility", "terms", "privacy"] as const;
export type InfoPageId = (typeof INFO_PAGE_IDS)[number];
export const INFO_LANGS = ["he", "ar", "en"] as const satisfies readonly Locale[];

export const INFO_PAGES_DOC = "infoPages";

export type FaqItem = { q: string; a: string };
/** One language of one page: `items` for the FAQ, `body` for the others. */
export type InfoPageText = { body: string; items: FaqItem[] };
export type InfoPageCopy = Record<Locale, InfoPageText>;
export type InfoPageState = {
  draft: InfoPageCopy;
  published: InfoPageCopy | null;
  publishedAt: string | null;
  updatedAt: string | null;
};
export type InfoPages = Record<InfoPageId, InfoPageState>;

export const INFO_PAGE_PATHS: Record<InfoPageId, string> = {
  faq: "/faq",
  accessibility: "/accessibility",
  terms: "/terms",
  privacy: "/privacy",
};

const MAX_BODY = 30_000;
const MAX_ITEMS = 60;
const MAX_Q = 300;
const MAX_A = 3_000;

const str = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").slice(0, max) : "");

export function emptyText(): InfoPageText {
  return { body: "", items: [] };
}

function cleanText(raw: unknown): InfoPageText {
  if (!raw || typeof raw !== "object") return emptyText();
  const r = raw as { body?: unknown; items?: unknown };
  const items = Array.isArray(r.items)
    ? r.items
        .slice(0, MAX_ITEMS)
        .map((item) => ({ q: str((item as FaqItem)?.q, MAX_Q), a: str((item as FaqItem)?.a, MAX_A) }))
    : [];
  return { body: str(r.body, MAX_BODY), items };
}

function cleanCopy(raw: unknown): InfoPageCopy | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return { he: cleanText(r.he), ar: cleanText(r.ar), en: cleanText(r.en) };
}

/** The saved document, cleaned. A page never saved starts from its first draft (`defaults`). */
export function parseInfoPages(raw: unknown, defaults: Record<InfoPageId, InfoPageCopy>): InfoPages {
  const pages = (raw && typeof raw === "object" ? (raw as { pages?: unknown }).pages : null) as Record<string, unknown> | null;
  const out = {} as InfoPages;
  for (const id of INFO_PAGE_IDS) {
    const page = (pages && typeof pages[id] === "object" ? pages[id] : null) as Record<string, unknown> | null;
    const published = cleanCopy(page?.published);
    out[id] = {
      draft: cleanCopy(page?.draft) ?? defaults[id],
      published: published && copyHasContent(id, published) ? published : null,
      publishedAt: typeof page?.publishedAt === "string" ? page.publishedAt : null,
      updatedAt: typeof page?.updatedAt === "string" ? page.updatedAt : null,
    };
  }
  return out;
}

export function textHasContent(id: InfoPageId, text: InfoPageText): boolean {
  return id === "faq" ? text.items.some((item) => item.q.trim() && item.a.trim()) : Boolean(text.body.trim());
}

function copyHasContent(id: InfoPageId, copy: InfoPageCopy): boolean {
  return textHasContent(id, copy.he);
}

/** What the site shows in a language: the published copy; a language left empty shows the Hebrew. */
export function publishedText(id: InfoPageId, page: InfoPageState, locale: Locale): { text: InfoPageText; lang: Locale } | null {
  if (!page.published) return null;
  return textHasContent(id, page.published[locale])
    ? { text: page.published[locale], lang: locale }
    : { text: page.published.he, lang: "he" };
}

const PLACEHOLDER = /\[\[[^\]]*\]\]/g;

/** "[[...]]" places still to fill in, per language. */
export function placeholdersIn(text: InfoPageText): string[] {
  const all = [text.body, ...text.items.flatMap((i) => [i.q, i.a])].join("\n");
  return [...new Set(all.match(PLACEHOLDER) ?? [])];
}

export type PublishCheck = { ok: true; missing: Locale[] } | { ok: false; reason: "EMPTY_HEBREW" | "PLACEHOLDERS"; placeholders?: string[] };

/**
 * Can the draft be published? Hebrew is required; no "[[...]]" left in any language.
 * `missing` lists empty languages (they will show the Hebrew).
 */
export function checkPublish(id: InfoPageId, draft: InfoPageCopy): PublishCheck {
  if (!textHasContent(id, draft.he)) return { ok: false, reason: "EMPTY_HEBREW" };
  const placeholders = INFO_LANGS.flatMap((lang) => placeholdersIn(draft[lang]));
  if (placeholders.length) return { ok: false, reason: "PLACEHOLDERS", placeholders: [...new Set(placeholders)] };
  return { ok: true, missing: INFO_LANGS.filter((lang) => !textHasContent(id, draft[lang])) };
}

/** Removes half-filled FAQ rows and trailing spaces before saving or publishing. */
export function tidyCopy(id: InfoPageId, copy: InfoPageCopy): InfoPageCopy {
  const tidy = (text: InfoPageText): InfoPageText =>
    id === "faq"
      ? { body: "", items: text.items.map((i) => ({ q: i.q.trim(), a: i.a.trim() })).filter((i) => i.q || i.a) }
      : { body: text.body.trim(), items: [] };
  return { he: tidy(copy.he), ar: tidy(copy.ar), en: tidy(copy.en) };
}

export type TextBlock = { kind: "heading"; text: string } | { kind: "paragraph"; text: string } | { kind: "list"; items: string[] };

/** The small text format → blocks to render (no HTML is ever taken from the text). */
export function textBlocks(body: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    if (list.length) blocks.push({ kind: "list", items: list });
    paragraph = [];
    list = [];
  };
  for (const raw of body.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push({ kind: "heading", text: line.slice(3).trim() });
    } else if (/^[-•]\s+/.test(line)) {
      if (paragraph.length) {
        blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
        paragraph = [];
      }
      list.push(line.replace(/^[-•]\s+/, ""));
    } else {
      if (list.length) {
        blocks.push({ kind: "list", items: list });
        list = [];
      }
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
