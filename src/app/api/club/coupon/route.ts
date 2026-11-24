import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { CLUB_COOKIE_NAME } from "@/lib/loyalty/session";
import { readSessionMember } from "@/lib/loyalty/admin/session-member";
import { checkCouponForMember, memberCouponViews } from "@/lib/loyalty/admin/coupons";
import { consumeRateLimit, rateLimitKey } from "@/lib/loyalty/admin/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The logged-in member's coupons that can be used now (for the "use your code" offer in the cart). */
export async function GET(request: NextRequest) {
  try {
    const db = getAdminDb();
    const member = await readSessionMember(db, request.cookies.get(CLUB_COOKIE_NAME)?.value);
    if (!member || member.status !== "active") return Response.json({ ok: true, coupons: [] });
    const coupons = (await memberCouponViews(db, member.id, new Date())).filter((c) => c.state === "active");
    return Response.json({ ok: true, coupons });
  } catch (error) {
    console.error("[loyalty] coupon list failed", { message: error instanceof Error ? error.message : String(error) });
    return Response.json({ ok: true, coupons: [] });
  }
}

/**
 * Can the logged-in member use this personal code now? Codes of other members answer "invalid";
 * without a club login the answer is "login_required". The order route checks again on its own.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { code?: string } | null;
  const code = body?.code?.trim() ?? "";
  try {
    const db = getAdminDb();
    const member = await readSessionMember(db, request.cookies.get(CLUB_COOKIE_NAME)?.value);
    if (!member) return Response.json({ ok: false, reason: "login_required" });
    const bucket = await consumeRateLimit(db, {
      key: rateLimitKey(["coupon-check", member.id]),
      windowSeconds: 600,
      limit: 30,
    });
    if (!bucket.ok) return Response.json({ ok: false, reason: "invalid" }, { status: 429 });
    const result = await checkCouponForMember(db, { code, member, now: new Date() });
    return result.ok
      ? Response.json({ ok: true, code: result.coupon.code, percent: result.percent })
      : Response.json({ ok: false, reason: result.reason });
  } catch (error) {
    console.error("[loyalty] coupon check failed", { message: error instanceof Error ? error.message : String(error) });
    return Response.json({ ok: false, reason: "invalid" }, { status: 500 });
  }
}
