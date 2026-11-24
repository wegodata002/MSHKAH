import { NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { awardLoyaltyPointsForOrder } from "@/lib/loyalty/order-hook";

export const runtime = "nodejs";

/**
 * Club points for an order paid at the counter / to the courier, called after staff mark it
 * "paid" in the admin. Card orders already get points from the payment pipeline. Idempotent:
 * the ledger entry is keyed by the order id, so a second call never awards twice.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { orderId?: unknown } | null;
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) return Response.json({ ok: false, code: "ORDER_REQUIRED" }, { status: 400 });

  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.orders).doc(orderId).get();
  if (!snap.exists) return Response.json({ ok: false, code: "ORDER_NOT_FOUND" }, { status: 404 });
  const order = snap.data() as { paymentStatus?: string; status?: string };
  // Only a really paid, not cancelled order earns points (checked here, not trusted from the browser).
  if (order.paymentStatus !== "paid" || order.status === "cancelled") {
    return Response.json({ ok: false, code: "ORDER_NOT_PAID" }, { status: 409 });
  }
  const result = await awardLoyaltyPointsForOrder(orderId, db);
  return Response.json({ ok: result.ok, status: result.status });
}
