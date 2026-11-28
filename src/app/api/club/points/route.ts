import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { CLUB_COOKIE_NAME } from "@/lib/loyalty/session";
import { readSessionMember } from "@/lib/loyalty/admin/session-member";
import { readLoyaltySettings } from "@/lib/loyalty/admin/members";
import { redemptionReady } from "@/lib/loyalty/redemption";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store, private" };

/**
 * Checkout: can the member logged in here pay with points, and how many does she have (read only).
 * `ready: false` while redemption is off, the point value is not set and approved, or no active
 * member is logged in. The order route checks everything again.
 */
export async function GET(request: NextRequest) {
  try {
    const db = getAdminDb();
    const [member, settings] = await Promise.all([
      readSessionMember(db, request.cookies.get(CLUB_COOKIE_NAME)?.value),
      readLoyaltySettings(db),
    ]);
    if (!member || member.status !== "active" || !redemptionReady(settings)) return Response.json({ ok: true, ready: false }, { headers: NO_STORE });
    return Response.json(
      {
        ok: true,
        ready: true,
        balancePoints: Math.max(0, Math.floor(Number(member.balancePoints) || 0)),
        settings: {
          redemptionEnabled: settings.redemptionEnabled,
          pointValueApproved: settings.pointValueApproved,
          pointValueMinor: settings.pointValueMinor,
          redemptionMinPoints: settings.redemptionMinPoints,
          redemptionMaxPoints: settings.redemptionMaxPoints,
        },
      },
      { headers: NO_STORE }
    );
  } catch {
    return Response.json({ ok: false, ready: false }, { status: 500, headers: NO_STORE });
  }
}
