import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { CLUB_COOKIE_NAME, readClubSession } from "@/lib/loyalty/session";
import { readSessionMember } from "@/lib/loyalty/admin/session-member";
import { consumeRateLimit, rateLimitKey } from "@/lib/loyalty/admin/rate-limit";
import { countCustomerUses, readStoreCoupon } from "@/lib/coupons/admin/store";
import { checkStoreCoupon, normalizeStoreCode, storeCouponDiscount } from "@/lib/coupons/store-coupons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store, private" };
const LIMIT = { windowSeconds: 10 * 60, limit: 40 } as const;

/**
 * The cart asks whether a store coupon applies: POST { code, subtotal }. Checked here on the server:
 * active, date, "club members only" (by the signed club cookie — never by what the browser sends),
 * once per customer for a signed-in member, minimum order, not the whole order. The order route
 * checks everything again (with the phone) and prices the order itself.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { code?: unknown; subtotal?: unknown } | null;
  const code = normalizeStoreCode(body?.code);
  const subtotal = Number(body?.subtotal);
  if (!code || code.length > 40 || !Number.isFinite(subtotal) || subtotal < 0) {
    return Response.json({ ok: false, reason: "invalid" }, { status: 400, headers: NO_STORE });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  try {
    const db = getAdminDb();
    const limited = await consumeRateLimit(db, { key: rateLimitKey(["coupon-check-store", ip]), ...LIMIT });
    if (!limited.ok) return Response.json({ ok: false, reason: "invalid" }, { status: 429, headers: NO_STORE });
    const cookie = request.cookies.get(CLUB_COOKIE_NAME)?.value;
    const member = readClubSession(cookie) ? await readSessionMember(db, cookie) : null;
    const coupon = await readStoreCoupon(db, code);
    const customerUses = coupon?.limit === "once" && member ? await countCustomerUses(db, code, { memberId: member.id, phone: null }) : 0;
    const check = checkStoreCoupon(coupon, { now: new Date(), isMember: member?.status === "active", customerUses });
    if (!check.ok) return Response.json({ ok: false, reason: check.reason }, { headers: NO_STORE });
    const priced = storeCouponDiscount(subtotal, check.coupon);
    if (!priced.ok) return Response.json({ ok: false, reason: priced.reason, minOrder: priced.minOrder }, { headers: NO_STORE });
    const c = check.coupon;
    return Response.json(
      { ok: true, coupon: { code: c.code, name: c.name, type: c.type, value: c.value, minOrder: c.minOrder } },
      { headers: NO_STORE }
    );
  } catch (error) {
    console.error("[coupons/check] failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, reason: "invalid" }, { status: 500, headers: NO_STORE });
  }
}
