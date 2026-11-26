import { normalizeIsraeliPhone } from "@/lib/customers/phone";
import { parseLocationLink } from "@/lib/fulfillment/location-link";

/**
 * The customer's details from their last order, used to fill the checkout next time.
 *
 * - A club member logged in on this device: kept on the member on the server (saved by the order
 *   route after the order is saved; read back only by the member's own session). The name comes
 *   from the club profile and is never changed by the checkout.
 * - Anyone else: kept on this device (localStorage) for 180 days after the last order.
 *
 * Only empty fields are filled; the order type is never chosen for the customer. The area,
 * address and location link are filled when Delivery is chosen (the area only while it is still
 * in the settings); a table order fills the name only. Pure — the browser and the server share it.
 */
export type CheckoutDetails = {
  name?: string;
  /** Clean "0501234567". */
  phone?: string;
  zoneId?: string;
  address?: string;
  locationUrl?: string;
};

export const SAVED_DETAILS_KEY = "mishkat-checkout-details";
export const SAVED_DETAILS_TTL_MS = 180 * 24 * 60 * 60 * 1000;

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
};

/** Keeps only fields that are well-formed (an old or edited record is cleaned, never trusted). */
export function cleanDetails(raw: unknown): CheckoutDetails {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: CheckoutDetails = {};
  const name = text(r.name, 120);
  if (name) out.name = name;
  const phone = typeof r.phone === "string" ? normalizeIsraeliPhone(r.phone) : null;
  if (phone) out.phone = phone;
  const zoneId = text(r.zoneId, 100);
  if (zoneId) out.zoneId = zoneId;
  const address = text(r.address, 300);
  if (address) out.address = address;
  const link = typeof r.locationUrl === "string" && r.locationUrl.trim() ? parseLocationLink(r.locationUrl) : null;
  if (link) out.locationUrl = link.url;
  return out;
}

/** The details an order leaves behind: address, area and link only from a delivery order. */
export function detailsFromOrder(order: {
  name?: string;
  phone?: string;
  orderType: "pickup" | "delivery" | "dine_in";
  zoneId?: string;
  address?: string;
  locationUrl?: string;
}): CheckoutDetails {
  return cleanDetails({
    name: order.name,
    phone: order.phone,
    ...(order.orderType === "delivery"
      ? { zoneId: order.zoneId, address: order.address, locationUrl: order.locationUrl ?? "" }
      : {}),
  });
}

/**
 * The newer order wins field by field; what it did not carry is kept (a pickup order keeps the
 * last address). A delivery order without a link removes the old link (it belonged to the old
 * address).
 */
export function mergeDetails(previous: CheckoutDetails, next: CheckoutDetails, nextWasDelivery: boolean): CheckoutDetails {
  const merged: CheckoutDetails = { ...previous, ...next };
  if (nextWasDelivery && !next.locationUrl) delete merged.locationUrl;
  return merged;
}

/** A device record, or null when missing, malformed or older than 180 days. */
export function parseSavedDetails(raw: unknown, now = Date.now()): CheckoutDetails | null {
  if (!raw || typeof raw !== "object") return null;
  const savedAt = (raw as { savedAt?: unknown }).savedAt;
  if (typeof savedAt !== "number" || now - savedAt >= SAVED_DETAILS_TTL_MS || savedAt > now + 60_000) return null;
  const details = cleanDetails(raw);
  return Object.keys(details).length ? details : null;
}

export type FillField = keyof CheckoutDetails;

/** Which fields the current order type may fill. */
export function fillableFields(orderType: "pickup" | "delivery" | "dine_in"): FillField[] {
  if (orderType === "dine_in") return ["name"];
  if (orderType === "pickup") return ["name", "phone"];
  return ["name", "phone", "zoneId", "address", "locationUrl"];
}

/**
 * The values to put into still-empty fields, for fields not filled before (`done`).
 * The area only while it is still one of the settings' areas.
 */
export function valuesToFill(
  saved: CheckoutDetails,
  current: Record<FillField, string>,
  orderType: "pickup" | "delivery" | "dine_in",
  zoneIds: readonly string[],
  done: ReadonlySet<FillField>
): { fill: Partial<Record<FillField, string>>; considered: FillField[] } {
  const fill: Partial<Record<FillField, string>> = {};
  const considered: FillField[] = [];
  for (const field of fillableFields(orderType)) {
    if (done.has(field)) continue;
    considered.push(field);
    const value = saved[field];
    if (!value || current[field].trim()) continue;
    if (field === "zoneId" && !zoneIds.includes(value)) continue;
    fill[field] = value;
  }
  return { fill, considered };
}
