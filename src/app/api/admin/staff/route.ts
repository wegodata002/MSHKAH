import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { parseStaffAdminRequest } from "@/lib/staff/admin-input";
import { createStaff, listStaff, setStaffPin, updateStaff } from "@/lib/staff/admin/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin "Staff" page (Admin only): POST { action: "list" | "create" | "update" | "set-pin", … }.
 * The code is only ever received here to be hashed; it is never stored or sent back.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const parsed = parseStaffAdminRequest(await request.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: "VALIDATION", code: parsed.error }, { status: 400 });

  try {
    const db = getAdminDb();
    const actor = auth.email || auth.uid;
    const req = parsed.request;
    if (req.action === "list") return Response.json({ ok: true, staff: await listStaff(db) });
    const result =
      req.action === "create"
        ? await createStaff(db, { ...req, actor })
        : req.action === "update"
          ? await updateStaff(db, { ...req, actor })
          : await setStaffPin(db, { ...req, actor });
    if (!result.ok) return Response.json({ error: result.code, code: result.code }, { status: result.code === "NOT_FOUND" ? 404 : 409 });
    return Response.json({ ok: true, member: result.member });
  } catch (error) {
    console.error("[admin/staff] failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "UNAVAILABLE", code: "UNAVAILABLE" }, { status: 500 });
  }
}
