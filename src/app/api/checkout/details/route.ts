import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { CLUB_COOKIE_NAME, readClubSession } from "@/lib/loyalty/session";
import { readSessionMember } from "@/lib/loyalty/admin/session-member";
import { isClubMember, memberCheckoutDetails } from "@/lib/loyalty/admin/checkout-details";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store, private" };

/**
 * The checkout's saved details for the club member logged in on this device — only their own,
 * found by the signed club cookie (nothing is taken from the request). `member: false` = not a
 * logged-in member: the checkout uses what this device kept instead.
 */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(CLUB_COOKIE_NAME)?.value;
  if (!readClubSession(cookie)) return Response.json({ ok: true, member: false }, { headers: NO_STORE });
  try {
    const member = await readSessionMember(getAdminDb(), cookie);
    if (!member || !isClubMember(member.status)) return Response.json({ ok: true, member: false }, { headers: NO_STORE });
    return Response.json({ ok: true, member: true, details: memberCheckoutDetails(member) }, { headers: NO_STORE });
  } catch {
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
