import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { STAFF_COOKIE_NAME, staffCookieOptions } from "@/lib/staff/session";
import { readStaffMember } from "@/lib/staff/admin/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** The signed-in staff member (name, role), or 401. An ended login also clears its cookie. */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(STAFF_COOKIE_NAME)?.value;
  if (!cookie) return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  try {
    const member = await readStaffMember(getAdminDb(), cookie);
    if (!member) {
      const response = NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
      response.cookies.set({ ...staffCookieOptions(0), value: "" });
      return response;
    }
    return NextResponse.json(
      { ok: true, member: { name: member.name, role: member.role, worksToday: member.worksToday } },
      { headers: NO_STORE }
    );
  } catch (error) {
    console.error("[staff/me] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
