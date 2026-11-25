import { createHmac, timingSafeEqual } from "node:crypto";
import { clubSecret } from "@/lib/loyalty/session";

/**
 * Customer order-tracking link: `/orders/<orderId>.<signature>`. The signature is an HMAC of the order
 * id with the server secret, so the link cannot be guessed or changed, nothing is stored in the order
 * (older orders get a link too), and checking it needs no database lookup beyond reading the order.
 */
const PREFIX = "order-track:v1:";
const SIG_LENGTH = 22;
const TOKEN_PATTERN = /^([A-Za-z0-9]{8,64})\.([A-Za-z0-9_-]{22})$/;

function sign(orderId: string): string {
  return createHmac("sha256", clubSecret()).update(`${PREFIX}${orderId}`).digest("base64url").slice(0, SIG_LENGTH);
}

export function createTrackingToken(orderId: string): string {
  return `${orderId}.${sign(orderId)}`;
}

/** The order id inside a valid token; null for anything malformed or with a wrong signature. */
export function readTrackingToken(token: string | null | undefined): string | null {
  const match = TOKEN_PATTERN.exec(String(token ?? "").trim());
  if (!match) return null;
  const [, orderId, signature] = match;
  const expected = Buffer.from(sign(orderId!));
  const given = Buffer.from(signature!);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return orderId!;
}

/**
 * For places that run after the order is already saved or paid (order create answer, card-payment
 * return, confirmation email): a missing secret must never fail those, so the link is just left out.
 */
export function tryCreateTrackingToken(orderId: string): string | null {
  try {
    return createTrackingToken(orderId);
  } catch {
    return null;
  }
}

export function trackingPath(token: string): string {
  return `/orders/${encodeURIComponent(token)}`;
}
