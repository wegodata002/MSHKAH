import { z } from "zod";
import { couponRate, normalizeCouponCode } from "@/lib/orders/coupons";
import { storeCouponDiscount, type StoreCoupon } from "@/lib/coupons/store-coupons";
import { normalizeCustomerEmail } from "@/lib/orders/customer-email";
import {
  acceptedPickupTime,
  deliveryAvailability,
  dineInAvailability,
  findTable,
  formatLocalTime,
  pickupAvailability,
  quoteDelivery,
} from "@/lib/fulfillment/availability";
import { zoneName, type FulfillmentSettings } from "@/lib/fulfillment/settings";
import { parseLocationLink } from "@/lib/fulfillment/location-link";
import { jerusalemDate } from "@/lib/staff/types";
import type { OpeningHours } from "@/lib/settings/opening-hours";
import type { ProductBuilderConfig, SelectedModifier } from "@/types/modifiers";
import { catalogProductName, isProductOrderable, priceOrderLines, type LinePricingError, type PricedOrderLine } from "@/lib/orders/price-lines";
import { deliveryFeeAfterOffers, type Bundle } from "@/lib/bundles/bundle";

export { catalogProductName, isProductOrderable };

/**
 * Builds a storefront order on the server (POST /api/orders/create).
 * Pure: no Firebase, no clock — products, settings and "now" are passed in.
 *
 * Prices come from the catalog, the coupon from its code, the delivery fee from the
 * chosen area in the settings. Add-on prices, names and kitchen notes come from the
 * product's add-on groups (`modifierConfigs`, same engine as the menu); from the request
 * only which add-on and how many are read.
 */

const MAX_ITEMS = 60;
const MAX_QUANTITY = 99;

/** Only groupId, optionId and quantity are used; names, price and note sent by the browser are ignored. */
const modifierSchema = z.object({
  groupId: z.string().min(1).max(200),
  groupName: z.string().max(200).optional(),
  optionId: z.string().min(1).max(200),
  optionName: z.string().max(200).optional(),
  priceDelta: z.number().finite().optional(),
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
    .max(MAX_ITEMS),
  /**
   * Bundles (Admin → Sales → Bundles): which bundle, how many, and the product chosen for each unit
   * of each part, with its add-ons. The price comes from the bundle in the database.
   */
  bundles: z
    .array(
      z.object({
        bundleId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/),
        quantity: z.number().int().min(1).max(MAX_QUANTITY),
        picks: z
          .array(
            z.object({
              slotId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,128}$/),
              productId: z.string().trim().min(1).max(200),
              modifiers: z.array(modifierSchema).max(40).optional(),
              notes: z.string().max(500).optional(),
            })
          )
          .min(1)
          .max(60),
      })
    )
    .max(MAX_ITEMS)
    .optional(),
  customer: z.object({
    id: z.string().trim().max(200).optional(),
    name: z.string().trim().min(1).max(120),
    /** Required, except for a table order (dine-in: name only). */
    phone: z.string().trim().max(40).default(""),
    email: z.string().trim().max(200).optional(),
  }),
  /** Order notes as composed by the checkout (customer note, phone line, fulfillment line). */
  notes: z.string().max(2000).optional(),
  locale: z.enum(["he", "ar", "en"]).optional(),
  couponCode: z.string().max(40).optional(),
  /** Club points the member asks to pay with (checked on the server; see `@/lib/loyalty/redemption`). */
  redeemPoints: z.number().int().min(0).max(1_000_000).optional(),
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
      /** Optional Waze / Google Maps link from the customer (any other link is refused). */
      locationUrl: z.string().trim().max(1000).optional(),
    }),
    z.object({
      type: z.literal("dine_in"),
      tableId: z.string().trim().min(1).max(100),
    }),
  ]),
}).superRefine((request, ctx) => {
  if (request.items.length + (request.bundles?.length ?? 0) === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["items"], message: "empty order" });
  }
  if (request.fulfillment.type !== "dine_in" && !request.customer.phone) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customer", "phone"], message: "phone required" });
  }
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
  /** For add-on rules that depend on the category. */
  categoryId?: unknown;
  /** Admin → Sales: the sales this product is in (the one on at `now` sets the price). */
  sales?: unknown;
};

