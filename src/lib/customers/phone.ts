/**
 * Israeli phone numbers at checkout: 9 digits (landline, e.g. 04-1234567) or 10 digits (mobile,
 * 05X-XXXXXXX), starting with 0. "+972 50…", "972-50…" and "00972 50…" become "050…". Spaces,
 * hyphens, dots and brackets are ignored; anything else (letters, too few or too many digits) is
 * refused. Pure — the browser and the server use the same rule.
 */
export function normalizeIsraeliPhone(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  if (/[^\d\s\-.()+]/.test(raw)) return null;
  if (raw.includes("+") && !/^\+\s*972/.test(raw)) return null; // "+" only as the start of +972
  let digits = raw.replace(/\D/g, "");
  // Country code: drop it and put back the leading 0 ("+972 50…" → "050…", "+972 050…" → "050…").
  const international = digits.startsWith("00972") ? 5 : digits.startsWith("972") ? 3 : 0;
  if (international) {
    digits = digits.slice(international);
    if (!digits.startsWith("0")) digits = `0${digits}`;
  }
  return /^0\d{8,9}$/.test(digits) ? digits : null;
}
