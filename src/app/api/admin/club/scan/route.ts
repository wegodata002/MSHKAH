import { NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { findMemberForScan, scanSummary } from "@/lib/loyalty/admin/coffee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Staff scan screen: find a member by the scanned card link (signed) or a typed member number.
 * Answers only the name, member number and a masked email (no points, no full email).
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { qr?: string; memberNumber?: string; memberId?: string } | null;
  try {
    const db = getAdminDb();
    let memberId = typeof body?.memberId === "string" ? body.memberId : "";
    if (!memberId) {
      const member = await findMemberForScan(db, {
        qr: typeof body?.qr === "string" ? body.qr.slice(0, 500) : undefined,
        memberNumber: typeof body?.memberNumber === "string" ? body.memberNumber.slice(0, 40) : undefined,
      });
      if (!member) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });
      memberId = member.id;
    }
    const summary = await scanSummary(db, memberId, auth, new Date());
    if (!summary) return Response.json({ ok: false, reason: "not_found" }, { status: 404 });
    return Response.json({ ok: true, summary });
  } catch (error) {
    console.error("[loyalty] scan failed", { message: error instanceof Error ? error.message : String(error) });
    return Response.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
