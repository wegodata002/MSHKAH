import { normalizeIsraeliPhone } from "@/lib/customers/phone";
import { normalizeOrderStatus } from "@/lib/orders/status";

/**
 * Store coupons (Admin → Coupons), e.g. MISHKAT10. Kept in `storeCoupons/{CODE}` (server only: no
 * browser access) and checked on the server only — the cart asks /api/coupons/check, the order route
 * checks again and prices the order, and a card charge uses the discount the server saved then.
 * Personal club codes (MK-XXXX-XXXX) are a different thing and are not handled here.
 *
 * MISHKAT10 is built in: it works from here until the admin first saves it; from then on the record
 * always wins (disabled or deleted stays off — deleting leaves a "deleted" marker).
 */
export type CouponType = "percent" | "fixed";
export type CouponAudience = "all" | "members";
export type CouponLimit = "once" | "unlimited";
export type CouponName = { he: string; ar: string; en: string };

export type StoreCoupon = {
  code: string;
  name: CouponName;
  type: CouponType;
  /** Percent (1–90) or shekels. */
  value: number;
  /** "YYYY-MM-DD": valid through the end of that day (Israel time); null = no end. */
  expiresOn: string | null;
  audience: CouponAudience;
  /** Products before the discount, in shekels; 0 = none. */
  minOrder: number;
  limit: CouponLimit;
  active: boolean;
  /** Built-in coupon shown from the code (no record yet). */
  builtin?: boolean;
};

/** Stored record (adds the deleted marker and who/when). */
export type StoreCouponDoc = StoreCoupon & {
  deleted?: boolean;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
};

export const BUILTIN_COUPONS: Readonly<Record<string, StoreCoupon>> = {
  MISHKAT10: {
    code: "MISHKAT10",
    name: { he: "10% הנחה", ar: "خصم 10%", en: "10% off" },
    type: "percent",
    value: 10,
    expiresOn: null,
    audience: "all",
    minOrder: 0,
    limit: "unlimited",
    active: true,
    builtin: true,
  },
};

export const COUPON_CODE = /^[A-Z0-9]{4,20}$/;

/** The coupon's name in the page's language (Hebrew when that language is left empty). */
export function couponDisplayName(name: CouponName | null | undefined, locale: "he" | "ar" | "en"): string {
  if (!name) return "";
  return (name[locale] || name.he || "").trim();
}

export function normalizeStoreCode(code: unknown): string {
  return typeof code === "string" ? code.trim().toUpperCase() : "";
}

/** The coupon as it works now: the record if there is one (even disabled or deleted), else the built-in. */
export function resolveStoreCoupon(code: string, doc: StoreCouponDoc | null | undefined): StoreCoupon | null {
  if (doc) return doc.deleted ? null : { ...doc, builtin: undefined };
  return BUILTIN_COUPONS[code] ?? null;
}

export type CouponStatus = "active" | "expired" | "disabled";

/** "2026-11-26" in Asia/Jerusalem. */
export function israelDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function couponStatus(coupon: Pick<StoreCoupon, "active" | "expiresOn">, now: Date): CouponStatus {
  if (!coupon.active) return "disabled";
  if (coupon.expiresOn && coupon.expiresOn < israelDate(now)) return "expired";
  return "active";
}

export type CouponRefusal = "invalid" | "expired" | "members_only" | "already_used" | "min_order" | "too_large";

/** Everything that does not need the order's sum: exists and active, date, who may use it, once per customer. */
export function checkStoreCoupon(
  coupon: StoreCoupon | null,
  ctx: { now: Date; isMember: boolean; customerUses: number }
): { ok: true; coupon: StoreCoupon } | { ok: false; reason: CouponRefusal } {
  if (!coupon) return { ok: false, reason: "invalid" };
  const status = couponStatus(coupon, ctx.now);
  if (status === "disabled") return { ok: false, reason: "invalid" };
  if (status === "expired") return { ok: false, reason: "expired" };
  if (coupon.audience === "members" && !ctx.isMember) return { ok: false, reason: "members_only" };
  if (coupon.limit === "once" && ctx.customerUses > 0) return { ok: false, reason: "already_used" };
  return { ok: true, coupon };
}

