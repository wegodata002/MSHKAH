import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { clubSecret } from "@/lib/loyalty/session";
import { requireServerSecret } from "@/lib/server-secrets";

/**
 * "Fixed device": a cafe tablet that stays signed in to the waiter screen for 30 days without a
 * personal code. The admin creates a one-time pairing code (6 digits, 10 minutes); typing it on the
 * tablet links the tablet. The admin can disconnect it at any time (the server checks every request).
 */
export const DEVICE_COOKIE_NAME = "mkh_device";
export const DEVICE_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
export const PAIRING_CODE_PATTERN = /^\d{6}$/;

const PREFIX = "staff-device:v1:";

/** Stored in `staffDevices/{id}` (server only). */
export type StaffDeviceDoc = {
  name: string;
  role: "waiter";
  active: boolean;
  /** Bumped on disconnect: the tablet's sign-in ends at once. */
  sessionVersion: number;
  createdAt: string;
  createdBy: string;
  expiresAt: string;
  lastSeenAt: string | null;
};

/** Stored in `staffDevicePairings/{hash of the code}` (server only); one use, 10 minutes. */
export type DevicePairingDoc = {
  deviceName: string;
  createdAt: string;
  createdBy: string;
  expiresAtMs: number;
  used: boolean;
};

export type StaffDeviceView = { id: string; name: string; active: boolean; createdAt: string; expiresAt: string; lastSeenAt: string | null };

export function newPairingCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Pairing codes are kept only as a keyed hash (server pepper). */
export function pairingCodeHash(code: string): string {
  const pepper = requireServerSecret("LOYALTY_TOKEN_PEPPER", "mishkah-dev-pepper");
  return createHmac("sha256", pepper).update(`device-pair:v1:${code}`).digest("hex");
}

export type PairingCheck = { ok: true } | { ok: false; code: "INVALID_CODE" | "EXPIRED" | "USED" };

/** Whether a pairing record can still link a device now. Pure. */
export function checkPairing(doc: DevicePairingDoc | undefined, nowMs: number): PairingCheck {
  if (!doc) return { ok: false, code: "INVALID_CODE" };
  if (doc.used) return { ok: false, code: "USED" };
  if (nowMs >= doc.expiresAtMs) return { ok: false, code: "EXPIRED" };
  return { ok: true };
}

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
  return { id, name: doc.name, active: doc.active, createdAt: doc.createdAt, expiresAt: doc.expiresAt, lastSeenAt: doc.lastSeenAt };
}
