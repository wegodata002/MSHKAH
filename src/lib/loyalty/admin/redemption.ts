import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { redeemCouponInTx } from "@/lib/loyalty/admin/coupons";
import { loyaltyLog } from "@/lib/loyalty/admin/log";
import type { OrderCouponRecord } from "@/lib/coupons/admin/store";
import type { LoyaltyLedgerEntry, LoyaltyMember } from "@/lib/loyalty/types";
import { PointsUnavailableError } from "@/lib/loyalty/redemption";

/**
 * Paying with club points (server only). The points are taken off the member's balance in the SAME
 * transaction that saves the order (with its coupon, if any), so they can never be spent twice, even
 * by two orders at the same moment. The ledger entry `redeem:<orderId>` (server only) is what the card
 * charge reads; `unredeem:<orderId>` gives them back once (cancelled order, failed card payment).
 * A card order that is never paid keeps them held until a manager cancels it.
 */

export type PointsRedemption = { memberId: string; points: number; discount: number; pointValueMinor: number };

const ledger = (db: Firestore) => db.collection(COLLECTIONS.loyaltyPointsLedger);

/** Save the order, its coupon (personal code or store record) and the points, in one transaction. */
export async function saveOrderWithPoints(
  db: Firestore,
  input: {
    order: Record<string, unknown>;
    points: PointsRedemption;
    personalCoupon?: { code: string; memberId: string; heldBy: string | null };
    storeCouponRecord?: Omit<OrderCouponRecord, "createdAt">;
    now: Date;
  }
): Promise<string> {
  const orderRef = db.collection(COLLECTIONS.orders).doc();
  const memberRef = db.collection(COLLECTIONS.loyaltyMembers).doc(input.points.memberId);
  const nowIso = input.now.toISOString();
  await db.runTransaction(async (tx) => {
    // Reads first: the member, then the personal code (its helper reads, then writes).
    const memberSnap = await tx.get(memberRef);
    const member = memberSnap.exists ? (memberSnap.data() as LoyaltyMember) : null;
    if (!member || member.status !== "active") throw new PointsUnavailableError("not_member");
    const balance = Math.max(0, Math.floor(Number(member.balancePoints) || 0));
    if (balance < input.points.points) throw new PointsUnavailableError("insufficient_balance");
    if (input.personalCoupon) {
      await redeemCouponInTx(db, tx, { ...input.personalCoupon, orderId: orderRef.id, now: input.now, channel: "web" });
    }
    tx.set(orderRef, input.order);
    if (input.storeCouponRecord) tx.set(db.collection(COLLECTIONS.orderCoupons).doc(orderRef.id), { ...input.storeCouponRecord, createdAt: nowIso });
    const entry: LoyaltyLedgerEntry & { discountMinor: number } = {
      id: `redeem:${orderRef.id}`,
      memberId: input.points.memberId,
      kind: "redeem",
      points: -input.points.points,
      source: "order",
      orderId: orderRef.id,
      pointValueMinorAtTime: input.points.pointValueMinor,
      discountMinor: Math.round(input.points.discount * 100),
      createdAt: nowIso,
    };
    tx.set(ledger(db).doc(entry.id), entry);
    tx.set(memberRef, { balancePoints: balance - input.points.points, updatedAt: nowIso }, { merge: true });
  });
  loyaltyLog("member.redeem", { memberId: input.points.memberId, orderId: orderRef.id, points: input.points.points });
  return orderRef.id;
}

/**
 * The points still held by an order (for the card charge): their value in ₪, or 0 when the order
 * used none or they were given back.
 */
export async function heldPointsDiscount(db: Firestore, orderId: string): Promise<number> {
  const [redeem, unredeem] = await Promise.all([ledger(db).doc(`redeem:${orderId}`).get(), ledger(db).doc(`unredeem:${orderId}`).get()]);
  if (!redeem.exists || unredeem.exists) return 0;
  const data = redeem.data() as { discountMinor?: unknown; orderId?: unknown };
  if (data.orderId !== orderId) return 0;
  return Math.max(0, Math.round(Number(data.discountMinor) || 0)) / 100;
}

/**
 * Give an order's points back to the member, once (`unredeem:<orderId>`). Marks the order
 * (`pointsReleasedAt`) so the admin no longer shows "points held". Returns the points given back.
 */
export async function releaseOrderPoints(db: Firestore, orderId: string, reason: "cancelled" | "payment_failed", now = new Date()): Promise<number> {
  const redeemRef = ledger(db).doc(`redeem:${orderId}`);
  const unredeemRef = ledger(db).doc(`unredeem:${orderId}`);
  const orderRef = db.collection(COLLECTIONS.orders).doc(orderId);
  const nowIso = now.toISOString();
  const given = await db.runTransaction(async (tx) => {
    const [redeem, unredeem, orderSnap] = await Promise.all([tx.get(redeemRef), tx.get(unredeemRef), tx.get(orderRef)]);
    if (!redeem.exists || unredeem.exists) return 0;
    const entry = redeem.data() as LoyaltyLedgerEntry;
    const points = Math.max(0, -Math.floor(Number(entry.points) || 0));
    if (!entry.memberId || points === 0) return 0;
    const memberRef = db.collection(COLLECTIONS.loyaltyMembers).doc(entry.memberId);
    const memberSnap = await tx.get(memberRef);
    tx.set(unredeemRef, {
      id: unredeemRef.id,
      memberId: entry.memberId,
      kind: "unredeem",
      points,
      source: "order",
      orderId,
      reason,
      pointValueMinorAtTime: entry.pointValueMinorAtTime ?? 0,
      createdAt: nowIso,
    } satisfies LoyaltyLedgerEntry);
    if (memberSnap.exists) {
      const balance = Math.max(0, Math.floor(Number((memberSnap.data() as LoyaltyMember).balancePoints) || 0));
      tx.set(memberRef, { balancePoints: balance + points, updatedAt: nowIso }, { merge: true });
    }
    if (orderSnap.exists) tx.update(orderRef, { pointsReleasedAt: nowIso });
    return points;
  });
  if (given > 0) loyaltyLog("member.unredeem", { orderId, points: given, reason });
  return given;
}
