import { cookies } from "next/headers";
import { CLUB_COOKIE_NAME } from "@/lib/loyalty/session";
import { clubHintCookie } from "@/lib/loyalty/club-hint";

export const runtime = "nodejs";

export async function POST() {
  const jar = await cookies();
  jar.set({
    name: CLUB_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  jar.set(clubHintCookie(0));
  return Response.json({ ok: true });
}
