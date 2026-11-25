import { phoneKey } from "@/lib/customers/identity";

/**
 * "Find my order" from another device: order number + the full phone number given in the order.
 * The same answer for "no such order" and "wrong phone", so neither can be probed; attempts are
 * limited per network address and per order number.
 */
export const LOOKUP_LIMITS = {
  perIp: { windowSeconds: 15 * 60, limit: 10 },
  perOrder: { windowSeconds: 15 * 60, limit: 5 },
} as const;

export type TrackingLookupDeps = {
  rateLimit: (key: string, windowSeconds: number, limit: number) => Promise<boolean>;
  findOrdersByNumber: (orderNumber: string) => Promise<{ id: string; customerPhone?: string | null }[]>;
  createToken: (orderId: string) => string;
};

export type TrackingLookupResult =
  | { status: 200; body: { ok: true; token: string } }
  | { status: 400 | 404 | 429; body: { ok: false; code: "INVALID" | "NOT_FOUND" | "RATE_LIMITED" } };

/** "#mc-2026-ab12cd34 " → "MC-2026-AB12CD34". */
export function normalizeOrderNumber(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/^#/, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

export async function handleTrackingLookup(
  body: unknown,
  ip: string,
  deps: TrackingLookupDeps
): Promise<TrackingLookupResult> {
  const input = (body && typeof body === "object" ? body : {}) as { orderNumber?: unknown; phone?: unknown };
  const orderNumber = normalizeOrderNumber(input.orderNumber);
  const phone = phoneKey(typeof input.phone === "string" ? input.phone : "");
  if (!/^[A-Z0-9-]{4,40}$/.test(orderNumber) || phone.length < 9 || phone.length > 12) {
    return { status: 400, body: { ok: false, code: "INVALID" } };
  }

  const ipOk = await deps.rateLimit(`track-lookup|ip|${ip || "unknown"}`, LOOKUP_LIMITS.perIp.windowSeconds, LOOKUP_LIMITS.perIp.limit);
  const orderOk = ipOk
    ? await deps.rateLimit(`track-lookup|order|${orderNumber}`, LOOKUP_LIMITS.perOrder.windowSeconds, LOOKUP_LIMITS.perOrder.limit)
    : false;
  if (!ipOk || !orderOk) return { status: 429, body: { ok: false, code: "RATE_LIMITED" } };

  const orders = await deps.findOrdersByNumber(orderNumber);
  const match = orders.find((order) => phoneKey(order.customerPhone) === phone);
  if (!match) return { status: 404, body: { ok: false, code: "NOT_FOUND" } };
  return { status: 200, body: { ok: true, token: deps.createToken(match.id) } };
}
