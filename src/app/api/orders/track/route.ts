import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { mapOrder } from "@/lib/mappers";
import { readTrackingToken } from "@/lib/orders/tracking-token";
import { buildTrackingView } from "@/lib/orders/tracking-view";
import type { FirestoreOrder } from "@/types/firestore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Customer order tracking: GET /api/orders/track?t=<token>. Read-only; answers only the public view
 * of that one order (no phone, email, address or courier). The tracking page calls it every 10 seconds.
 */
export async function GET(request: NextRequest) {
  try {
    // Inside the try: without the signing secret (production) this throws, logged as "[config] …".
    const orderId = readTrackingToken(request.nextUrl.searchParams.get("t"));
    if (!orderId) return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
    const snap = await getAdminDb().collection(COLLECTIONS.orders).doc(orderId).get();
    if (!snap.exists) return Response.json({ ok: false, code: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
    const view = buildTrackingView(mapOrder({ id: snap.id, ...(snap.data() as FirestoreOrder) }));
    return Response.json({ ok: true, order: view }, { headers: NO_STORE });
  } catch (error) {
    console.error("[orders/track] failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
