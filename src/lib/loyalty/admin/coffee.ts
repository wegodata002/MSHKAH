import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { LoyaltyMember } from "@/lib/loyalty/types";
import {
  COFFEE_CUPS_FOR_GIFT,
  COFFEE_MAX_ADD,
  COFFEE_RECENT_SECONDS,
  canUndoCoffeeEntry,
  coffeeCardView,
  maskEmail,
  normalizeCups,
  type CoffeeLedgerEntry,
  type ScanSummary,
} from "@/lib/loyalty/coffee";
import type { LoyaltyCoupon } from "@/lib/loyalty/coupons";
import { readMemberCard } from "@/lib/loyalty/card-link";
import { checkCouponForMember, memberCouponViews, normalizePersonalCode } from "@/lib/loyalty/admin/coupons";
import { readLoyaltySettings } from "@/lib/loyalty/admin/members";

/**
 * Counter actions on a member card (staff only; the routes check Admin / Manager / Employee).
 * Every action is one transaction and one ledger entry keyed by the screen's request id, so a
 * retried request is never applied twice. All queries use one equality filter (no index needed).
 */

export type StaffActor = { uid: string; name: string; role: string };

export type CoffeeActionResult =
  | { ok: true; duplicate?: boolean }
  | {
      ok: false;
      reason:
        | "not_found"
        | "inactive"
        | "disabled"
        | "recent"
        | "not_enough"
        | "invalid"
        | "used"
        | "expired"
        | "cannot_undo"
        | "bad_request";
      secondsAgo?: number;
    };

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const ledger = (db: Firestore) => db.collection(COLLECTIONS.loyaltyCoffeeLedger);
const members = (db: Firestore) => db.collection(COLLECTIONS.loyaltyMembers);

