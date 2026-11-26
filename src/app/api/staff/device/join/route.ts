import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { consumeRateLimit, rateLimitKey } from "@/lib/loyalty/admin/rate-limit";
import { DEVICE_COOKIE_NAME, deviceCookieOptions } from "@/lib/staff/device";
import { joinWaiterDevice } from "@/lib/staff/admin/devices";
import { JOIN_RATE_LIMIT } from "@/lib/staff/waiter-join";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

/**
 * The waiters' QR page posts its secret here: POST { key } → this device is signed in to the
 * waiter screen for 90 days (scanning again renews). Never a GET, so link previews cannot join.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  try {
    const db = getAdminDb();
    const limited = await consumeRateLimit(db, { key: rateLimitKey(["waiter-join", ip]), ...JOIN_RATE_LIMIT });
    if (!limited.ok) return NextResponse.json({ ok: false, code: "BLOCKED" }, { status: 429, headers: NO_STORE });
    const result = await joinWaiterDevice(db, { key: body?.key, deviceCookie: request.cookies.get(DEVICE_COOKIE_NAME)?.value });
    if (!result.ok) return NextResponse.json({ ok: false, code: result.code }, { status: 400, headers: NO_STORE });
    const response = NextResponse.json({ ok: true, renewed: result.renewed, device: { name: result.device.name } }, { headers: NO_STORE });
    response.cookies.set({ ...deviceCookieOptions(result.cookie.maxAgeSeconds), value: result.cookie.value });
    return response;
  } catch (error) {
    console.error("[staff/device/join] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
