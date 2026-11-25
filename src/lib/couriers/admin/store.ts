import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { toIsoTimestamp } from "@/lib/dates/normalize";
import { normalizeOrderStatus } from "@/lib/orders/status";
import { awardLoyaltyPointsForOrder } from "@/lib/loyalty/order-hook";
import { jerusalemDate, type StaffMemberDoc } from "@/lib/staff/types";
import {
  decideCourierAction,
  openDeliveryCount,
  sortCourierDeliveries,
  toCourierDelivery,
  type CourierAction,
  type CourierDelivery,
  type CourierOrderInput,
  type PaidWith,
} from "@/lib/couriers/deliveries";

/** Server-only (Admin SDK) courier data: who works today, assignments, the courier's own list and actions. */

export type WorkingCourier = { id: string; name: string };

/** Couriers marked "working today" and active, for the admin order card. */
export async function listWorkingCouriers(db: Firestore, now = new Date()): Promise<WorkingCourier[]> {
  const snap = await db
    .collection(COLLECTIONS.staffMembers)
    .where("role", "==", "courier")
    .where("workingDate", "==", jerusalemDate(now))
    .get();
  return snap.docs
    .filter((doc) => (doc.data() as StaffMemberDoc).active)
    .map((doc) => ({ id: doc.id, name: (doc.data() as StaffMemberDoc).name }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));
}

export type AssignResult =
  | { ok: true; courier: WorkingCourier | null }
  | { ok: false; code: "ORDER_NOT_FOUND" | "NOT_DELIVERY" | "ORDER_CLOSED" | "COURIER_NOT_AVAILABLE" };

/** Admin: give a delivery order to a courier working today (or take it away with courierId null). */
export async function assignCourier(
  db: Firestore,
  input: { orderId: string; courierId: string | null; now?: Date }
): Promise<AssignResult> {
  const now = input.now ?? new Date();
  const orderRef = db.collection(COLLECTIONS.orders).doc(input.orderId);
  return db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) return { ok: false as const, code: "ORDER_NOT_FOUND" as const };
    const order = orderSnap.data() as { orderType?: string; status?: string };
    if (order.orderType !== "delivery") return { ok: false as const, code: "NOT_DELIVERY" as const };
    const status = normalizeOrderStatus(order.status);
    if (status === "delivered" || status === "cancelled") return { ok: false as const, code: "ORDER_CLOSED" as const };

    if (!input.courierId) {
      tx.update(orderRef, {
        courierId: FieldValue.delete(),
        courierName: FieldValue.delete(),
        courierAssignedAt: FieldValue.delete(),
        courierAssignedDate: FieldValue.delete(),
      });
      return { ok: true as const, courier: null };
    }

    const courierSnap = await tx.get(db.collection(COLLECTIONS.staffMembers).doc(input.courierId));
    const courier = courierSnap.data() as StaffMemberDoc | undefined;
    if (!courier || courier.role !== "courier" || !courier.active || courier.workingDate !== jerusalemDate(now)) {
      return { ok: false as const, code: "COURIER_NOT_AVAILABLE" as const };
    }
    tx.update(orderRef, {
      courierId: courierSnap.id,
      courierName: courier.name,
      courierAssignedAt: FieldValue.serverTimestamp(),
      courierAssignedDate: jerusalemDate(now),
    });
    return { ok: true as const, courier: { id: courierSnap.id, name: courier.name } };
  });
}

function toInput(id: string, data: Record<string, unknown>): CourierOrderInput {
  const iso = (v: unknown) => (v ? toIsoTimestamp(v) : null);
  return {
    ...(data as CourierOrderInput),
    id,
    readyAt: iso(data.readyAt),
    outForDeliveryAt: iso(data.outForDeliveryAt),
    deliveredAt: iso(data.deliveredAt ?? data.completedAt),
  };
}

/** The courier's deliveries assigned today (Jerusalem), in "what to do now" order. */
export async function listCourierDeliveries(db: Firestore, courierId: string, now = new Date()): Promise<CourierDelivery[]> {
  const snap = await db
    .collection(COLLECTIONS.orders)
    .where("courierId", "==", courierId)
    .where("courierAssignedDate", "==", jerusalemDate(now))
    .get();
  return sortCourierDeliveries(snap.docs.map((doc) => toCourierDelivery(toInput(doc.id, doc.data()))));
}

export type ShiftResult = { ok: true; worksToday: boolean } | { ok: false; code: "NOT_FOUND" } | { ok: false; code: "OPEN_DELIVERIES"; open: number };

/**
 * "Started my shift" / "Finished my shift" from the courier screen: marks the courier "working today"
 * (until the end of the day, Jerusalem time) or clears it, like the toggle on the admin Staff page.
 * Ending is refused while the courier still has open deliveries today (they would vanish from the screen).
 */
export async function setCourierShift(
  db: Firestore,
  input: { courierId: string; on: boolean; now?: Date }
): Promise<ShiftResult> {
  const now = input.now ?? new Date();
  if (!input.on) {
    const open = openDeliveryCount(await listCourierDeliveries(db, input.courierId, now));
    if (open > 0) return { ok: false, code: "OPEN_DELIVERIES", open };
  }
  const ref = db.collection(COLLECTIONS.staffMembers).doc(input.courierId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, code: "NOT_FOUND" };
  await ref.update({
    workingDate: input.on ? jerusalemDate(now) : null,
    updatedAt: now.toISOString(),
    updatedBy: `courier:${input.courierId}`,
  });
  return { ok: true, worksToday: input.on };
}

export type CourierActionResult =
  | { ok: true; delivery: CourierDelivery }
  | { ok: false; code: "ORDER_NOT_FOUND" | "NOT_YOURS" | "NOT_DELIVERY" | "CANCELLED" | "ALREADY_DELIVERED" | "PAYMENT_REQUIRED" };

/** "I'm leaving" / "Delivered" from the courier screen: only on the courier's own delivery. */
export async function applyCourierAction(
  db: Firestore,
  input: { courier: { id: string; name: string }; orderId: string; action: CourierAction; paidWith: PaidWith | null }
): Promise<CourierActionResult> {
  const ref = db.collection(COLLECTIONS.orders).doc(input.orderId);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, code: "ORDER_NOT_FOUND" as const };
    const data = snap.data() as Record<string, unknown>;
    if (data.courierId !== input.courier.id) return { ok: false as const, code: "NOT_YOURS" as const };
    const decision = decideCourierAction(toInput(snap.id, data), input.action, input.paidWith, input.courier.name);
    if (!decision.ok) return decision;
    const write: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(decision.patch)) write[key] = value === "now" ? FieldValue.serverTimestamp() : value;
    tx.update(ref, write);
    return { ok: true as const, paidAtDoor: decision.paidAtDoor };
  });
  if (!result.ok) return result;

  // Paid at the door: club points like a counter payment (idempotent; never fails the delivery).
  if (result.paidAtDoor) await awardLoyaltyPointsForOrder(input.orderId, db).catch(() => undefined);

  const fresh = await ref.get();
  return { ok: true, delivery: toCourierDelivery(toInput(fresh.id, fresh.data() ?? {})) };
}
