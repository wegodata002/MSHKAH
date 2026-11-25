import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { STAFF_COOKIE_NAME, staffCookieOptions } from "@/lib/staff/session";
import { DEVICE_COOKIE_NAME, deviceCookieOptions } from "@/lib/staff/device";
import { readStaffMember } from "@/lib/staff/admin/store";
import { readStaffDevice } from "@/lib/staff/admin/devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Who is signed in to /staff: a staff member with a personal code ({ member }), or else a fixed cafe
 * tablet ({ device }); 401 when neither. An ended sign-in also clears its cookie.
 */
export async function GET(request: NextRequest) {
  const memberCookie = request.cookies.get(STAFF_COOKIE_NAME)?.value;
  const deviceCookie = request.cookies.get(DEVICE_COOKIE_NAME)?.value;
  if (!memberCookie && !deviceCookie) return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  try {
    const db = getAdminDb();
    const member = memberCookie ? await readStaffMember(db, memberCookie) : null;
    if (member) {
      return NextResponse.json(
        { ok: true, member: { name: member.name, role: member.role, worksToday: member.worksToday } },
        { headers: NO_STORE }
      );
    }
    const device = deviceCookie ? await readStaffDevice(db, deviceCookie) : null;
    const response = device
      ? NextResponse.json({ ok: true, device: { name: device.name } }, { headers: NO_STORE })
      : NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
    if (memberCookie) response.cookies.set({ ...staffCookieOptions(0), value: "" });
    if (deviceCookie && !device) response.cookies.set({ ...deviceCookieOptions(0), value: "" });
    return response;
  } catch (error) {
    console.error("[staff/me] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
