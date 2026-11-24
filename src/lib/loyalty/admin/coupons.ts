import type { Firestore, Transaction } from "firebase-admin/firestore";
import { randomInt } from "node:crypto";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { LoyaltyLedgerEntry, LoyaltyMember } from "@/lib/loyalty/types";
import {
  CouponUnavailableError,
  WELCOME_COUPON_DAYS,
  WELCOME_COUPON_PERCENT,
  addDaysIso,
  couponState,
  couponView,
  holdIsReleased,
  isPersonalCouponCode,
  personalCodeFromIndexes,
  restoredExpiry,
  type HoldingOrder,
  type LoyaltyCoupon,
  type LoyaltyCouponView,
} from "@/lib/loyalty/coupons";
import { loyaltyLog } from "@/lib/loyalty/admin/log";

/**
 * Server side of personal club coupons. Every query uses a single equality filter, so none of
 * them needs a composite Firestore index.
 */

const coupons = (db: Firestore) => db.collection(COLLECTIONS.loyaltyCoupons);

export function generatePersonalCode(): string {
  return personalCodeFromIndexes(Array.from({ length: 8 }, () => randomInt(0, 1_000_000)));
}

export function normalizePersonalCode(code: unknown): string {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

/**
 * The member's completed purchases since joining: paid orders that are not cancelled, linked by
 * member id, plus orders that earned points (ledger) and were not refunded (older orders linked by
 * email only).
 */
export async function memberCompletedOrderIds(db: Firestore, memberId: string): Promise<Set<string>> {
  const [orders, ledger] = await Promise.all([
    db.collection(COLLECTIONS.orders).where("loyalty.memberId", "==", memberId).get(),
    db.collection(COLLECTIONS.loyaltyPointsLedger).where("memberId", "==", memberId).get(),
  ]);
  const completed = new Set<string>();
  for (const doc of orders.docs) {
    const order = doc.data() as { status?: string; paymentStatus?: string };
    if (order.paymentStatus === "paid" && order.status !== "cancelled") completed.add(doc.id);
  }
  const entries = ledger.docs.map((d) => d.data() as LoyaltyLedgerEntry);
  const refunded = new Set(entries.filter((e) => e.kind === "refund" && e.orderId).map((e) => e.orderId!));
  for (const entry of entries) {
    if (entry.kind === "earn" && entry.orderId && !refunded.has(entry.orderId)) completed.add(entry.orderId);
  }
  // Orders cancelled since (their points may not have been reversed yet) never count.
  for (const doc of orders.docs) {
    if ((doc.data() as { status?: string }).status === "cancelled") completed.delete(doc.id);
  }
  return completed;
}

async function readHoldingOrder(db: Firestore, orderId: string | null | undefined): Promise<HoldingOrder> {
  if (!orderId) return null;
  const snap = await db.collection(COLLECTIONS.orders).doc(orderId).get();
  return snap.exists ? (snap.data() as HoldingOrder) : null;
}

/**
 * Give a member their welcome code once (one per member = one per email).
 * `requireNoPurchase`: members who joined before codes existed get one only while they still have
 * no completed order; otherwise they are marked so the check is not repeated.
 * Returns the member's welcome coupon, or null.
 */
export async function ensureWelcomeCoupon(
  db: Firestore,
  memberId: string,
  input: { now: Date; requireNoPurchase: boolean }
): Promise<LoyaltyCoupon | null> {
  const memberRef = db.collection(COLLECTIONS.loyaltyMembers).doc(memberId);
  const hasPurchase = input.requireNoPurchase
    ? (await memberCompletedOrderIds(db, memberId)).size > 0
    : false;
  const nowIso = input.now.toISOString();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(memberRef);
    if (!snap.exists) return null;
    const member = snap.data() as LoyaltyMember;
    if (member.welcomeCouponCode) {
      const existing = await tx.get(coupons(db).doc(member.welcomeCouponCode));
      return existing.exists ? (existing.data() as LoyaltyCoupon) : null;
    }
    if (member.welcomeCouponSkippedAt || member.status !== "active") return null;
    if (hasPurchase) {
      tx.set(memberRef, { welcomeCouponSkippedAt: nowIso, updatedAt: nowIso }, { merge: true });
      return null;
    }
    // Codes are random; on the rare clash, draw again.
    let code = generatePersonalCode();
    for (let i = 0; i < 5 && (await tx.get(coupons(db).doc(code))).exists; i++) code = generatePersonalCode();
    const coupon: LoyaltyCoupon = {
      id: code,
      code,
      memberId,
      kind: "welcome",
      percent: WELCOME_COUPON_PERCENT,
      status: "active",
      firstPurchaseOnly: true,
      expiresAt: addDaysIso(input.now, WELCOME_COUPON_DAYS),
      createdAt: nowIso,
      createdBy: "system",
    };
    tx.set(coupons(db).doc(code), coupon);
    tx.set(memberRef, { welcomeCouponCode: code, updatedAt: nowIso }, { merge: true });
    loyaltyLog("coupon.welcome.issued", { memberId });
    return coupon;
  });
}

export async function readCoupon(db: Firestore, code: string): Promise<LoyaltyCoupon | null> {
  const normalized = normalizePersonalCode(code);
  if (!isPersonalCouponCode(normalized)) return null;
  const snap = await coupons(db).doc(normalized).get();
  return snap.exists ? (snap.data() as LoyaltyCoupon) : null;
}

