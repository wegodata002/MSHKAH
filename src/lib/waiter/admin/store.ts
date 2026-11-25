import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { toIsoTimestamp } from "@/lib/dates/normalize";
import { normalizeFulfillmentSettings, type DineInTable } from "@/lib/fulfillment/settings";
import { awardLoyaltyPointsForOrder } from "@/lib/loyalty/order-hook";
import { jerusalemDate, type StaffMemberDoc } from "@/lib/staff/types";
import {
  decidePaid,
  decideServed,
  toWaiterOrder,
  type PaidWith,
  type WaiterOrder,
  type WaiterOrderInput,
  type WaiterPatch,
} from "@/lib/waiter/tables";

/** Server-only (Admin SDK) waiter screen data: tables, today's table orders, "served" / "paid". */

export async function loadTables(db: Firestore): Promise<{ enabled: boolean; tables: DineInTable[] }> {
  const snap = await db.collection(COLLECTIONS.settings).doc("app").get();
  const fulfillment = normalizeFulfillmentSettings((snap.data() as { fulfillment?: unknown } | undefined)?.fulfillment);
  return { enabled: fulfillment.dineIn.enabled, tables: fulfillment.dineIn.tables };
}

function toInput(id: string, data: Record<string, unknown>): WaiterOrderInput {
  const iso = (v: unknown) => (v ? toIsoTimestamp(v) : null);
  return {
    ...(data as WaiterOrderInput),
    id,
    readyAt: iso(data.readyAt),
    deliveredAt: iso(data.deliveredAt ?? data.completedAt),
    createdAt: iso(data.createdAt) ?? "",
  };
}

/** Today's (Jerusalem) table orders, all tables. Two equality filters: no extra index needed. */
export async function listTodayTableOrders(db: Firestore, now = new Date()): Promise<WaiterOrder[]> {
  const snap = await db
    .collection(COLLECTIONS.orders)
    .where("orderType", "==", "dine_in")
    .where("serviceDate", "==", jerusalemDate(now))
    .get();
  return snap.docs.map((doc) => toWaiterOrder(toInput(doc.id, doc.data())));
}

export type WaiterRef = { id: string; name: string };

/** Active waiters, for "Who is working now?" on a fixed tablet. */
export async function listActiveWaiters(db: Firestore): Promise<WaiterRef[]> {
  const snap = await db.collection(COLLECTIONS.staffMembers).where("role", "==", "waiter").get();
  return snap.docs
    .filter((doc) => (doc.data() as StaffMemberDoc).active)
    .map((doc) => ({ id: doc.id, name: (doc.data() as StaffMemberDoc).name }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
}

export async function findActiveWaiter(db: Firestore, waiterId: string): Promise<WaiterRef | null> {
  if (!/^[A-Za-z0-9]{8,64}$/.test(waiterId)) return null;
  const snap = await db.collection(COLLECTIONS.staffMembers).doc(waiterId).get();
  const doc = snap.data() as StaffMemberDoc | undefined;
  return doc && doc.active && doc.role === "waiter" ? { id: snap.id, name: doc.name } : null;
}

function toWrite(patch: WaiterPatch): Record<string, unknown> {
  const write: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) write[key] = value === "now" ? FieldValue.serverTimestamp() : value;
  return write;
}

export type WaiterActionResult = { ok: true; changed: number } | { ok: false; code: string };

/** "Served" on one table order. */
export async function markServed(db: Firestore, input: { orderId: string; actor: string }): Promise<WaiterActionResult> {
  const ref = db.collection(COLLECTIONS.orders).doc(input.orderId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, code: "ORDER_NOT_FOUND" };
    const decision = decideServed(toInput(snap.id, snap.data() ?? {}), input.actor);
    if (!decision.ok) return decision;
    tx.update(ref, toWrite(decision.patch));
    return { ok: true as const, changed: 1 };
  });
}

/**
 * "Paid" (cash / card) on one order or on all unpaid orders of a table at once. All in one
 * transaction: either every listed order is marked paid or none. Club points follow (idempotent).
 */
export async function markPaid(
  db: Firestore,
  input: { orderIds: string[]; paidWith: PaidWith; actor: string }
): Promise<WaiterActionResult> {
  const ids = [...new Set(input.orderIds)].slice(0, 30);
  if (ids.length === 0) return { ok: false, code: "INVALID" };
  const refs = ids.map((id) => db.collection(COLLECTIONS.orders).doc(id));
  const result = await db.runTransaction(async (tx) => {
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    const writes: { ref: (typeof refs)[number]; patch: WaiterPatch }[] = [];
    for (const snap of snaps) {
      if (!snap.exists) return { ok: false as const, code: "ORDER_NOT_FOUND" };
      const decision = decidePaid(toInput(snap.id, snap.data() ?? {}), input.paidWith, input.actor);
      if (!decision.ok) return decision;
      writes.push({ ref: snap.ref, patch: decision.patch });
    }
    for (const w of writes) tx.update(w.ref, toWrite(w.patch));
    return { ok: true as const, changed: writes.length };
  });
  if (result.ok) await Promise.all(ids.map((id) => awardLoyaltyPointsForOrder(id, db).catch(() => undefined)));
  return result;
}
