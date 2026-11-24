import { phoneKey } from "@/lib/customers/identity";
import { normalizeCustomerEmail } from "@/lib/orders/customer-email";
import type { FulfillmentSettings } from "@/lib/fulfillment/settings";
import type { OpeningHours } from "@/lib/settings/opening-hours";
import {
  buildServerOrder,
  createOrderRequestSchema,
  generateOrderNumber,
  type CatalogProduct,
  type OrderBuildError,
  type ServerOrderDraft,
} from "@/lib/orders/server-order";

/**
 * POST /api/orders/create, without the HTTP and Firebase wiring (injected), so it can be tested
 * with in-memory stand-ins.
 */

export type CreateOrderDeps = {
  now: () => Date;
  loadProducts: (ids: string[]) => Promise<ReadonlyMap<string, CatalogProduct | undefined>>;
  loadContext: () => Promise<{ fulfillment: FulfillmentSettings; openingHours: OpeningHours }>;
  /** Returns true when under the limit. */
  rateLimit: (key: string, windowSeconds: number, limit: number) => Promise<boolean>;
  saveOrder: (draft: ServerOrderDraft) => Promise<string>;
  /**
   * The club member logged in on this device (from the signed club session), or null.
   * Never trusted from the request body. A failure here must not block the order.
   */
  findClubMember?: () => Promise<{ id: string; email?: string | null } | null>;
};

export type CreateOrderResponse =
  | { status: 200; body: { ok: true; id: string; orderNumber: string; total: number } }
  | { status: 400; body: { ok: false; code: "INVALID_REQUEST" } }
  | { status: 409; body: { ok: false } & OrderBuildError }
  | { status: 429; body: { ok: false; code: "RATE_LIMITED" } }
  | { status: 500; body: { ok: false; code: "ORDER_SAVE_FAILED" } };

export const ORDER_RATE_LIMITS = {
  perPhone: { windowSeconds: 60 * 60, limit: 30 },
  perIp: { windowSeconds: 60 * 60, limit: 100 },
} as const;

export async function handleCreateOrder(
  rawBody: unknown,
  ip: string,
  deps: CreateOrderDeps
): Promise<CreateOrderResponse> {
  const parsed = createOrderRequestSchema.safeParse(rawBody);
  if (!parsed.success) return { status: 400, body: { ok: false, code: "INVALID_REQUEST" } };
  const request = parsed.data;
  const digits = phoneKey(request.customer.phone);
  if (digits.length < 9) return { status: 400, body: { ok: false, code: "INVALID_REQUEST" } };

  try {
    const { perPhone, perIp } = ORDER_RATE_LIMITS;
    const phoneOk = await deps.rateLimit(`create-order|phone|${digits}`, perPhone.windowSeconds, perPhone.limit);
    const ipOk = !ip || (await deps.rateLimit(`create-order|ip|${ip}`, perIp.windowSeconds, perIp.limit));
    if (!phoneOk || !ipOk) return { status: 429, body: { ok: false, code: "RATE_LIMITED" } };

    const [products, context] = await Promise.all([
      deps.loadProducts(request.items.map((i) => i.productId)),
      deps.loadContext(),
    ]);
    const now = deps.now();
    const built = buildServerOrder(request, {
      products,
      fulfillment: context.fulfillment,
      openingHours: context.openingHours,
      now,
      orderNumber: generateOrderNumber(now),
    });
    if (!built.ok) return { status: 409, body: { ok: false, ...built.error } };

    // Club member: points by member id (not by email); their saved email, if any, for the
    // payment confirmation. The checkout no longer asks for an email.
    const member = deps.findClubMember ? await deps.findClubMember().catch(() => null) : null;
    const order: ServerOrderDraft = { ...built.order };
    if (member?.id) {
      order.loyalty = { memberId: member.id };
      const memberEmail = normalizeCustomerEmail(member.email);
      if (memberEmail && !order.customerEmail) order.customerEmail = memberEmail;
    }

    const id = await deps.saveOrder(order);
    return { status: 200, body: { ok: true, id, orderNumber: built.order.orderNumber, total: built.order.total } };
  } catch (error) {
    console.error("[orders/create] failed:", error instanceof Error ? error.message : error);
    return { status: 500, body: { ok: false, code: "ORDER_SAVE_FAILED" } };
  }
}
