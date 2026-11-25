import { isValidPinFormat } from "@/lib/staff/pin";
import type { StaffRole } from "@/lib/staff/types";

/**
 * Staff sign-in with the personal code alone. Wrong codes are counted per network address:
 * after 5 wrong codes in 15 minutes that address is blocked for the rest of the 15 minutes
 * (no email is sent). A second, wider limit (all addresses together) caps guessing from many
 * addresses at once. A right code clears the count of its address.
 */
export const STAFF_LOGIN_LIMITS = {
  windowSeconds: 15 * 60,
  perIp: 5,
  all: 60,
} as const;

export type StaffLoginDeps = {
  /** Seconds until the address may try again, or null when it may try now. */
  blockedFor: (ip: string) => Promise<number | null>;
  /** Count a wrong code; answers how many tries the address has left. */
  recordFailure: (ip: string) => Promise<number>;
  clearFailures: (ip: string) => Promise<void>;
  findActiveByPinHash: (pinHash: string) => Promise<{ id: string; name: string; role: StaffRole; sessionVersion: number } | null>;
  hashPin: (pin: string) => string;
};

export type StaffLoginResult =
  | { status: 200; body: { ok: true; name: string; role: StaffRole }; session: { staffId: string; sessionVersion: number } }
  | { status: 400; body: { ok: false; code: "INVALID" } }
  | { status: 401; body: { ok: false; code: "WRONG_PIN"; attemptsLeft: number } }
  | { status: 429; body: { ok: false; code: "BLOCKED"; retryAfterSeconds: number } };

export async function handleStaffLogin(body: unknown, ip: string, deps: StaffLoginDeps): Promise<StaffLoginResult> {
  const pin = (body && typeof body === "object" ? (body as { pin?: unknown }).pin : undefined) ?? null;
  if (!isValidPinFormat(pin)) return { status: 400, body: { ok: false, code: "INVALID" } };

  const wait = await deps.blockedFor(ip);
  if (wait !== null) return { status: 429, body: { ok: false, code: "BLOCKED", retryAfterSeconds: wait } };

  // A disabled member's code is answered exactly like a wrong code.
  const member = await deps.findActiveByPinHash(deps.hashPin(pin));
  if (!member) {
    const attemptsLeft = await deps.recordFailure(ip);
    if (attemptsLeft <= 0) {
      return { status: 429, body: { ok: false, code: "BLOCKED", retryAfterSeconds: STAFF_LOGIN_LIMITS.windowSeconds } };
    }
    return { status: 401, body: { ok: false, code: "WRONG_PIN", attemptsLeft } };
  }

  await deps.clearFailures(ip);
  return {
    status: 200,
    body: { ok: true, name: member.name, role: member.role },
    session: { staffId: member.id, sessionVersion: member.sessionVersion },
  };
}