/** Member from the scanned QR (signed /club/card link) or a typed member number. */
export async function findMemberForScan(
  db: Firestore,
  input: { qr?: string; memberNumber?: string }
): Promise<LoyaltyMember | null> {
  const fromCard = input.qr ? readMemberCard(input.qr) : null;
  if (fromCard) {
    const snap = await members(db).doc(fromCard).get();
    return snap.exists ? ({ id: snap.id, ...(snap.data() as Omit<LoyaltyMember, "id">) } as LoyaltyMember) : null;
  }
  const number = (input.memberNumber ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (!/^M-[A-Z0-9-]{2,20}$/.test(number)) return null;
  const snap = await members(db).where("memberNumber", "==", number).limit(1).get();
  const doc = snap.docs[0];
  return doc ? ({ id: doc.id, ...(doc.data() as Omit<LoyaltyMember, "id">) } as LoyaltyMember) : null;
}

async function memberLedger(db: Firestore, memberId: string): Promise<CoffeeLedgerEntry[]> {
  const snap = await ledger(db).where("memberId", "==", memberId).get();
  return snap.docs
    .map((d) => d.data() as CoffeeLedgerEntry)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** The member's latest action that was not undone (the only one "undo" applies to). */
function latestOpen(entries: CoffeeLedgerEntry[]): CoffeeLedgerEntry | undefined {
  return entries.find((e) => !e.undoneAt);
}

export async function scanSummary(
  db: Firestore,
  memberId: string,
  viewer: { uid: string; role: string },
  now: Date
): Promise<ScanSummary | null> {
  const snap = await members(db).doc(memberId).get();
  if (!snap.exists) return null;
  const member = { id: snap.id, ...(snap.data() as Omit<LoyaltyMember, "id">) } as LoyaltyMember;
  const [settings, entries, coupons] = await Promise.all([
    readLoyaltySettings(db),
    memberLedger(db, memberId),
    memberCouponViews(db, memberId, now).catch(() => []),
  ]);
  const latest = latestOpen(entries);
  const cups = normalizeCups(member.coffeeCups);
  return {
    member: {
      id: member.id,
      name: member.displayName?.trim() || "",
      memberNumber: member.memberNumber,
      maskedEmail: maskEmail(member.email),
      status: member.status,
    },
    coffee: { enabled: settings.coffeeCardEnabled, cups, ...coffeeCardView(cups) },
    coupons: coupons
      .filter((c) => c.state === "active")
      .map((c) => ({ code: c.code, percent: c.percent, expiresAt: c.expiresAt, firstPurchaseOnly: c.firstPurchaseOnly })),
    history: entries.slice(0, 20).map((e) => ({ ...e, canUndo: canUndoCoffeeEntry(e, viewer, now, e === latest) })),
  };
}

function entryBase(input: { requestId: string; memberId: string; actor: StaffActor; now: Date }) {
  return {
    id: input.requestId,
    memberId: input.memberId,
    actorUid: input.actor.uid,
    actorName: input.actor.name,
    actorRole: input.actor.role,
    createdAt: input.now.toISOString(),
  };
}

/** "+ cup": 1–5 cups at once. Within 60 s of the last add for this member, asks first (confirm). */
export async function addCoffeeCups(
  db: Firestore,
  input: { memberId: string; count: number; requestId: string; confirm?: boolean; actor: StaffActor; now: Date }
): Promise<CoffeeActionResult> {
  const count = Math.floor(Number(input.count));
  if (!REQUEST_ID.test(input.requestId) || !(count >= 1 && count <= COFFEE_MAX_ADD)) return { ok: false, reason: "bad_request" };
  const settings = await readLoyaltySettings(db);
  if (!settings.coffeeCardEnabled) return { ok: false, reason: "disabled" };
  const entryRef = ledger(db).doc(input.requestId);
  const memberRef = members(db).doc(input.memberId);
  return db.runTransaction(async (tx): Promise<CoffeeActionResult> => {
    if ((await tx.get(entryRef)).exists) return { ok: true, duplicate: true };
    const snap = await tx.get(memberRef);
    if (!snap.exists) return { ok: false, reason: "not_found" };
    const member = snap.data() as LoyaltyMember;
    if (member.status !== "active") return { ok: false, reason: "inactive" };
    const last = member.coffeeLastAddAt ? Date.parse(member.coffeeLastAddAt) : NaN;
    const secondsAgo = Number.isFinite(last) ? Math.floor((input.now.getTime() - last) / 1000) : Infinity;
    if (secondsAgo < COFFEE_RECENT_SECONDS && !input.confirm) return { ok: false, reason: "recent", secondsAgo };
    const cupsAfter = normalizeCups(member.coffeeCups) + count;
    const nowIso = input.now.toISOString();
    const entry: CoffeeLedgerEntry = { ...entryBase(input), kind: "cups", cups: count, cupsAfter };
    tx.set(entryRef, entry);
    tx.set(memberRef, { coffeeCups: cupsAfter, coffeeLastAddAt: nowIso, updatedAt: nowIso }, { merge: true });
    return { ok: true };
  });
}

/** "Free cup — redeem": takes 5 cups off (extra cups carry over). */
export async function redeemCoffeeGift(
  db: Firestore,
  input: { memberId: string; requestId: string; actor: StaffActor; now: Date }
): Promise<CoffeeActionResult> {
  if (!REQUEST_ID.test(input.requestId)) return { ok: false, reason: "bad_request" };
  const settings = await readLoyaltySettings(db);
  if (!settings.coffeeCardEnabled) return { ok: false, reason: "disabled" };
  const entryRef = ledger(db).doc(input.requestId);
  const memberRef = members(db).doc(input.memberId);
  return db.runTransaction(async (tx): Promise<CoffeeActionResult> => {
    if ((await tx.get(entryRef)).exists) return { ok: true, duplicate: true };
    const snap = await tx.get(memberRef);
    if (!snap.exists) return { ok: false, reason: "not_found" };
    const member = snap.data() as LoyaltyMember;
    if (member.status !== "active") return { ok: false, reason: "inactive" };
    const cups = normalizeCups(member.coffeeCups);
    if (cups < COFFEE_CUPS_FOR_GIFT) return { ok: false, reason: "not_enough" };
    const cupsAfter = cups - COFFEE_CUPS_FOR_GIFT;
    const nowIso = input.now.toISOString();
    tx.set(entryRef, { ...entryBase(input), kind: "gift", cups: -COFFEE_CUPS_FOR_GIFT, cupsAfter } satisfies CoffeeLedgerEntry);
    tx.set(
      memberRef,
      { coffeeCups: cupsAfter, coffeeRewardsRedeemed: normalizeCups(member.coffeeRewardsRedeemed) + 1, updatedAt: nowIso },
      { merge: true }
    );
    return { ok: true };
  });
}

/** The 10% code used at the counter (no site order): marked used, by whom and when. */
export async function redeemCouponAtCounter(
  db: Firestore,
  input: { memberId: string; code: string; requestId: string; actor: StaffActor; now: Date }
): Promise<CoffeeActionResult> {
  if (!REQUEST_ID.test(input.requestId)) return { ok: false, reason: "bad_request" };
  const memberSnap = await members(db).doc(input.memberId).get();
  if (!memberSnap.exists) return { ok: false, reason: "not_found" };
  const member = memberSnap.data() as LoyaltyMember;
  const entryRef = ledger(db).doc(input.requestId);
  if ((await entryRef.get()).exists) return { ok: true, duplicate: true };
  // Same rules as on the site: owner, not used, not expired, still the first purchase.
  const check = await checkCouponForMember(db, {
    code: input.code,
    member: { id: input.memberId, status: member.status },
    now: input.now,
  });
  if (!check.ok) return { ok: false, reason: check.reason };
  if (check.heldBy) return { ok: false, reason: "used" };
  const couponRef = db.collection(COLLECTIONS.loyaltyCoupons).doc(normalizePersonalCode(input.code));
  return db.runTransaction(async (tx): Promise<CoffeeActionResult> => {
    if ((await tx.get(entryRef)).exists) return { ok: true, duplicate: true };
    const couponSnap = await tx.get(couponRef);
    const memberNow = await tx.get(members(db).doc(input.memberId));
    if (!couponSnap.exists) return { ok: false, reason: "invalid" };
    const coupon = couponSnap.data() as LoyaltyCoupon;
    if (coupon.memberId !== input.memberId) return { ok: false, reason: "invalid" };
    if (coupon.status !== "active") return { ok: false, reason: "used" };
    if (Date.parse(coupon.expiresAt) <= input.now.getTime()) return { ok: false, reason: "expired" };
    const nowIso = input.now.toISOString();
    tx.set(
      couponRef,
      { status: "redeemed", orderId: null, channel: "pos", redeemedAt: nowIso, redeemedBy: input.actor.uid, updatedAt: nowIso },
      { merge: true }
    );
    const cupsAfter = normalizeCups((memberNow.data() as LoyaltyMember | undefined)?.coffeeCups);
    tx.set(entryRef, { ...entryBase(input), kind: "coupon", cups: 0, cupsAfter, couponCode: coupon.code } satisfies CoffeeLedgerEntry);
    return { ok: true };
  });
}

/** "Undo last action": only the latest one, within 10 minutes, by whoever did it or Admin / Manager. */
export async function undoCoffeeEntry(
  db: Firestore,
  input: { memberId: string; entryId: string; actor: StaffActor; now: Date }
): Promise<CoffeeActionResult> {
  const entries = await memberLedger(db, input.memberId);
  const latest = latestOpen(entries);
  if (!latest || latest.id !== input.entryId || !canUndoCoffeeEntry(latest, input.actor, input.now, true)) {
    return { ok: false, reason: "cannot_undo" };
  }
  const entryRef = ledger(db).doc(input.entryId);
  const memberRef = members(db).doc(input.memberId);
  const couponRef = latest.couponCode ? db.collection(COLLECTIONS.loyaltyCoupons).doc(latest.couponCode) : null;
  return db.runTransaction(async (tx): Promise<CoffeeActionResult> => {
    const entrySnap = await tx.get(entryRef);
    const memberSnap = await tx.get(memberRef);
    const couponSnap = couponRef ? await tx.get(couponRef) : null;
    if (!entrySnap.exists || !memberSnap.exists) return { ok: false, reason: "cannot_undo" };
    const entry = entrySnap.data() as CoffeeLedgerEntry;
    if (entry.undoneAt || entry.memberId !== input.memberId) return { ok: false, reason: "cannot_undo" };
    const member = memberSnap.data() as LoyaltyMember;
    const nowIso = input.now.toISOString();
    const cups = normalizeCups(member.coffeeCups);
    if (entry.kind === "cups") {
      tx.set(memberRef, { coffeeCups: Math.max(0, cups - entry.cups), updatedAt: nowIso }, { merge: true });
    } else if (entry.kind === "gift") {
      tx.set(
        memberRef,
        {
          coffeeCups: cups + COFFEE_CUPS_FOR_GIFT,
          coffeeRewardsRedeemed: Math.max(0, normalizeCups(member.coffeeRewardsRedeemed) - 1),
          updatedAt: nowIso,
        },
        { merge: true }
      );
    } else if (entry.kind === "coupon" && couponRef && couponSnap?.exists) {
      const coupon = couponSnap.data() as LoyaltyCoupon;
      if (coupon.status === "redeemed" && coupon.channel === "pos") {
        tx.set(couponRef, { status: "active", channel: null, redeemedAt: null, redeemedBy: null, updatedAt: nowIso }, { merge: true });
      }
    }
    tx.set(entryRef, { undoneAt: nowIso, undoneBy: input.actor.uid }, { merge: true });
    return { ok: true };
  });
}
