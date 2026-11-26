import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { CLUB_COOKIE_NAME, readClubSession } from "@/lib/loyalty/session";
import { readSessionMember } from "@/lib/loyalty/admin/session-member";
import { isClubMember } from "@/lib/loyalty/admin/checkout-details";
import { changeMemberFavorites, dropDeletedFavorites } from "@/lib/loyalty/admin/member-favorites";
import { cleanFavoriteIds, parseFavoritesChange } from "@/lib/loyalty/favorites";
import { consumeRateLimit, rateLimitKey } from "@/lib/loyalty/admin/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store, private" };
const LIMIT = { windowSeconds: 10 * 60, limit: 300 } as const;

async function sessionMember(request: NextRequest) {
  const cookie = request.cookies.get(CLUB_COOKIE_NAME)?.value;
  if (!readClubSession(cookie)) return null;
  const db = getAdminDb();
  const member = await readSessionMember(db, cookie);
  return member && isClubMember(member.status) ? { db, member } : null;
}

/**
 * The signed-in member's favourites (by the club cookie only), without products deleted from the menu
 * (they are removed from the account here, so the ♡ count is right). `member: false` = use the device list.
 */
export async function GET(request: NextRequest) {
  try {
    const found = await sessionMember(request);
    if (!found) return Response.json({ ok: true, member: false }, { headers: NO_STORE });
    const ids = await dropDeletedFavorites(found.db, found.member.id, cleanFavoriteIds(found.member.favoriteProductIds));
    return Response.json({ ok: true, member: true, ids }, { headers: NO_STORE });
  } catch (error) {
    console.error("[club/favorites] read failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}

/** POST { action: "add" | "remove", id } or { action: "merge", ids } (the device's favourites at sign-in). */
export async function POST(request: NextRequest) {
  const change = parseFavoritesChange(await request.json().catch(() => null));
  if (!change) return Response.json({ ok: false, code: "INVALID" }, { status: 400, headers: NO_STORE });
  try {
    const found = await sessionMember(request);
    if (!found) return Response.json({ ok: false, code: "NOT_MEMBER" }, { status: 401, headers: NO_STORE });
    const limited = await consumeRateLimit(found.db, { key: rateLimitKey(["club-favorites", found.member.id]), ...LIMIT });
    if (!limited.ok) return Response.json({ ok: false, code: "RATE_LIMITED" }, { status: 429, headers: NO_STORE });
    const changed = await changeMemberFavorites(found.db, found.member.id, change);
    // Merging the device's favourites: products deleted since they were marked are dropped too.
    const ids = change.action === "merge" ? await dropDeletedFavorites(found.db, found.member.id, changed) : changed;
    return Response.json({ ok: true, ids }, { headers: NO_STORE });
  } catch (error) {
    console.error("[club/favorites] change failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
}
