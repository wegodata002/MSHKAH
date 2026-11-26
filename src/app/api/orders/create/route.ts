import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { consumeRateLimit, rateLimitKey } from "@/lib/loyalty/admin/rate-limit";
import { handleCreateOrder } from "@/lib/orders/create-order-handler";
import { loadCatalogProducts, loadFulfillmentContext } from "@/lib/orders/server-context";
import { loadModifierConfigs } from "@/lib/orders/admin-modifier-config";
import { CLUB_COOKIE_NAME } from "@/lib/loyalty/session";
import { readSessionMember } from "@/lib/loyalty/admin/session-member";
import { checkCouponForMember, saveOrderWithCoupon } from "@/lib/loyalty/admin/coupons";
import type { LoyaltyMember } from "@/lib/loyalty/types";
import { saveMemberCheckoutDetails } from "@/lib/loyalty/admin/checkout-details";
import { tryCreateTrackingToken } from "@/lib/orders/tracking-token";

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
    loadModifierConfigs: (ids) => loadModifierConfigs(db, ids),
    rateLimit: async (key, windowSeconds, limit) =>
      (await consumeRateLimit(db, { key: rateLimitKey([key]), windowSeconds, limit })).ok,
    findClubMember: async () => {
      const member = await readSessionMember(db, request.cookies.get(CLUB_COOKIE_NAME)?.value);
      if (!member) return null;
      return { id: member.id, email: typeof member.email === "string" ? member.email : null, status: member.status };
    },
    checkClubCoupon: async (code, member) => {
      const result = await checkCouponForMember(db, {
        code,
        member: { id: member.id, status: (member.status ?? "suspended") as LoyaltyMember["status"] },
        now: new Date(),
      });
      return result.ok ? { ok: true, percent: result.percent, heldBy: result.heldBy } : result;
    },
    saveOrderWithCoupon: async (draft, coupon) => {
      const now = Timestamp.now();
      return saveOrderWithCoupon(db, { order: { ...draft, createdAt: now, receivedAt: now }, coupon, now: new Date() });
    },
    saveOrder: async (draft) => {
      const now = Timestamp.now();
      const ref = await db.collection(COLLECTIONS.orders).add({ ...draft, createdAt: now, receivedAt: now });
      return ref.id;
    },
    rememberMemberCheckout: (memberId, order) => saveMemberCheckoutDetails(db, memberId, order),
  });
  // The customer's tracking link ("Track your order" on the confirmation screen).
  // The order is saved by now: a tracking-link problem must not turn this into an error.
  const trackingToken = result.body.ok ? tryCreateTrackingToken(result.body.id) : null;
  const responseBody = result.body.ok && trackingToken ? { ...result.body, trackingToken } : result.body;
  return NextResponse.json(responseBody, { status: result.status });
}
