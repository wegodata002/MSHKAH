import { createHmac, timingSafeEqual } from "node:crypto";
import { clubSecret } from "@/lib/loyalty/session";

/**
 * Staff login cookie: `v1.<staffId>.<sessionVersion>.<expiresMs>.<signature>`, valid 12 hours.
 * Signed with the server secret (own prefix, so it can never pass as a club cookie or a tracking
 * link). On every request the server also checks the member is still active and the version still
 * matches, so changing the code or disabling a member ends their login at once.
 */
export const STAFF_COOKIE_NAME = "mkh_staff";
export const STAFF_SESSION_TTL_SECONDS = 12 * 60 * 60;

const PREFIX = "staff-session:v1:";

function sign(payload: string): string {
  return createHmac("sha256", clubSecret()).update(`${PREFIX}${payload}`).digest("base64url");
}

export function signStaffSession(input: { staffId: string; sessionVersion: number; now?: number }): {
  value: string;
  maxAgeSeconds: number;
} {
  const exp = (input.now ?? Date.now()) + STAFF_SESSION_TTL_SECONDS * 1000;
  const payload = `v1.${input.staffId}.${input.sessionVersion}.${exp}`;
  return { value: `${payload}.${sign(payload)}`, maxAgeSeconds: STAFF_SESSION_TTL_SECONDS };
}

export function readStaffSession(
  value: string | null | undefined,
  now: number = Date.now()
): { staffId: string; sessionVersion: number } | null {
  const match = /^v1\.([A-Za-z0-9]{8,64})\.(\d{1,9})\.(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(String(value ?? ""));
  if (!match) return null;
  const [, staffId, version, exp, signature] = match;
  const expected = Buffer.from(sign(`v1.${staffId}.${version}.${exp}`));
  const given = Buffer.from(signature!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(exp) <= now) return null;
  return { staffId: staffId!, sessionVersion: Number(version) };
}

export function staffCookieOptions(maxAgeSeconds: number) {
  return {
    name: STAFF_COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
