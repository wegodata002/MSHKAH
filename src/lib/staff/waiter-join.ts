import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { requireServerSecret } from "@/lib/server-secrets";

/**
 * The waiters' QR: `<store>/staff/join?k=<secret>`, printed and kept in the work area only.
 * Scanning it signs the device in to the waiter screen for 90 days (scanning again renews), with
 * no code and no "who is working now". Actions are recorded under the device's name
 * ("טלפון מלצרית 1").
 *
 * The secret is kept server-side in `staffJoinKeys/waiter` (no browser access; the admin reads it
 * through the admin-only API to download and print it again). "Replace QR" makes a new secret and
 * disconnects every device that joined with an older one.
 */
export const WAITER_JOIN_KEY_DOC = "waiter";
export const WAITER_DEVICE_TTL_SECONDS = 90 * 24 * 60 * 60;
/** 24 random bytes → 32 base64url characters. */
export const JOIN_KEY_PATTERN = /^[A-Za-z0-9_-]{32}$/;
export const JOIN_RATE_LIMIT = { windowSeconds: 15 * 60, limit: 20 } as const;
export const WAITER_DEVICE_NAME_PREFIX = "טלפון מלצרית";

/** Stored in `staffJoinKeys/waiter` (server only). */
export type WaiterJoinKeyDoc = {
  /** Kept so the admin can download and print the same QR again (approved option A). */
  key: string;
  keyHash: string;
  /** 1, 2, 3…: bumped by "Replace QR"; devices remember the version they joined with. */
  version: number;
  createdAt: string;
  createdBy: string;
};

export function newJoinKey(): string {
  return randomBytes(24).toString("base64url");
}

export function joinKeyHash(key: string): string {
  const pepper = requireServerSecret("LOYALTY_TOKEN_PEPPER", "mishkah-dev-pepper");
  return createHmac("sha256", pepper).update(`waiter-join:v1:${key}`).digest("hex");
}

/** Does the scanned secret match the current one? Constant time; a malformed secret never matches. */
export function joinKeyMatches(given: unknown, doc: Pick<WaiterJoinKeyDoc, "keyHash"> | undefined | null): boolean {
  if (!doc || typeof given !== "string" || !JOIN_KEY_PATTERN.test(given)) return false;
  const a = Buffer.from(joinKeyHash(given), "hex");
  const b = Buffer.from(String(doc.keyHash ?? ""), "hex");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** The join link printed in the QR. */
export function waiterJoinUrl(storeOrigin: string, key: string): string {
  return `${storeOrigin.replace(/\/+$/, "")}/staff/join?k=${encodeURIComponent(key)}`;
}

/** "טלפון מלצרית N" with the lowest number not used by a connected device. */
export function nextWaiterDeviceName(connectedNames: readonly string[]): string {
  const used = new Set<number>();
  for (const name of connectedNames) {
    const match = new RegExp(`^${WAITER_DEVICE_NAME_PREFIX} (\\d{1,4})$`).exec(name.trim());
    if (match) used.add(Number(match[1]));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `${WAITER_DEVICE_NAME_PREFIX} ${n}`;
}
