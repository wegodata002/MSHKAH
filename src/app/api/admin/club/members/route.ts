import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { clubMemberDetail, clubMemberStats, listClubMembers } from "@/lib/loyalty/admin/member-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store, private" };
const ID = /^[A-Za-z0-9_-]{6,128}$/;

/**
 * Admin → Club → Members (Admin only, read only): POST { action: "list" | "stats" | "detail", … }.
 * Members' names and emails are sent to the admin's screen only.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { action?: unknown; memberIds?: unknown; memberId?: unknown } | null;
  try {
    const db = getAdminDb();
    if (body?.action === "list") return Response.json({ ok: true, ...(await listClubMembers(db)) }, { headers: NO_STORE });
    if (body?.action === "stats") {
      const ids = Array.isArray(body.memberIds) ? body.memberIds.filter((id): id is string => typeof id === "string" && ID.test(id)) : [];
      if (ids.length === 0 || ids.length > 40) return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400, headers: NO_STORE });
      return Response.json({ ok: true, stats: await clubMemberStats(db, ids) }, { headers: NO_STORE });
    }
    if (body?.action === "detail" && typeof body.memberId === "string" && ID.test(body.memberId)) {
      const detail = await clubMemberDetail(db, body.memberId);
      return detail
        ? Response.json({ ok: true, ...detail }, { headers: NO_STORE })
        : Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
    }
    return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400, headers: NO_STORE });
  } catch (error) {
    console.error("[admin/club/members] failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "UNAVAILABLE", code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
