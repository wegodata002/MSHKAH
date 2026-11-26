import { meaningfulWords, normalizeText } from "@/lib/assistant/fuzzy";

/**
 * Search that forgives a small typo ("לאטע" → "לאטה", "קרואסן" → "קרואסון", "latey" → "latte"),
 * shared by the menu search and the assistant. Used only when the exact search finds nothing, so it
 * never adds unrelated results next to real ones.
 *
 * Each word is first evened out (spelling that sounds the same), then one small difference is
 * allowed: 1 letter in a 4–7 letter word, 2 in 8+; a word of 3 letters or less must be equal once
 * evened out. Every word of the search must match (the assistant: at least half of its words).
 */

const HEBREW_FINALS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };

/** Spelling that sounds the same, made equal: Hebrew ק/כ ת/ט ע/א ה/א and final letters; Arabic ة/ه أ/إ/آ/ا ى/ي; English doubled letters. */
export function foldWord(word: string): string {
  let w = normalizeText(word).replace(/\s+/g, "");
  w = w.replace(/[ךםןףץ]/g, (c) => HEBREW_FINALS[c] ?? c).replace(/ק/g, "כ").replace(/ת/g, "ט").replace(/ע/g, "א").replace(/ה/g, "א");
  w = w.replace(/ة/g, "ه").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
  w = w.replace(/([a-z])\1+/g, "$1");
  return w;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Letters a word of this length may differ by. */
export function allowedTypos(length: number): number {
  if (length <= 3) return 0;
  if (length <= 7) return 1;
  return 2;
}

/** The Hebrew one-letter prefix (ה/ו/ב/ל/ש/מ/כ) or Arabic "ال" may be there or not. */
function withoutPrefix(word: string): string[] {
  const out = [word];
  if (word.length >= 4 && "הובלשמכ".includes(word[0]!)) out.push(word.slice(1));
  if (word.startsWith("وال") && word.length >= 5) out.push(word.slice(3));
  else if (word.startsWith("ال") && word.length >= 4) out.push(word.slice(2));
  return out;
}

/** One searched word against one word of the product: same start, or a small typo (after evening out). */
export function typoWordMatch(queryWord: string, targetWord: string): boolean {
  for (const qRaw of withoutPrefix(normalizeText(queryWord))) {
    const q = foldWord(qRaw);
    if (q.length < 2) continue;
    for (const tRaw of withoutPrefix(normalizeText(targetWord))) {
      const t = foldWord(tRaw);
      if (!t) continue;
      if (t.startsWith(q)) return true;
      const allowed = allowedTypos(Math.max(q.length, t.length) <= 3 ? 3 : q.length);
      if (allowed > 0 && Math.abs(q.length - t.length) <= allowed && levenshtein(q, t) <= allowed) return true;
      // A typo in the start of a longer word ("קרוסו" → "קרואסון"): only for 5+ letters.
      if (q.length >= 5 && t.length > q.length && levenshtein(q, t.slice(0, q.length)) <= 1) return true;
    }
  }
  return false;
}

/** The words of a search (2+ letters; for sentences the meaningful ones). */
function queryWords(query: string): string[] {
  const meaningful = meaningfulWords(query);
  if (meaningful.length) return meaningful;
  return normalizeText(query).split(" ").filter((w) => w.length >= 2);
}

/** Every word of the search (or, for the assistant, at least half) matches a word of the text. */
export function typoTextMatch(query: string, text: string, mode: "all" | "half" = "all"): boolean {
  const words = queryWords(query);
  if (words.length === 0) return false;
  const targetWords = normalizeText(text).split(" ").filter(Boolean);
  if (targetWords.length === 0) return false;
  const matched = words.filter((w) => targetWords.some((t) => typoWordMatch(w, t))).length;
  return mode === "all" ? matched === words.length : matched >= 1 && matched * 2 >= words.length;
}
