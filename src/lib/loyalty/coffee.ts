/**
 * Digital coffee card (pure; safe in the browser too).
 *
 * Staff add cups at the counter (never the customer). Every 5 cups earn a free cup; redeeming it
 * takes 5 cups off, so extra cups carry over (4 + 3 = 7 → free cup → 2 left).
 */

export const COFFEE_CUPS_FOR_GIFT = 5;
/** Most cups added in one go. */
export const COFFEE_MAX_ADD = 5;
/** Adding cups to the same member again within this time asks the staff member first. */
export const COFFEE_RECENT_SECONDS = 60;
/** "Undo last action" stays available this long. */
export const COFFEE_UNDO_MINUTES = 10;

export type CoffeeLedgerKind = "cups" | "gift" | "coupon";

export interface CoffeeLedgerEntry {
  /** = the request id sent by the staff screen (a retried request is not applied twice). */
  id: string;
  memberId: string;
  kind: CoffeeLedgerKind;
  /** Change in cups: +n for added cups, −5 for a free cup, 0 for the 10% code. */
  cups: number;
  cupsAfter: number;
  /** The code marked used at the counter (kind "coupon"). */
  couponCode?: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  createdAt: string;
  undoneAt?: string;
  undoneBy?: string;
}

export function normalizeCups(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Cups shown on the card (0–5) and whether a free cup is waiting. */
export function coffeeCardView(cups: unknown): { filled: number; giftReady: boolean; toGift: number } {
  const total = normalizeCups(cups);
  const giftReady = total >= COFFEE_CUPS_FOR_GIFT;
  const filled = giftReady ? COFFEE_CUPS_FOR_GIFT : total;
  return { filled, giftReady, toGift: giftReady ? 0 : COFFEE_CUPS_FOR_GIFT - total };
}

/** "d***@gmail.com": enough for the staff member to confirm the person, not the full address. */
export function maskEmail(email: unknown): string {
  if (typeof email !== "string" || !email.includes("@")) return "";
  const [local, domain] = email.split("@");
  return `${(local ?? "").slice(0, 1)}***@${domain ?? ""}`;
}

/**
 * Who may undo an entry: whoever did it, or an Admin / Manager; only within 10 minutes, and only
 * the member's latest action that was not undone yet.
 */
export function canUndoCoffeeEntry(
  entry: Pick<CoffeeLedgerEntry, "actorUid" | "createdAt" | "undoneAt">,
  viewer: { uid: string; role: string },
  now: Date,
  isLatest: boolean
): boolean {
  if (!isLatest || entry.undoneAt) return false;
  const age = now.getTime() - Date.parse(entry.createdAt);
  if (!Number.isFinite(age) || age > COFFEE_UNDO_MINUTES * 60_000) return false;
  return entry.actorUid === viewer.uid || viewer.role === "Admin" || viewer.role === "Manager";
}

/** What the staff scan screen shows for one member. */
export interface ScanSummary {
  member: { id: string; name: string; memberNumber: string; maskedEmail: string; status: string };
  coffee: { enabled: boolean; cups: number; filled: number; giftReady: boolean; toGift: number };
  /** Codes the member can use now (e.g. the 10% welcome code), for "used at the counter". */
  coupons: Array<{ code: string; percent: number; expiresAt: string; firstPurchaseOnly: boolean }>;
  history: Array<CoffeeLedgerEntry & { canUndo: boolean }>;
}
