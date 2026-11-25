import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { handleStaffLogin } from "@/lib/staff/login";
import { hashPin } from "@/lib/staff/pin";
import { signStaffSession, staffCookieOptions } from "@/lib/staff/session";
import {
  clearStaffLoginFailures,
  findActiveStaffByPinHash,
  recordStaffLoginFailure,
  staffLoginBlockedFor,
} from "@/lib/staff/admin/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** Staff sign-in with the personal 4-digit code: POST { pin } → login cookie for 12 hours. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  try {
    const db = getAdminDb();
    const result = await handleStaffLogin(body, ip, {
      blockedFor: (address) => staffLoginBlockedFor(db, address),
      recordFailure: (address) => recordStaffLoginFailure(db, address),
      clearFailures: (address) => clearStaffLoginFailures(db, address),
      findActiveByPinHash: (pinHash) => findActiveStaffByPinHash(db, pinHash),
      hashPin,
    });
    const response = NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
    if (result.status === 200) {
      const session = signStaffSession(result.session);
      response.cookies.set({ ...staffCookieOptions(session.maxAgeSeconds), value: session.value });
    }
    return response;
  } catch (error) {
    console.error("[staff/login] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