/** All of a member's coupons, as the member sees them (newest first). */
export async function memberCouponViews(db: Firestore, memberId: string, now: Date): Promise<LoyaltyCouponView[]> {
  const snap = await coupons(db).where("memberId", "==", memberId).get();
  if (snap.empty) return [];
  const completed = await memberCompletedOrderIds(db, memberId);
  const list = snap.docs.map((d) => d.data() as LoyaltyCoupon).filter((c) => c.status !== "void");
  const views = await Promise.all(
    list.map(async (coupon) => {
      const holdReleased =
        coupon.status === "redeemed" ? holdIsReleased(await readHoldingOrder(db, coupon.orderId), now) : false;
      return couponView(coupon, couponState(coupon, { now, completedOrderIds: completed, holdReleased }));
    })
  );
  return views.sort((a, b) => b.expiresAt.localeCompare(a.expiresAt));
}

export type CouponCheckResult =
  | { ok: true; coupon: LoyaltyCoupon; percent: number; heldBy: string | null }
  | { ok: false; reason: "invalid" | "used" | "expired" };

/**
 * Can this member use this code on a new order now? Codes of other members are "invalid"
 * (never revealed). `heldBy`: an older order the code can be taken back from.
 */
export async function checkCouponForMember(
  db: Firestore,
  input: { code: string; member: Pick<LoyaltyMember, "id" | "status">; now: Date }
): Promise<CouponCheckResult> {
  const coupon = await readCoupon(db, input.code);
  if (!coupon || coupon.memberId !== input.member.id || coupon.status === "void") return { ok: false, reason: "invalid" };
  if (input.member.status !== "active") return { ok: false, reason: "invalid" };
  let heldBy: string | null = null;
  if (coupon.status === "redeemed") {
    if (!holdIsReleased(await readHoldingOrder(db, coupon.orderId), input.now)) return { ok: false, reason: "used" };
    heldBy = coupon.orderId ?? null;
  }
  const completed = coupon.firstPurchaseOnly ? await memberCompletedOrderIds(db, input.member.id) : new Set<string>();
  if (heldBy) completed.delete(heldBy);
  const state = couponState({ ...coupon, status: "active", orderId: null }, { now: input.now, completedOrderIds: completed });
  if (state !== "active") return { ok: false, reason: "expired" };
  return { ok: true, coupon, percent: coupon.percent, heldBy };
}

/**
 * Inside the order transaction: mark the code used by `orderId`. Throws CouponUnavailableError
 * when another order took it since the check (so the code never serves two orders).
 */
export async function redeemCouponInTx(
  db: Firestore,
  tx: Transaction,
  input: { code: string; memberId: string; orderId: string; heldBy: string | null; now: Date; channel: "web" | "pos" }
): Promise<void> {
  const ref = coupons(db).doc(normalizePersonalCode(input.code));
  const snap = await tx.get(ref);
  if (!snap.exists) throw new CouponUnavailableError("invalid");
  const coupon = snap.data() as LoyaltyCoupon;
  if (coupon.memberId !== input.memberId || coupon.status === "void") throw new CouponUnavailableError("invalid");
  const free = coupon.status === "active" || (coupon.status === "redeemed" && !!input.heldBy && coupon.orderId === input.heldBy);
  if (!free) throw new CouponUnavailableError("used");
  if (Date.parse(coupon.expiresAt) <= input.now.getTime()) throw new CouponUnavailableError("expired");
  const nowIso = input.now.toISOString();
  tx.set(
    ref,
    { status: "redeemed", orderId: input.orderId, redeemedAt: nowIso, channel: input.channel, updatedAt: nowIso },
    { merge: true }
  );
}

/** Saves a new order and marks its personal code used, in one transaction. Returns the order id. */
export async function saveOrderWithCoupon(
  db: Firestore,
  input: {
    order: Record<string, unknown>;
    coupon: { code: string; memberId: string; heldBy: string | null };
    now: Date;
  }
): Promise<string> {
  const orderRef = db.collection(COLLECTIONS.orders).doc();
  await db.runTransaction(async (tx) => {
    await redeemCouponInTx(db, tx, { ...input.coupon, orderId: orderRef.id, now: input.now, channel: "web" });
    tx.set(orderRef, input.order);
  });
  loyaltyLog("coupon.redeemed", { memberId: input.coupon.memberId, orderId: orderRef.id });
  return orderRef.id;
}

/**
 * A manager cancelled the order: its code goes back to the member, valid at least 3 more days.
 * Idempotent: only a code still marked used by this very order is given back.
 */
export async function restoreCouponForCancelledOrder(
  db: Firestore,
  input: { orderId: string; code: unknown; now: Date }
): Promise<boolean> {
  const code = normalizePersonalCode(input.code);
  if (!isPersonalCouponCode(code)) return false;
  const ref = coupons(db).doc(code);
  const restored = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const coupon = snap.data() as LoyaltyCoupon;
    if (coupon.status !== "redeemed" || coupon.orderId !== input.orderId) return false;
    const nowIso = input.now.toISOString();
    tx.set(
      ref,
      {
        status: "active",
        orderId: null,
        redeemedAt: null,
        channel: null,
        expiresAt: restoredExpiry(coupon.expiresAt, input.now),
        restoredAt: nowIso,
        updatedAt: nowIso,
      },
      { merge: true }
    );
    return true;
  });
  if (restored) loyaltyLog("coupon.restored", { orderId: input.orderId });
  return restored;
}

/**
 * Discount rate for the card charge: the personal code counts only if it is recorded as used by
 * this very order (the browser could still write an order with any code until the rules are locked).
 */
export async function personalCouponRateForOrder(db: Firestore, orderId: string, code: unknown): Promise<number> {
  const coupon = await readCoupon(db, String(code ?? ""));
  if (!coupon || coupon.status !== "redeemed" || coupon.orderId !== orderId) return 0;
  const percent = Number(coupon.percent);
  return Number.isFinite(percent) && percent > 0 && percent < 100 ? percent / 100 : 0;
}
