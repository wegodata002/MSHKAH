import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { mapOrder } from "@/lib/mappers";
import { tryCreateTrackingToken } from "@/lib/orders/tracking-token";
import { buildTrackingView, type OrderTrackingView } from "@/lib/orders/tracking-view";
import type { Order } from "@/types";
import type { FirestoreOrder } from "@/types/firestore";

/**
 * "My orders" for a signed-in club member, on any device: the orders the server linked to the member
 * when they were placed (`loyalty.memberId`, from the signed club cookie — never from the browser).
 * Orders placed while not signed in are not linked (approved). Each order is only the public tracking
 * view (no name, phone, address or courier) plus its signed tracking link.
 */
export const MEMBER_ORDERS_MAX = 100;
export const MEMBER_ORDERS_DAYS = 365;

export type MemberOrder = { token: string; orderNumber: string; view: OrderTrackingView };

/** A card order whose payment was never completed is not shown (the device list skips it too). */
export function isUnpaidCardOrder(order: Pick<Order, "paymentMethod" | "paymentProvider" | "paymentStatus">): boolean {
  const card = order.paymentProvider === "HYP" || String(order.paymentMethod ?? "").toLowerCase() === "card";
  const status = order.paymentStatus ?? "pending";
  return card && (status === "pending" || status === "failed");
}

/** The member's orders to show: last 12 months, newest first, at most 100. Pure. */
export function selectMemberOrders(orders: readonly Order[], now: Date): Order[] {
  const since = now.getTime() - MEMBER_ORDERS_DAYS * 24 * 60 * 60 * 1000;
  return orders
    .filter((o) => {
      const at = Date.parse(o.createdAt ?? "");
      return Number.isFinite(at) && at >= since && !isUnpaidCardOrder(o);
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MEMBER_ORDERS_MAX);
}

/**
 * One equality filter on `loyalty.memberId` (no extra index, same query the club coupons use);
 * the date window and the order are applied here. Capped read as a safety net.
 */
export async function listMemberOrders(db: Firestore, memberId: string, now = new Date()): Promise<MemberOrder[]> {
  const snap = await db.collection(COLLECTIONS.orders).where("loyalty.memberId", "==", memberId).limit(1000).get();
  const orders = snap.docs.map((doc) => mapOrder({ id: doc.id, ...(doc.data() as FirestoreOrder) }));
  const out: MemberOrder[] = [];
  for (const order of selectMemberOrders(orders, now)) {
    const token = tryCreateTrackingToken(order.id);
    if (token) out.push({ token, orderNumber: order.orderNumber, view: buildTrackingView(order) });
  }
  return out;
}
