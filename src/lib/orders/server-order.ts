import { z } from "zod";
import { couponRate, normalizeCouponCode } from "@/lib/orders/coupons";
import { normalizeCustomerEmail } from "@/lib/orders/customer-email";
import { collectKitchenNotes } from "@/lib/product-builder/engine";
import {
  acceptedPickupTime,
  deliveryAvailability,
  formatLocalTime,
  pickupAvailability,
  quoteDelivery,
} from "@/lib/fulfillment/availability";
import { zoneName, type FulfillmentSettings } from "@/lib/fulfillment/settings";
import type { OpeningHours } from "@/lib/settings/opening-hours";
import type { SelectedModifier } from "@/types/modifiers";

/**
 * Builds a storefront order on the server (POST /api/orders/create).
 * Pure: no Firebase, no clock — products, settings and "now" are passed in.
 *
 * Prices come from the catalog, the coupon from its code, the delivery fee from the
 * chosen area in the settings. Add-on prices (priceDelta) are taken as sent, exactly
 * like the card-payment check today; checking them against the database is a separate step.
 */

const MAX_ITEMS = 60;
const MAX_QUANTITY = 99;

const modifierSchema = z.object({
  groupId: z.string().min(1).max(200),
  groupName: z.string().max(200),
  optionId: z.string().min(1).max(200),
  optionName: z.string().max(200),
  priceDelta: z.number().finite().min(-10000).max(10000),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  kitchenNote: z.string().max(300).optional(),
});

export const createOrderRequestSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().trim().min(1).max(200),
        quantity: z.number().int().min(1).max(MAX_QUANTITY),
        modifiers: z.array(modifierSchema).max(40).optional(),
        notes: z.string().max(500).optional(),
      })
    )
    .min(1)
    .max(MAX_ITEMS),
  customer: z.object({
    id: z.string().trim().max(200).optional(),
    name: z.string().trim().min(1).max(120),
    phone: z.string().trim().min(1).max(40),
    email: z.string().trim().max(200).optional(),
  }),
  /** Order notes as composed by the checkout (customer note, phone line, fulfillment line). */
  notes: z.string().max(2000).optional(),
  locale: z.enum(["he", "ar", "en"]).optional(),
  couponCode: z.string().max(40).optional(),
  /** Where the money is collected. */
  payment: z.enum(["online", "counter", "courier", "table"]),
  fulfillment: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("pickup"),
      /** "HH:MM" chosen pickup time; omitted = as soon as possible (pickup times arrive in PR 4). */
      pickupTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
    }),
    z.object({
      type: z.literal("delivery"),
      zoneId: z.string().trim().min(1).max(100),
      address: z.string().trim().min(1).max(300),
    }),
    z.object({
      type: z.literal("dine_in"),
      tableId: z.string().trim().min(1).max(100),
    }),
  ]),
});

export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;
export type FulfillmentType = CreateOrderRequest["fulfillment"]["type"];
export type PaymentCollection = CreateOrderRequest["payment"];

/** Which payment collections each order type accepts. */
export const ALLOWED_PAYMENTS: Record<FulfillmentType, readonly PaymentCollection[]> = {
  pickup: ["online", "counter"],
  delivery: ["online", "courier"],
  dine_in: ["table"],
};

/** The catalog fields the server needs, read with the Admin SDK. */
export type CatalogProduct = {
  price: unknown;
  nameHe?: unknown;
  nameAr?: unknown;
  nameEn?: unknown;
  available?: unknown;
  active?: unknown;
  isTestProduct?: unknown;
};

export type OrderBuildError =
  | { code: "PRODUCT_NOT_FOUND"; productIds: string[] }
  | { code: "PRODUCT_UNAVAILABLE"; productNames: string[] }
  | { code: "INVALID_PRICE" }
  | { code: "PAYMENT_NOT_ALLOWED" }
  | { code: "PICKUP_CLOSED"; reason: "disabled" | "closed"; nextAt: string | null }
  | { code: "PICKUP_TIME_UNAVAILABLE" }
  | { code: "DELIVERY_UNAVAILABLE"; reason: "disabled" | "no_zones" | "closed"; nextAt: string | null }
  | { code: "UNKNOWN_ZONE" }
  | { code: "BELOW_MINIMUM"; minOrder: number }
  | { code: "DINE_IN_UNAVAILABLE" }
  | { code: "COUPON_INVALID"; reason: "login_required" | "invalid" | "used" | "expired" };

