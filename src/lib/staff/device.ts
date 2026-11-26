import { createHmac, timingSafeEqual } from "node:crypto";
import { clubSecret } from "@/lib/loyalty/session";
import { WAITER_DEVICE_TTL_SECONDS } from "@/lib/staff/waiter-join";

/**
 * A device signed in to the waiter screen (a waiter's phone or a cafe tablet). It joins by scanning
 * the waiters' QR (see waiter-join.ts) and stays signed in for 90 days; scanning again renews. The
 * admin can disconnect it at any time (the server checks every request). Devices linked earlier with
 * a 6-digit code keep working until their own end date or until disconnected.
 */
export const DEVICE_COOKIE_NAME = "mkh_device";
export const DEVICE_SESSION_TTL_SECONDS = WAITER_DEVICE_TTL_SECONDS;

const PREFIX = "staff-device:v1:";

/** Stored in `staffDevices/{id}` (server only). */
export type StaffDeviceDoc = {
  name: string;
  role: "waiter";
  active: boolean;
  /** Bumped on disconnect: the device's sign-in ends at once. */
  sessionVersion: number;
  createdAt: string;
  createdBy: string;
  expiresAt: string;
  lastSeenAt: string | null;
  /** "qr" = joined with the waiters' QR; missing = linked earlier with a 6-digit code. */
  source?: "qr";
  /** The QR version it joined with ("Replace QR" disconnects older ones). */
  joinVersion?: number;
};

export type StaffDeviceView = {
  id: string;
  name: string;
  active: boolean;
  source: "qr" | "code";
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
};

function sign(payload: string): string {
  return createHmac("sha256", clubSecret()).update(`${PREFIX}${payload}`).digest("base64url");
}

export function signDeviceSession(input: { deviceId: string; sessionVersion: number; now?: number }) {
  const exp = (input.now ?? Date.now()) + DEVICE_SESSION_TTL_SECONDS * 1000;
  const payload = `v1.${input.deviceId}.${input.sessionVersion}.${exp}`;
  return { value: `${payload}.${sign(payload)}`, maxAgeSeconds: DEVICE_SESSION_TTL_SECONDS, expiresAt: new Date(exp).toISOString() };
}

export function readDeviceSession(value: string | null | undefined, now: number = Date.now()): { deviceId: string; sessionVersion: number } | null {
  const match = /^v1\.([A-Za-z0-9]{8,64})\.(\d{1,9})\.(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(String(value ?? ""));
  if (!match) return null;
  const [, deviceId, version, exp, signature] = match;
  const expected = Buffer.from(sign(`v1.${deviceId}.${version}.${exp}`));
  const given = Buffer.from(signature!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (Number(exp) <= now) return null;
  return { deviceId: deviceId!, sessionVersion: Number(version) };
}

export function deviceCookieOptions(maxAgeSeconds: number) {
  return {
    name: DEVICE_COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function toDeviceView(id: string, doc: StaffDeviceDoc): StaffDeviceView {
  return {
    id,
    name: doc.name,
    active: doc.active,
    source: doc.source === "qr" ? "qr" : "code",
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt,
    lastSeenAt: doc.lastSeenAt,
  };
}