export type OrderBuildError =
  /** Products and bundles (see price-lines): not found, off, bad price, add-on refused, bundle over / not filled. */
  | LinePricingError
  | { code: "PAYMENT_NOT_ALLOWED" }
  | { code: "PICKUP_CLOSED"; reason: "disabled" | "closed"; nextAt: string | null }
  | { code: "PICKUP_TIME_UNAVAILABLE" }
  | { code: "DELIVERY_UNAVAILABLE"; reason: "disabled" | "no_zones" | "closed"; nextAt: string | null }
  | { code: "UNKNOWN_ZONE" }
  /** The location link is not a Waze / Google Maps link. */
  | { code: "INVALID_LOCATION_LINK" }
  | { code: "BELOW_MINIMUM"; minOrder: number }
  | { code: "DINE_IN_UNAVAILABLE"; reason: "disabled" | "no_tables" | "closed"; nextAt: string | null }
  | { code: "UNKNOWN_TABLE" }
  /** Paying with points refused: why, and how many this order could take (0 = none). */
  | { code: "POINTS_UNAVAILABLE"; reason: import("@/lib/loyalty/redemption").PointsRefusal; maxPoints: number }
  | {
      code: "COUPON_INVALID";
      reason: "login_required" | "invalid" | "used" | "expired" | "members_only" | "already_used" | "min_order" | "too_large"
        /** The order has only bundles that coupons don't apply to. */
        | "bundles_only";
      /** min_order: the coupon's minimum (products before the discount). */
      minOrder?: number;
    };

