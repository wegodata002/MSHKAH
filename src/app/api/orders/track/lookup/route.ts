import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { consumeRateLimit, rateLimitKey } from "@/lib/loyalty/admin/rate-limit";
import { handleTrackingLookup } from "@/lib/orders/tracking-lookup";
import { createTrackingToken } from "@/lib/orders/tracking-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** "Find my order": POST { orderNumber, phone } → { token } for the tracking page. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  try {
    const db = getAdminDb();
    const result = await handleTrackingLookup(body, ip, {
      rateLimit: async (key, windowSeconds, limit) =>
        (await consumeRateLimit(db, { key: rateLimitKey([key]), windowSeconds, limit })).ok,
      findOrdersByNumber: async (orderNumber) => {
        const snap = await db.collection(COLLECTIONS.orders).where("orderNumber", "==", orderNumber).limit(5).get();
        return snap.docs.map((doc) => ({ id: doc.id, customerPhone: doc.get("customerPhone") as string | undefined }));
      },
      createToken: createTrackingToken,
    });
    return Response.json(result.body, { status: result.status, headers: NO_STORE });
  } catch (error) {
    console.error("[orders/track/lookup] failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
