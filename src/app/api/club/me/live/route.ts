import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { CLUB_COOKIE_NAME } from "@/lib/loyalty/session";
import { readSessionMember } from "@/lib/loyalty/admin/session-member";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Light "did anything change?" check for the open member page (every 10 seconds while visible):
 * reads only the logged-in member (one query) and answers points, cups and the spend toward the
 * next point. The page reloads the full card only when one of them changed.
 */
export async function GET(request: NextRequest) {
  try {
    const member = await readSessionMember(getAdminDb(), request.cookies.get(CLUB_COOKIE_NAME)?.value);
    if (!member) return Response.json({ ok: false }, { headers: { "cache-control": "no-store" } });
    return Response.json(
      {
        ok: true,
        balancePoints: member.balancePoints ?? 0,
        coffeeCups: Math.max(0, Math.floor(member.coffeeCups ?? 0)),
        pointsCarryMinor: member.pointsCarryMinor ?? 0,
        status: member.status,
      },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return Response.json({ ok: false }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