/** The order document without timestamps (the route adds createdAt / receivedAt). */
export type ServerOrderDraft = {
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerFullName: string;
  customerPhone: string;
  customerEmail?: string;
  /** Lines priced on the server (see price-lines): products on their own and the products of each bundle. */
  items: PricedOrderLine[];
  status: "pending";
  subtotal: number;
  discount: number;
  couponCode?: string;
  /** Club points paid with (after the coupon), and their value in ₪; `total` is already after them. */
  pointsRedeemed?: number;
  pointsDiscount?: number;
  delivery: number;
  /** Delivery made free by a sale or a bundle in the order: the area's fee it would have been. */
  freeDelivery?: { regularFee: number };
  total: number;
  paymentMethod: "cash" | "card";
  paymentStatus: "pending";
  paymentCollection: PaymentCollection;
  orderType: "pickup" | "delivery" | "dine_in";
  pickupTime?: string;
  /** Dine-in: the table from the settings (id as in its QR link, plus area and number as they were). */
  tableId?: string;
  tableArea?: "inside" | "outside";
  tableNumber?: number;
  /** Dine-in: "YYYY-MM-DD" (Jerusalem) of the order, for the waiter screen. */
  serviceDate?: string;
  deliveryAddress?: string;
  /** The customer's Waze / Google Maps link (checked), for the courier's navigation button. */
  deliveryLocationUrl?: string;
  deliveryZoneId?: string;
  deliveryZoneName?: string;
  notes: string;
  isTestOrder?: true;
  locale?: "he" | "ar" | "en";
  pricedBy: "server";
  /** Club member identified from the club session on the server (points go to this member). */
  loyalty?: { memberId: string };
  /** Entered by a waiter for the guest: who ("רנא" / "רנא · טאבלט בר") and from where. */
  createdBy?: string;
  source?: "waiter";
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

export function buildServerOrder(
  request: CreateOrderRequest,
  ctx: {
    products: ReadonlyMap<string, CatalogProduct | undefined>;
    /** Add-on groups per product id (server-loaded); a product missing here has no add-ons. */
    modifierConfigs: ReadonlyMap<string, ProductBuilderConfig>;
    /** The bundles in the request, from the database (missing = deleted). */
    bundles?: ReadonlyMap<string, Bundle | undefined>;
    fulfillment: FulfillmentSettings;
    openingHours: OpeningHours;
    now: Date;
    orderNumber: string;
    /** Rate (0–1) of a personal club code the server already checked; codes from the fixed table otherwise. */
    personalCouponRate?: number;
    /**
     * A store coupon the order route already checked (Admin → Coupons): its terms. null = no store
     * coupon on this order. Left out (other callers, older tests): the fixed MISHKAT10 table, as before.
     */
    storeCoupon?: Pick<StoreCoupon, "type" | "value" | "minOrder"> | null;
    /**
     * Table orders entered by a waiter only: still accepted this many minutes after closing time
     * (for guests already seated). Customers never get this.
     */
    staffGraceMinutes?: number;
  }
): { ok: true; order: ServerOrderDraft } | { ok: false; error: OrderBuildError } {
  const locale = request.locale;
  const fulfillment = request.fulfillment;

  if (!ALLOWED_PAYMENTS[fulfillment.type].includes(request.payment)) {
    return { ok: false, error: { code: "PAYMENT_NOT_ALLOWED" } };
  }

  // Products and bundles, priced by the same function as the card charge (see price-lines).
  const lines = priceOrderLines(
    { items: request.items, bundles: request.bundles ?? [] },
    { products: ctx.products, modifierConfigs: ctx.modifierConfigs, bundles: ctx.bundles, now: ctx.now, locale }
  );
  if (!lines.ok) return { ok: false, error: lines.error };
  const { items, subtotal, couponBase, isTest } = lines.value;

  const couponCode = normalizeCouponCode(request.couponCode);
  const hasCoupon = ctx.personalCouponRate !== undefined || (ctx.storeCoupon !== undefined ? ctx.storeCoupon !== null : couponRate(couponCode) > 0);
  // A coupon only on what it may take off: bundles without "coupons allowed" are left out.
  if (hasCoupon && couponBase <= 0 && subtotal > 0) return { ok: false, error: { code: "COUPON_INVALID", reason: "bundles_only" } };
  let discount: number;
  let rate: number;
  if (ctx.personalCouponRate !== undefined) {
    rate = ctx.personalCouponRate;
    discount = money(couponBase * rate);
  } else if (ctx.storeCoupon !== undefined) {
    if (ctx.storeCoupon === null) {
      rate = 0;
      discount = 0;
    } else {
      // Minimum order on all the products, before the delivery fee; the discount (and "never the whole
      // of it") on the products it may take off (`couponBase`: bundles without coupons left out).
      const coupon = ctx.storeCoupon;
      const priced =
        coupon.minOrder > 0 && subtotal < coupon.minOrder
          ? ({ ok: false, reason: "min_order", minOrder: coupon.minOrder } as const)
          : storeCouponDiscount(couponBase, { ...coupon, minOrder: 0 });
      if (!priced.ok) return { ok: false, error: { code: "COUPON_INVALID", reason: priced.reason, ...(priced.minOrder ? { minOrder: priced.minOrder } : {}) } };
      discount = priced.discount;
      rate = 1; // a coupon applies: keep its code on the order
    }
  } else {
    rate = couponRate(couponCode);
    discount = money(couponBase * rate);
  }

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
    // Free delivery from a sale or a bundle in the order (from its minimum, on all the products);
    // the area's minimum order above still applies.
    const fee = deliveryFeeAfterOffers(quote.fee, subtotal, lines.value.freeDeliveryFrom);
    delivery = fee.fee;
    if (fee.free && quote.fee > 0) typeFields.freeDelivery = { regularFee: money(quote.fee) };
    typeFields.deliveryAddress = fulfillment.address.trim();
    if (fulfillment.locationUrl?.trim()) {
      const link = parseLocationLink(fulfillment.locationUrl);
      if (!link) return { ok: false, error: { code: "INVALID_LOCATION_LINK" } };
      typeFields.deliveryLocationUrl = link.url;
    }
    typeFields.deliveryZoneId = quote.zone.id;
    typeFields.deliveryZoneName = zoneName(quote.zone, locale ?? "he");
  } else {
    // Dine-in: "Dine-in active" on, a table saved in the settings, and the cafe open now.
    const availability = dineInAvailability(ctx.fulfillment, ctx.openingHours, ctx.now);
    // A waiter may still enter an order up to N minutes after closing: open N minutes ago = closed less than N minutes.
    const grace = ctx.staffGraceMinutes ?? 0;
    const inStaffGrace =
      !availability.available &&
      availability.reason === "closed" &&
      grace > 0 &&
      dineInAvailability(ctx.fulfillment, ctx.openingHours, new Date(ctx.now.getTime() - grace * 60_000)).available;
    if (!availability.available && !inStaffGrace) {
      return {
        ok: false,
        error: {
          code: "DINE_IN_UNAVAILABLE",
          reason: availability.reason,
          nextAt: availability.nextAt ? availability.nextAt.toISOString() : null,
        },
      };
    }
    const table = findTable(ctx.fulfillment, fulfillment.tableId.trim());
    if (!table) return { ok: false, error: { code: "UNKNOWN_TABLE" } };
    typeFields.tableId = table.id;
    typeFields.tableArea = table.area;
    typeFields.tableNumber = table.number;
    // The waiter screen lists today's table orders by this (no extra database index needed).
    typeFields.serviceDate = jerusalemDate(ctx.now);
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
