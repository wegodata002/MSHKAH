import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { CLUB_COOKIE_NAME, readClubSession } from "@/lib/loyalty/session";
import { readSessionMember } from "@/lib/loyalty/admin/session-member";
import { isClubMember } from "@/lib/loyalty/admin/checkout-details";
import { listMemberOrders } from "@/lib/loyalty/admin/member-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store, private" };

/**
 * "My orders" of the club member signed in on this device, from every device: only their own orders
 * (found by the signed club cookie; nothing is taken from the request), each as the public tracking
 * view with its tracking link. `member: false` = not a signed-in member (the device list is used).
 */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(CLUB_COOKIE_NAME)?.value;
  if (!readClubSession(cookie)) return Response.json({ ok: true, member: false }, { headers: NO_STORE });
  try {
    const db = getAdminDb();
    const member = await readSessionMember(db, cookie);
    if (!member || !isClubMember(member.status)) return Response.json({ ok: true, member: false }, { headers: NO_STORE });
    return Response.json({ ok: true, member: true, orders: await listMemberOrders(db, member.id) }, { headers: NO_STORE });
  } catch (error) {
    console.error("[club/orders] failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
