import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { mapOrder } from "@/lib/mappers";
import { readTrackingToken } from "@/lib/orders/tracking-token";
import { buildTrackingView, type OrderTrackingView } from "@/lib/orders/tracking-view";
import { MY_ORDERS_MAX } from "@/lib/orders/my-orders-limits";
import type { FirestoreOrder } from "@/types/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * "My orders" on this device in one call: POST { tokens: string[] } (up to 60 tracking links).
 * Read-only; for each valid link only the public tracking view (the same as /api/orders/track).
 * Unknown or invalid links are simply left out of the answer.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { tokens?: unknown } | null;
  const tokens = Array.isArray(body?.tokens) ? body.tokens.filter((t): t is string => typeof t === "string") : null;
  if (!tokens || tokens.length > MY_ORDERS_MAX) return Response.json({ ok: false, code: "INVALID" }, { status: 400, headers: NO_STORE });
  try {
    // Inside the try: without the signing secret (production) this throws, logged as "[config] …".
    const byOrderId = new Map<string, string>();
    for (const token of new Set(tokens)) {
      const orderId = readTrackingToken(token);
      if (orderId) byOrderId.set(orderId, token);
    }
    const orders: Record<string, OrderTrackingView> = {};
    if (byOrderId.size > 0) {
      const db = getAdminDb();
      const snaps = await db.getAll(...[...byOrderId.keys()].map((id) => db.collection(COLLECTIONS.orders).doc(id)));
      for (const snap of snaps) {
        if (!snap.exists) continue;
        orders[byOrderId.get(snap.id)!] = buildTrackingView(mapOrder({ id: snap.id, ...(snap.data() as FirestoreOrder) }));
      }
    }
    return Response.json({ ok: true, orders }, { headers: NO_STORE });
  } catch (error) {
    console.error("[orders/track/batch] failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
