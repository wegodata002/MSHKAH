import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { STAFF_COOKIE_NAME } from "@/lib/staff/session";
import { readStaffMember } from "@/lib/staff/admin/store";
import { setCourierShift } from "@/lib/couriers/admin/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** Courier "Started my shift" / "Finished my shift": POST { action: "start" | "end" }. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const on = body?.action === "start" ? true : body?.action === "end" ? false : null;
  if (on === null) return NextResponse.json({ ok: false, code: "INVALID" }, { status: 400, headers: NO_STORE });
  try {
    const db = getAdminDb();
    const member = await readStaffMember(db, request.cookies.get(STAFF_COOKIE_NAME)?.value);
    if (!member || member.role !== "courier") return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
    const result = await setCourierShift(db, { courierId: member.id, on });
    if (!result.ok) {
      return NextResponse.json(result.code === "OPEN_DELIVERIES" ? { ok: false, code: result.code, open: result.open } : { ok: false, code: result.code }, {
        status: result.code === "OPEN_DELIVERIES" ? 409 : 404,
        headers: NO_STORE,
      });
    }
    return NextResponse.json({ ok: true, worksToday: result.worksToday }, { headers: NO_STORE });
  } catch (error) {
    console.error("[staff/shift] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
