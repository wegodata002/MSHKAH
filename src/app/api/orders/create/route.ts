import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { consumeRateLimit, rateLimitKey } from "@/lib/loyalty/admin/rate-limit";
import { handleCreateOrder } from "@/lib/orders/create-order-handler";
import { loadCatalogProducts, loadFulfillmentContext } from "@/lib/orders/server-context";
import { CLUB_COOKIE_NAME, readClubSession } from "@/lib/loyalty/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Creates a storefront order on the server: catalog prices, coupon, order type and delivery fee. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";

  let db: ReturnType<typeof getAdminDb>;
  try {
    db = getAdminDb();
  } catch (error) {
    console.error("[orders/create] admin unavailable:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, code: "ORDER_SAVE_FAILED" }, { status: 500 });
  }

  const result = await handleCreateOrder(body, ip, {
    now: () => new Date(),
    loadProducts: (ids) => loadCatalogProducts(db, ids),
    loadContext: () => loadFulfillmentContext(db),
    rateLimit: async (key, windowSeconds, limit) =>
      (await consumeRateLimit(db, { key: rateLimitKey([key]), windowSeconds, limit })).ok,
    findClubMember: async () => {
      const session = readClubSession(request.cookies.get(CLUB_COOKIE_NAME)?.value);
      if (!session) return null;
      const snap = await db
        .collection(COLLECTIONS.loyaltyMembers)
        .where("emailHash", "==", session.emailHash)
        .limit(1)
        .get();
      const doc = snap.docs[0];
      if (!doc) return null;
      const email = (doc.data() as { email?: unknown }).email;
      return { id: doc.id, email: typeof email === "string" ? email : null };
    },
    saveOrder: async (draft) => {
      const now = Timestamp.now();
      const ref = await db.collection(COLLECTIONS.orders).add({ ...draft, createdAt: now, receivedAt: now });
      return ref.id;
    },
  });
  return NextResponse.json(result.body, { status: result.status });
}
