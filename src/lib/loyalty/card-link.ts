import { createHmac, timingSafeEqual } from "node:crypto";
import { clubSecret } from "@/lib/loyalty/session";

/**
 * The member QR: a link `/club/card?c=<memberId>.<signature>`.
 *
 * - Only the server can make a valid one (HMAC), so card numbers cannot be guessed or forged.
 * - The link shows nothing by itself: the /club/card page takes the person scanning to THEIR OWN
 *   card (from their login session), never to the card in the link.
 * - The staff scanning screen (Club 3) reads the same link on the server, staff only.
 */

const SIG_LENGTH = 22;

function signature(memberId: string): string {
  return createHmac("sha256", clubSecret()).update(`card.v1.${memberId}`).digest("base64url").slice(0, SIG_LENGTH);
}

export function signMemberCard(memberId: string): string {
  return `${memberId}.${signature(memberId)}`;
}

/** The member id inside a valid card token (or a full card link), else null. */
export function readMemberCard(tokenOrUrl: string | null | undefined): string | null {
  if (!tokenOrUrl) return null;
  let token = tokenOrUrl.trim();
  if (token.includes("?")) {
    try {
      token = new URL(token, "https://card.local").searchParams.get("c") ?? "";
    } catch {
      return null;
    }
  }
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const memberId = token.slice(0, dot);
  const given = token.slice(dot + 1);
  if (!/^[A-Za-z0-9-]{1,64}$/.test(memberId) || given.length !== SIG_LENGTH) return null;
  const expected = signature(memberId);
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return memberId;
}

export function memberCardPath(token: string): string {
  return `/club/card?c=${encodeURIComponent(token)}`;
}
