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
import { CouponUnavailableError, isPersonalCouponCode } from "@/lib/loyalty/coupons";
import type { ProductBuilderConfig } from "@/types/modifiers";

/**
 * POST /api/orders/create, without the HTTP and Firebase wiring (injected), so it can be tested
 * with in-memory stand-ins.
 */

export type CreateOrderDeps = {
  now: () => Date;
  loadProducts: (ids: string[]) => Promise<ReadonlyMap<string, CatalogProduct | undefined>>;
  loadContext: () => Promise<{ fulfillment: FulfillmentSettings; openingHours: OpeningHours }>;
  /** The products' add-on groups from the database: add-on prices are taken only from here. */
  loadModifierConfigs: (productIds: string[]) => Promise<ReadonlyMap<string, ProductBuilderConfig>>;
  /** Returns true when under the limit. */
  rateLimit: (key: string, windowSeconds: number, limit: number) => Promise<boolean>;
  saveOrder: (draft: ServerOrderDraft) => Promise<string>;
  /**
   * The club member logged in on this device (from the signed club session), or null.
   * Never trusted from the request body. A failure here must not block the order.
   */
  findClubMember?: () => Promise<{ id: string; email?: string | null; status?: string } | null>;
  /** Personal club code (MK-XXXX-XXXX): can the logged-in member use it now? */
  checkClubCoupon?: (
    code: string,
    member: { id: string; status?: string }
  ) => Promise<
    { ok: true; percent: number; heldBy: string | null } | { ok: false; reason: "invalid" | "used" | "expired" }
  >;
  /** Saves the order and marks the personal code used by it, in one transaction. */
  saveOrderWithCoupon?: (
    draft: ServerOrderDraft,
    coupon: { code: string; memberId: string; heldBy: string | null }
  ) => Promise<string>;
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
  /** Table orders without a phone are limited per table instead. */
  perTable: { windowSeconds: 60 * 60, limit: 20 },
} as const;

function couponRefused(reason: "login_required" | "invalid" | "used" | "expired"): CreateOrderResponse {
  return { status: 409, body: { ok: false, code: "COUPON_INVALID", reason } };
}

export async function handleCreateOrder(
  rawBody: unknown,
  ip: string,
  deps: CreateOrderDeps
): Promise<CreateOrderResponse> {
  const parsed = createOrderRequestSchema.safeParse(rawBody);
  if (!parsed.success) return { status: 400, body: { ok: false, code: "INVALID_REQUEST" } };
  const request = parsed.data;
  const digits = phoneKey(request.customer.phone);
  // A table order may come without a phone (name only); a phone that is given must be valid.
  const phoneOptional = request.fulfillment.type === "dine_in" && digits.length === 0;
  if (!phoneOptional && digits.length < 9) return { status: 400, body: { ok: false, code: "INVALID_REQUEST" } };

  try {
    const { perPhone, perIp, perTable } = ORDER_RATE_LIMITS;
    const phoneOk = phoneOptional
      ? await deps.rateLimit(
          `create-order|table|${request.fulfillment.type === "dine_in" ? request.fulfillment.tableId : ""}`,
          perTable.windowSeconds,
          perTable.limit
        )
      : await deps.rateLimit(`create-order|phone|${digits}`, perPhone.windowSeconds, perPhone.limit);
    const ipOk = !ip || (await deps.rateLimit(`create-order|ip|${ip}`, perIp.windowSeconds, perIp.limit));
    if (!phoneOk || !ipOk) return { status: 429, body: { ok: false, code: "RATE_LIMITED" } };

    const productIds = request.items.map((i) => i.productId);
    const [products, context, modifierConfigs] = await Promise.all([
      deps.loadProducts(productIds),
      deps.loadContext(),
      deps.loadModifierConfigs(productIds),
    ]);
    const now = deps.now();
    // Club member from the signed session (never from the request body).
    const member = deps.findClubMember ? await deps.findClubMember().catch(() => null) : null;

    // A personal club code works only for its owner, logged in to the club on this device.
    const personalCode = isPersonalCouponCode(request.couponCode) ? request.couponCode!.trim().toUpperCase() : null;
    let personal: { percent: number; heldBy: string | null } | null = null;
    if (personalCode) {
      if (!member) return couponRefused("login_required");
      if (!deps.checkClubCoupon || !deps.saveOrderWithCoupon) return couponRefused("invalid");
      const check = await deps.checkClubCoupon(personalCode, member);
      if (!check.ok) return couponRefused(check.reason);
      personal = { percent: check.percent, heldBy: check.heldBy };
    }

    const built = buildServerOrder(request, {
      products,
      modifierConfigs,
      fulfillment: context.fulfillment,
      openingHours: context.openingHours,
      now,
      orderNumber: generateOrderNumber(now),
      personalCouponRate: personal ? personal.percent / 100 : undefined,
    });
    if (!built.ok) return { status: 409, body: { ok: false, ...built.error } };

    // Club member: points by member id (not by email); their saved email, if any, for the
    // payment confirmation. The checkout no longer asks for an email.
    const order: ServerOrderDraft = { ...built.order };
    if (member?.id) {
      order.loyalty = { memberId: member.id };
      const memberEmail = normalizeCustomerEmail(member.email);
      if (memberEmail && !order.customerEmail) order.customerEmail = memberEmail;
    }

    const id =
      personal && personalCode && member && deps.saveOrderWithCoupon
        ? await deps.saveOrderWithCoupon(order, { code: personalCode, memberId: member.id, heldBy: personal.heldBy })
        : await deps.saveOrder(order);
    return { status: 200, body: { ok: true, id, orderNumber: built.order.orderNumber, total: built.order.total } };
  } catch (error) {
    // The code was taken by another order a moment ago: nothing was saved.
    if (error instanceof CouponUnavailableError) return couponRefused(error.reason);
    console.error("[orders/create] failed:", error instanceof Error ? error.message : error);
    return { status: 500, body: { ok: false, code: "ORDER_SAVE_FAILED" } };
  }
}
