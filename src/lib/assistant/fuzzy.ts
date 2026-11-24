/** Normalize text for fuzzy matching across he/ar/en */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost
      );
    }
  }
  return dp[m]![n]!;
}

export function fuzzyScore(query: string, target: string): number {
  const q = normalizeText(query);
  const t = normalizeText(target);
  if (!q || !t) return 0;
  if (t.includes(q)) return 1;
  if (q.includes(t)) return 0.85;

  const qTokens = q.split(" ").filter(Boolean);
  let tokenScore = 0;
  for (const token of qTokens) {
    if (token.length < 2) continue;
    if (t.includes(token)) {
      tokenScore += 0.4;
      continue;
    }
    const tTokens = t.split(" ").filter(Boolean);
    for (const tt of tTokens) {
      if (tt.includes(token) || token.includes(tt)) {
        tokenScore += 0.35;
        break;
      }
      const maxLen = Math.max(token.length, tt.length);
      if (maxLen <= 12) {
        const dist = levenshtein(token, tt);
        if (dist <= Math.floor(maxLen * 0.35)) {
          tokenScore += 0.3 * (1 - dist / maxLen);
        }
      }
    }
  }
  if (tokenScore > 0) return Math.min(tokenScore, 0.95);

  const maxLen = Math.max(q.length, t.length);
  if (maxLen <= 20) {
    const dist = levenshtein(q, t);
    if (dist <= Math.floor(maxLen * 0.3)) return 0.5 * (1 - dist / maxLen);
  }
  return 0;
}

export function matchesAny(text: string, keywords: string[]): boolean {
  const norm = normalizeText(text);
  return keywords.some((kw) => {
    const k = normalizeText(kw);
    return norm.includes(k) || fuzzyScore(norm, k) >= 0.5;
  });
}

/**
 * Words that carry no meaning for a product search ("what", "do you have", "is there"…). A sentence
 * like "מה מזג האוויר מחר?" must not match a product just because one small word appears somewhere.
 */
const FILLER_WORDS = new Set(
  [
    // he
    "מה", "יש", "אין", "לכם", "לך", "לי", "את", "של", "עם", "על", "אני", "אתם", "אתה", "את", "רוצה", "רוצים",
    "בבקשה", "אפשר", "איזה", "איזו", "כמה", "האם", "מתי", "איפה", "למה", "זה", "הזה", "זאת", "גם", "או", "כן",
    "לא", "שלום", "היי", "תודה", "משהו", "עוד", "כל", "היום", "מחר", "עכשיו", "פה", "כאן", "שם",
    // ar
    "ما", "ماذا", "هل", "عندكم", "لديكم", "عندك", "في", "من", "على", "الى", "إلى", "أريد", "اريد", "بدي", "ممكن",
    "كم", "متى", "اين", "أين", "وين", "شو", "ايش", "هذا", "هذه", "او", "أو", "لا", "نعم", "مرحبا", "شكرا", "اليوم",
    "بكرة", "غدا", "الآن", "هنا", "كيف", "حال",
    // en
    "what", "whats", "is", "are", "the", "a", "an", "do", "does", "you", "have", "has", "i", "want", "can", "please",
    "how", "much", "many", "when", "where", "it", "of", "for", "with", "any", "some", "me", "my", "your", "there",
    "hi", "hello", "thanks", "thank", "today", "tomorrow", "now", "here", "s", "to", "and", "or", "in", "on",
  ].map((w) => normalizeText(w))
);

/** Words of a query that mean something (3+ letters, not filler). */
export function meaningfulWords(query: string): string[] {
  return normalizeText(query)
    .split(" ")
    .filter((w) => w.length >= 3 && !FILLER_WORDS.has(w));
}

/** The word without a one-letter Hebrew prefix (ה/ו/ב/ל/ש/מ/כ) or the Arabic "ال" / "وال". */
function stems(word: string): string[] {
  const out = [word];
  if (word.length >= 4 && "הובלשמכ".includes(word[0]!)) out.push(word.slice(1));
  if (word.startsWith("وال") && word.length >= 5) out.push(word.slice(3));
  else if (word.startsWith("ال") && word.length >= 4) out.push(word.slice(2));
  return out;
}

/** One query word matches a word of the target: the start of the word, or a small typo. */
function wordMatches(queryWord: string, targetWords: string[]): boolean {
  for (const q of stems(queryWord)) {
    for (const tw of targetWords) {
      for (const t of stems(tw)) {
        if (t.startsWith(q) || (q.startsWith(t) && t.length >= 3)) return true;
        const maxLen = Math.max(q.length, t.length);
        if (q.length >= 4 && maxLen <= 12 && levenshtein(q, t) <= Math.floor(maxLen * 0.25)) return true;
      }
    }
  }
  return false;
}

/**
 * Whether a search query is really about this product / category: the whole query appears in it, or
 * at least half of the query's meaningful words match its words (at least one). Filters out
 * sentences that only share a small word or a piece of a word with a product.
 */
export function isRelevantMatch(query: string, target: string): boolean {
  const q = normalizeText(query);
  const t = normalizeText(target);
  if (!q || !t) return false;
  if (q.length >= 2 && t.split(" ").some((w) => w === q || w.startsWith(q))) return true;
  if (q.includes(" ") && t.includes(q)) return true;
  const words = meaningfulWords(query);
  if (words.length === 0) return false;
  const targetWords = t.split(" ").filter(Boolean);
  const matched = words.filter((w) => wordMatches(w, targetWords)).length;
  return matched >= 1 && matched * 2 >= words.length;
}