/** The order document without timestamps (the route adds createdAt / receivedAt). */
export type ServerOrderDraft = {
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerFullName: string;
  customerPhone: string;
  customerEmail?: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    price: number;
    basePrice: number;
    modifiers?: SelectedModifier[];
    notes?: string;
    kitchenNotes?: string[];
  }>;
  status: "pending";
  subtotal: number;
  discount: number;
  couponCode?: string;
  delivery: number;
  total: number;
  paymentMethod: "cash" | "card";
  paymentStatus: "pending";
  paymentCollection: PaymentCollection;
  orderType: "pickup" | "delivery";
  pickupTime?: string;
  deliveryAddress?: string;
  deliveryZoneId?: string;
  deliveryZoneName?: string;
  notes: string;
  isTestOrder?: true;
  locale?: "he" | "ar" | "en";
  pricedBy: "server";
  /** Club member identified from the club session on the server (points go to this member). */
  loyalty?: { memberId: string };
};

export const TEST_ORDER_NOTE = "TEST — HYP payment verification. Do not include in sales reports.";
export const GUEST_CUSTOMER_ID = "guest-checkout";

export function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Same format as the browser used: MC-<year>-<8 chars>. */
export function generateOrderNumber(now: Date, random: () => number = Math.random): string {
  const tail = `${now.getTime().toString(36)}${random().toString(36).slice(2, 6)}`.toUpperCase();
  return `MC-${now.getFullYear()}-${tail.slice(-8)}`;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Same fallbacks as getLocalizedName on the storefront. */
export function catalogProductName(product: CatalogProduct, locale: "he" | "ar" | "en" | undefined): string {
  const he = str(product.nameHe);
  const ar = str(product.nameAr);
  const en = str(product.nameEn);
  if (locale === "ar") return ar || he || en;
  if (locale === "en") return en || he;
  if (locale === "he") return he || en;
  return he || en;
}

/** Unavailable = switched off in the catalog (`available: false` or `active: false`). */
export function isProductOrderable(product: CatalogProduct): boolean {
  return product.available !== false && product.active !== false;
}

export function buildServerOrder(
  request: CreateOrderRequest,
  ctx: {
    products: ReadonlyMap<string, CatalogProduct | undefined>;
    fulfillment: FulfillmentSettings;
    openingHours: OpeningHours;
    now: Date;
    orderNumber: string;
    /** Rate (0–1) of a personal club code the server already checked; codes from the fixed table otherwise. */
    personalCouponRate?: number;
  }
): { ok: true; order: ServerOrderDraft } | { ok: false; error: OrderBuildError } {
  const locale = request.locale;
  const fulfillment = request.fulfillment;

  if (!ALLOWED_PAYMENTS[fulfillment.type].includes(request.payment)) {
    return { ok: false, error: { code: "PAYMENT_NOT_ALLOWED" } };
  }

  // Products: all must exist and be orderable.
  const missing = [...new Set(request.items.map((i) => i.productId).filter((id) => !ctx.products.get(id)))];
  if (missing.length > 0) return { ok: false, error: { code: "PRODUCT_NOT_FOUND", productIds: missing } };
  const unavailable = [
    ...new Set(
      request.items
        .map((i) => ctx.products.get(i.productId)!)
        .filter((p) => !isProductOrderable(p))
        .map((p) => catalogProductName(p, locale))
    ),
  ];
  if (unavailable.length > 0) return { ok: false, error: { code: "PRODUCT_UNAVAILABLE", productNames: unavailable } };

  const items: ServerOrderDraft["items"] = [];
  let subtotal = 0;
  let isTest = false;
  for (const line of request.items) {
    const product = ctx.products.get(line.productId)!;
    const base = Number(product.price);
    if (!Number.isFinite(base) || base < 0) return { ok: false, error: { code: "INVALID_PRICE" } };
    const modifiers: SelectedModifier[] = (line.modifiers ?? []).map((m) => {
      const mod: SelectedModifier = {
        groupId: m.groupId,
        groupName: m.groupName,
        optionId: m.optionId,
        optionName: m.optionName,
        priceDelta: m.priceDelta,
        quantity: m.quantity,
      };
      const note = m.kitchenNote?.trim();
      if (note) mod.kitchenNote = note;
      return mod;
    });
    const extras = modifiers.reduce((sum, m) => sum + m.priceDelta * m.quantity, 0);
    const unit = money(base + extras);
    if (unit < 0) return { ok: false, error: { code: "INVALID_PRICE" } };

    const item: ServerOrderDraft["items"][number] = {
      productId: line.productId,
      productName: catalogProductName(product, locale),
      quantity: line.quantity,
      price: unit,
      basePrice: base,
    };
    if (modifiers.length > 0) item.modifiers = modifiers;
    const note = line.notes?.trim();
    if (note) item.notes = note;
    const kitchenNotes = collectKitchenNotes(modifiers);
    if (kitchenNotes.length > 0) item.kitchenNotes = kitchenNotes;
    items.push(item);

    subtotal += unit * line.quantity;
    if (product.isTestProduct === true) isTest = true;
  }
  subtotal = money(subtotal);

  const couponCode = normalizeCouponCode(request.couponCode);
  const rate = ctx.personalCouponRate !== undefined ? ctx.personalCouponRate : couponRate(couponCode);
  const discount = money(subtotal * rate);

  // Order type.
  let delivery = 0;
  const typeFields: Partial<ServerOrderDraft> = {};
  if (fulfillment.type === "pickup") {
    // A chosen time is accepted if it was on the list a few minutes ago and has not passed.
    // Without a time (an older cached checkout), the earliest time today is used.
    if (fulfillment.pickupTime) {
      if (!acceptedPickupTime(ctx.openingHours, ctx.fulfillment.pickup, ctx.now, fulfillment.pickupTime)) {
        const pickup = pickupAvailability(ctx.openingHours, ctx.fulfillment.pickup, ctx.now);
        return pickup.available
          ? { ok: false, error: { code: "PICKUP_TIME_UNAVAILABLE" } }
          : { ok: false, error: { code: "PICKUP_CLOSED", reason: pickup.reason, nextAt: pickup.nextAt?.toISOString() ?? null } };
      }
      typeFields.pickupTime = fulfillment.pickupTime;
    } else {
      const pickup = pickupAvailability(ctx.openingHours, ctx.fulfillment.pickup, ctx.now);
      if (!pickup.available) {
        return { ok: false, error: { code: "PICKUP_CLOSED", reason: pickup.reason, nextAt: pickup.nextAt?.toISOString() ?? null } };
      }
      typeFields.pickupTime = formatLocalTime(pickup.slots[0]!);
    }
  } else if (fulfillment.type === "delivery") {
    const availability = deliveryAvailability(ctx.fulfillment, ctx.openingHours, ctx.now);
    if (!availability.available) {
      return {
        ok: false,
        error: {
          code: "DELIVERY_UNAVAILABLE",
          reason: availability.reason,
          nextAt: availability.nextAt ? availability.nextAt.toISOString() : null,
        },
      };
    }
    // The minimum applies to the products before the coupon.
    const quote = quoteDelivery(ctx.fulfillment, fulfillment.zoneId, subtotal);
    if (!quote.ok) {
      return quote.reason === "unknown_zone"
        ? { ok: false, error: { code: "UNKNOWN_ZONE" } }
        : { ok: false, error: { code: "BELOW_MINIMUM", minOrder: quote.minOrder } };
    }
    delivery = money(quote.fee);
    typeFields.deliveryAddress = fulfillment.address.trim();
    typeFields.deliveryZoneId = quote.zone.id;
    typeFields.deliveryZoneName = zoneName(quote.zone, locale ?? "he");
  } else {
    // Dine-in orders are accepted from PR 11 (table QR, waiter screen, print / email labels).
    return { ok: false, error: { code: "DINE_IN_UNAVAILABLE" } };
  }

  const total = Math.max(money(subtotal - discount + delivery), 0.01);
  const name = request.customer.name.trim();
  const email = normalizeCustomerEmail(request.customer.email);
  const notes = [isTest ? TEST_ORDER_NOTE : "", request.notes?.trim() ?? ""].filter(Boolean).join("\n");

  const order: ServerOrderDraft = {
    orderNumber: ctx.orderNumber,
    customerId: request.customer.id?.trim() || GUEST_CUSTOMER_ID,
    customerName: name,
    customerFullName: name,
    customerPhone: request.customer.phone.trim(),
    items,
    status: "pending",
    subtotal,
    discount,
    delivery,
    total,
    paymentMethod: request.payment === "online" ? "card" : "cash",
    paymentStatus: "pending",
    paymentCollection: request.payment,
    orderType: fulfillment.type,
    notes,
    pricedBy: "server",
    ...typeFields,
  };
  if (email) order.customerEmail = email;
  if (couponCode && rate > 0) order.couponCode = couponCode;
  if (isTest) order.isTestOrder = true;
  if (locale) order.locale = locale;
  return { ok: true, order };
}
