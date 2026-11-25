import { createHmac } from "node:crypto";
import { requireServerSecret } from "@/lib/server-secrets";

/**
 * Staff personal codes: exactly 4 digits. Sign-in is by code alone, so the code has to be unique
 * across staff and is looked up by a keyed hash (HMAC with the server pepper): a copy of the database
 * without the pepper does not reveal any code.
 */
export const PIN_PATTERN = /^\d{4}$/;

export function isValidPinFormat(pin: unknown): pin is string {
  return typeof pin === "string" && PIN_PATTERN.test(pin);
}

/** Codes too easy to guess: one digit four times (0000, 7777) and straight runs (1234, 4321, 0123, 9876). */
export function isWeakPin(pin: string): boolean {
  if (!PIN_PATTERN.test(pin)) return true;
  if (/^(\d)\1{3}$/.test(pin)) return true;
  const digits = pin.split("").map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]!);
  return steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

export function hashPin(pin: string): string {
  const pepper = requireServerSecret("LOYALTY_TOKEN_PEPPER", "mishkah-dev-pepper");
  return createHmac("sha256", pepper).update(`staff-pin:v1:${pin}`).digest("hex");
}
