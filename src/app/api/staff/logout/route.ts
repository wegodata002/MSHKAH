import { NextResponse } from "next/server";
import { staffCookieOptions } from "@/lib/staff/session";

export const runtime = "nodejs";

/** Staff sign-out: clears the login cookie. */
export async function POST() {
  const response = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  response.cookies.set({ ...staffCookieOptions(0), value: "" });
  return response;
}
