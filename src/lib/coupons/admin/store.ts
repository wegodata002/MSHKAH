import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  BUILTIN_COUPONS,
  isCountedCouponUse,
  isSameCustomer,
  resolveStoreCoupon,
  type CouponInput,
  type StoreCoupon,
  type StoreCouponDoc,
} from "@/lib/coupons/store-coupons";

/** Server-only (Admin SDK): store coupons, their uses, and the discount saved with each order. */

/** Just the coupon fields (no built-in flag, no who/when, no deleted marker). */
function couponFields(c: StoreCoupon | StoreCouponDoc): CouponInput {
  return { code: c.code, name: c.name, type: c.type, value: c.value, expiresOn: c.expiresOn, audience: c.audience, minOrder: c.minOrder, limit: c.limit, active: c.active };
}

function couponRef(db: Firestore, code: string) {
  return db.collection(COLLECTIONS.storeCoupons).doc(code);
}

/** The coupon as it works now (record first; MISHKAT10 from the code until it has a record). */
export async function readStoreCoupon(db: Firestore, code: string): Promise<StoreCoupon | null> {
  if (!code) return null;
  const snap = await couponRef(db, code).get();
  return resolveStoreCoupon(code, snap.exists ? (snap.data() as StoreCouponDoc) : null);
}

type OrderForUse = Parameters<typeof isCountedCouponUse>[0] & Parameters<typeof isSameCustomer>[0];

/** Orders that used this code and count (not cancelled, not an unpaid card order, priced by the server). */
async function countedUses(db: Firestore, code: string): Promise<OrderForUse[]> {
  const snap = await db.collection(COLLECTIONS.orders).where("couponCode", "==", code).get();
  return snap.docs.map((d) => d.data() as OrderForUse).filter(isCountedCouponUse);
}

export async function countCouponUses(db: Firestore, code: string): Promise<number> {
  return (await countedUses(db, code)).length;
}

/** "Once per customer": uses by this club member, or by this phone (normalized). */
export async function countCustomerUses(db: Firestore, code: string, who: { memberId?: string | null; phone?: string | null }): Promise<number> {
  if (!who.memberId && !who.phone) return 0;
  return (await countedUses(db, code)).filter((o) => isSameCustomer(o, who)).length;
}

export type CouponListItem = StoreCoupon & { uses: number; updatedAt?: string };

/** Admin list: every record that is not deleted, plus a built-in coupon that has no record yet. */
export async function listStoreCoupons(db: Firestore): Promise<CouponListItem[]> {
  const snap = await db.collection(COLLECTIONS.storeCoupons).get();
  const docs = new Map(snap.docs.map((d) => [d.id, d.data() as StoreCouponDoc]));
  const coupons: Array<StoreCoupon & { updatedAt?: string }> = [];
  for (const [code, doc] of docs) if (!doc.deleted) coupons.push({ ...couponFields({ ...doc, code }), updatedAt: doc.updatedAt });
  for (const [code, builtin] of Object.entries(BUILTIN_COUPONS)) if (!docs.has(code)) coupons.push(builtin);
  const uses = await Promise.all(coupons.map((c) => countCouponUses(db, c.code)));
  return coupons
    .map((c, i) => ({ ...c, uses: uses[i]! }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export type CouponWriteResult = { ok: true; coupon: StoreCoupon } | { ok: false; code: "EXISTS" | "NOT_FOUND" };

/** New coupon: the code must be free (a deleted coupon's code can be used again). */
export async function createStoreCoupon(db: Firestore, input: { coupon: CouponInput; actor: string; now?: Date }): Promise<CouponWriteResult> {
  const now = (input.now ?? new Date()).toISOString();
  const ref = couponRef(db, input.coupon.code);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as StoreCouponDoc) : null;
    const taken = existing ? !existing.deleted : !!BUILTIN_COUPONS[input.coupon.code];
    if (taken) return { ok: false as const, code: "EXISTS" as const };
    const doc: StoreCouponDoc = { ...input.coupon, createdAt: now, createdBy: input.actor, updatedAt: now, updatedBy: input.actor };
    tx.set(ref, doc);
    return { ok: true as const, coupon: input.coupon };
  });
}

/**
 * Edit (the code stays) or switch on/off. A built-in coupon without a record gets one now — from then
 * on the record always wins.
 */
export async function updateStoreCoupon(
  db: Firestore,
  input: { code: string; patch: Partial<Omit<CouponInput, "code">>; actor: string; now?: Date }
): Promise<CouponWriteResult> {
  const now = (input.now ?? new Date()).toISOString();
  const ref = couponRef(db, input.code);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = resolveStoreCoupon(input.code, snap.exists ? (snap.data() as StoreCouponDoc) : null);
    if (!current) return { ok: false as const, code: "NOT_FOUND" as const };
    const fields: CouponInput = { ...couponFields(current), ...input.patch, code: input.code };
    const next: StoreCouponDoc = { ...fields, updatedAt: now, updatedBy: input.actor };
    if (!snap.exists) {
      next.createdAt = now;
      next.createdBy = input.actor;
    }
    tx.set(ref, next);
    return { ok: true as const, coupon: fields };
  });
}

/** Delete: past orders keep their code and discount. A built-in code keeps a "deleted" marker so it stays off. */
export async function deleteStoreCoupon(db: Firestore, input: { code: string; actor: string; now?: Date }): Promise<boolean> {
  const ref = couponRef(db, input.code);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = resolveStoreCoupon(input.code, snap.exists ? (snap.data() as StoreCouponDoc) : null);
    if (!current) return false;
    if (BUILTIN_COUPONS[input.code]) {
      const marker: StoreCouponDoc = { ...couponFields(current), active: false, deleted: true, updatedAt: (input.now ?? new Date()).toISOString(), updatedBy: input.actor };
      tx.set(ref, marker);
    } else {
      tx.delete(ref);
    }
    return true;
  });
}

// ---- the discount saved with the order (for the card charge) ----

/** Stored in `orderCoupons/{orderId}` (server only), written in the same batch as the order. */
export type OrderCouponRecord = { code: string; type: StoreCoupon["type"]; value: number; discount: number; createdAt: string };

export async function saveOrderWithStoreCoupon(db: Firestore, input: { order: Record<string, unknown>; record: Omit<OrderCouponRecord, "createdAt">; now: Date }): Promise<string> {
  const orderRef = db.collection(COLLECTIONS.orders).doc();
  const batch = db.batch();
  batch.set(orderRef, input.order);
  batch.set(db.collection(COLLECTIONS.orderCoupons).doc(orderRef.id), { ...input.record, createdAt: input.now.toISOString() });
  await batch.commit();
  return orderRef.id;
}

export async function readOrderCouponRecord(db: Firestore, orderId: string): Promise<OrderCouponRecord | null> {
  const snap = await db.collection(COLLECTIONS.orderCoupons).doc(orderId).get();
  return snap.exists ? (snap.data() as OrderCouponRecord) : null;
}
