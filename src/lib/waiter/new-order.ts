import { z } from "zod";
import { normalizeIsraeliPhone } from "@/lib/customers/phone";
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
import type { ProductBuilderConfig } from "@/types/modifiers";
import type { Bundle } from "@/lib/bundles/bundle";
import { requestProductIds } from "@/lib/orders/price-lines";

/**
 * "New order" on the waiter screen: the waiter enters the guest's order at a table. It goes through
 * the same server checks as a guest's order (catalog prices, add-ons from the catalog, product
 * available, table saved, table ordering on, opening hours) and is paid at the end like any table
 * order. Differences: up to 30 minutes after closing time is still accepted, and who entered it is
 * saved (`createdBy`, `source: "waiter"`). No coupon, no club, no tracking link.
 */

/** Minutes after closing time a waiter may still enter an order (guests already seated). */
export const WAITER_GRACE_MINUTES = 30;
/** Per waiter (or fixed tablet): orders per window. */
export const WAITER_ORDER_LIMIT = { windowSeconds: 10 * 60, limit: 60 } as const;

const ID = /^[A-Za-z0-9_-]{1,200}$/;
// Only which add-on and how many: prices and names come from the catalog.
const waiterModifiers = z
  .array(z.object({ groupId: z.string().min(1).max(200), optionId: z.string().min(1).max(200), quantity: z.number().int().min(1).max(99) }))
  .max(40)
  .optional();

const waiterOrderSchema = z.object({
  tableId: z.string().trim().min(1).max(100),
  customerName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(500).optional(),
  locale: z.enum(["he", "ar", "en"]).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().trim().regex(ID),
        quantity: z.number().int().min(1).max(99),
        modifiers: waiterModifiers,
        notes: z.string().trim().max(500).optional(),
      })
    )
    .max(60)
    .default([]),
  /** Bundles (Admin → Sales → Bundles): priced from the bundle in the database, like a guest's order. */
  bundles: z
    .array(
      z.object({
        bundleId: z.string().trim().regex(ID),
        quantity: z.number().int().min(1).max(99),
        picks: z
          .array(z.object({ slotId: z.string().trim().regex(ID), productId: z.string().trim().regex(ID), modifiers: waiterModifiers, notes: z.string().trim().max(500).optional() }))
          .min(1)
          .max(60),
      })
    )
    .max(60)
    .optional(),
});

export type WaiterOrderDeps = {
  now: () => Date;
  /** True while this waiter / tablet is under its limit. */
  rateLimit: () => Promise<boolean>;
  loadProducts: (ids: string[]) => Promise<ReadonlyMap<string, CatalogProduct | undefined>>;
  loadContext: () => Promise<{ fulfillment: FulfillmentSettings; openingHours: OpeningHours }>;
  loadModifierConfigs: (ids: string[]) => Promise<ReadonlyMap<string, ProductBuilderConfig>>;
  /** The bundles asked for, from the database; missing = deleted. */
  loadBundles?: (ids: string[]) => Promise<ReadonlyMap<string, Bundle | undefined>>;
  saveOrder: (draft: ServerOrderDraft) => Promise<string>;
  /** Kitchen print + new-order email, after the order is saved (never fails the order). */
  afterSave: (orderId: string) => Promise<void>;
};

export type WaiterOrderResponse =
  | { status: 200; body: { ok: true; id: string; orderNumber: string; total: number } }
  | { status: 400; body: { ok: false; code: "INVALID" | "INVALID_PHONE" } }
  | { status: 409; body: { ok: false } & OrderBuildError }
  | { status: 429; body: { ok: false; code: "RATE_LIMITED" } };

export async function handleWaiterOrder(body: unknown, actor: string, deps: WaiterOrderDeps): Promise<WaiterOrderResponse> {
  const parsed = waiterOrderSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { ok: false, code: "INVALID" } };
  const input = parsed.data;

  // The phone is optional; one that is given must be a real number.
  const given = input.phone?.trim() ?? "";
  const phone = given ? normalizeIsraeliPhone(given) : "";
  if (phone === null) return { status: 400, body: { ok: false, code: "INVALID_PHONE" } };

  const request = createOrderRequestSchema.safeParse({
    items: input.items,
    ...(input.bundles && input.bundles.length > 0 ? { bundles: input.bundles } : {}),
    customer: { name: input.customerName, phone },
    notes: input.notes || undefined,
    locale: input.locale,
    payment: "table",
    fulfillment: { type: "dine_in", tableId: input.tableId },
  });
  if (!request.success) return { status: 400, body: { ok: false, code: "INVALID" } };

  if (!(await deps.rateLimit())) return { status: 429, body: { ok: false, code: "RATE_LIMITED" } };

  const ids = requestProductIds(request.data.items, request.data.bundles ?? []);
  const bundleIds = [...new Set((request.data.bundles ?? []).map((b) => b.bundleId))];
  const [products, context, modifierConfigs, bundles] = await Promise.all([
    deps.loadProducts(ids),
    deps.loadContext(),
    deps.loadModifierConfigs(ids),
    bundleIds.length > 0 && deps.loadBundles ? deps.loadBundles(bundleIds) : Promise.resolve(new Map<string, Bundle | undefined>()),
  ]);
  const now = deps.now();
  const built = buildServerOrder(request.data, {
    products,
    modifierConfigs,
    bundles,
    fulfillment: context.fulfillment,
    openingHours: context.openingHours,
    now,
    orderNumber: generateOrderNumber(now),
    staffGraceMinutes: WAITER_GRACE_MINUTES,
  });
  if (!built.ok) return { status: 409, body: { ok: false, ...built.error } };

  const order: ServerOrderDraft = { ...built.order, createdBy: actor, source: "waiter" };
  const id = await deps.saveOrder(order);
  await deps.afterSave(id).catch(() => undefined);
  return { status: 200, body: { ok: true, id, orderNumber: order.orderNumber, total: order.total } };
}
