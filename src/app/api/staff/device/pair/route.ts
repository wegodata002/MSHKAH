import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { consumeRateLimit, rateLimitKey } from "@/lib/loyalty/admin/rate-limit";
import { deviceCookieOptions, PAIRING_CODE_PATTERN } from "@/lib/staff/device";
import { pairDevice } from "@/lib/staff/admin/devices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** A cafe tablet types the one-time pairing code from the admin: POST { code } → signed in for 30 days. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!PAIRING_CODE_PATTERN.test(code)) return NextResponse.json({ ok: false, code: "INVALID_CODE" }, { status: 400, headers: NO_STORE });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  try {
    const db = getAdminDb();
    const limited = await consumeRateLimit(db, { key: rateLimitKey(["device-pair", ip]), windowSeconds: 15 * 60, limit: 10 });
    if (!limited.ok) return NextResponse.json({ ok: false, code: "BLOCKED" }, { status: 429, headers: NO_STORE });
    const result = await pairDevice(db, { code });
    if (!result.ok) return NextResponse.json({ ok: false, code: result.code }, { status: 400, headers: NO_STORE });
    const response = NextResponse.json({ ok: true, device: { name: result.device.name } }, { headers: NO_STORE });
    response.cookies.set({ ...deviceCookieOptions(result.cookie.maxAgeSeconds), value: result.cookie.value });
    return response;
  } catch (error) {
    console.error("[staff/device/pair] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