const money = (n: number) => Math.round(n * 100) / 100;

/** The discount on the products (never the delivery fee): minimum order, and never the whole order or more. */
export function storeCouponDiscount(
  subtotal: number,
  coupon: Pick<StoreCoupon, "type" | "value" | "minOrder">
): { ok: true; discount: number } | { ok: false; reason: "min_order" | "too_large"; minOrder?: number } {
  if (coupon.minOrder > 0 && subtotal < coupon.minOrder) return { ok: false, reason: "min_order", minOrder: coupon.minOrder };
  const discount = coupon.type === "percent" ? money((subtotal * coupon.value) / 100) : money(coupon.value);
  if (discount <= 0) return { ok: false, reason: "too_large" };
  if (discount >= subtotal) return { ok: false, reason: "too_large" };
  return { ok: true, discount };
}

/** An order counts as a use unless it was cancelled or is a card order never paid (as in "My orders"). */
export function isCountedCouponUse(order: { status?: unknown; paymentMethod?: unknown; paymentProvider?: unknown; paymentStatus?: unknown; pricedBy?: unknown }): boolean {
  if (order.pricedBy !== "server") return false; // only orders the server priced (not written directly)
  if (normalizeOrderStatus(order.status) === "cancelled") return false;
  const card = order.paymentProvider === "HYP" || String(order.paymentMethod ?? "").toLowerCase() === "card";
  const payment = String(order.paymentStatus ?? "pending");
  return !(card && (payment === "pending" || payment === "failed"));
}

/** Same customer: the club member, or the same phone however it was typed (058-…, 058…, +972…). */
export function isSameCustomer(
  order: { loyalty?: { memberId?: unknown } | null; customerPhone?: unknown },
  who: { memberId?: string | null; phone?: string | null }
): boolean {
  if (who.memberId && order.loyalty?.memberId === who.memberId) return true;
  const phone = who.phone ? normalizeIsraeliPhone(who.phone) : null;
  return !!phone && normalizeIsraeliPhone(String(order.customerPhone ?? "")) === phone;
}

// ---- admin input ----

export type CouponInput = Omit<StoreCoupon, "builtin">;
export type CouponInputError = "CODE" | "NAME" | "VALUE" | "EXPIRES" | "MIN_ORDER";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Admin form → a coupon, or the first problem. */
export function parseCouponInput(raw: unknown): { ok: true; coupon: CouponInput } | { ok: false; error: CouponInputError } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const code = normalizeStoreCode(r.code);
  if (!COUPON_CODE.test(code)) return { ok: false, error: "CODE" };
  const n = (r.name && typeof r.name === "object" ? r.name : {}) as Record<string, unknown>;
  const name = { he: text(n.he, 80), ar: text(n.ar, 80), en: text(n.en, 80) };
  if (!name.he) return { ok: false, error: "NAME" };
  const type: CouponType = r.type === "fixed" ? "fixed" : "percent";
  const value = Number(r.value);
  const valueOk = type === "percent" ? Number.isInteger(value) && value >= 1 && value <= 90 : Number.isFinite(value) && value > 0 && value <= 1000 && money(value) === value;
  if (!valueOk) return { ok: false, error: "VALUE" };
  const expiresOn = r.expiresOn === null || r.expiresOn === "" || r.expiresOn === undefined ? null : String(r.expiresOn);
  if (expiresOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return { ok: false, error: "EXPIRES" };
  const minOrder = r.minOrder === "" || r.minOrder === undefined || r.minOrder === null ? 0 : Number(r.minOrder);
  if (!Number.isFinite(minOrder) || minOrder < 0 || minOrder > 10000) return { ok: false, error: "MIN_ORDER" };
  return {
    ok: true,
    coupon: {
      code,
      name,
      type,
      value,
      expiresOn,
      audience: r.audience === "members" ? "members" : "all",
      minOrder: money(minOrder),
      limit: r.limit === "once" ? "once" : "unlimited",
      active: r.active !== false,
    },
  };
}
