import { normalizeOrderStatus, toStoredOrderStatus, type OperationalOrderStatus } from "@/lib/orders/status";
import { parseLocationLink } from "@/lib/fulfillment/location-link";

/**
 * Courier screen logic (pure). What one delivery looks like to its courier, the order of the list
 * ("what to do now"), and what "I'm leaving" / "Delivered" change on the order.
 */

export type CourierStage = "pickup_now" | "on_the_way" | "in_kitchen" | "delivered" | "cancelled";

export type CourierDelivery = {
  id: string;
  orderNumber: string;
  stage: CourierStage;
  customerName: string;
  customerPhone: string;
  address: string;
  /** The customer's Waze / Google Maps link, when one was given (checked again here). */
  locationUrl: string | null;
  zone: string;
  notes: string;
  items: { name: string; quantity: number; extras: string[] }[];
  total: number;
  /** Amount still to collect at the door, or null when already paid. */
  collect: number | null;
  paidWith: "online" | "cash" | "card" | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
};

/** The order fields the courier logic reads (Firestore order, timestamps as ISO strings). */
export type CourierOrderInput = {
  id: string;
  orderNumber?: string;
  status?: string;
  orderType?: string;
  customerName?: string;
  customerFullName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  deliveryLocationUrl?: string;
  deliveryZoneName?: string;
  notes?: string;
  items?: { productName?: string; quantity?: number; modifiers?: { optionName?: string; quantity?: number }[] }[];
  total?: number;
  paymentMethod?: string;
  paymentProvider?: string;
  paymentStatus?: string;
  paidVia?: string;
  isTestOrder?: boolean;
  readyAt?: string | null;
  outForDeliveryAt?: string | null;
  deliveredAt?: string | null;
};

export function isCardOrder(order: Pick<CourierOrderInput, "paymentMethod" | "paymentProvider">): boolean {
  const method = (order.paymentMethod || "").toLowerCase();
  return order.paymentProvider === "HYP" || method === "card" || /card|credit|אשראי/.test(method);
}

/** Cash / pay-on-delivery order not paid yet: the courier collects it. */
export function awaitsPaymentAtDoor(order: CourierOrderInput): boolean {
  return (order.paymentStatus ?? "pending") !== "paid" && !isCardOrder(order);
}

export function courierStage(order: CourierOrderInput): CourierStage {
  const status: OperationalOrderStatus = normalizeOrderStatus(order.status);
  if (status === "cancelled") return "cancelled";
  if (status === "delivered") return "delivered";
  if (order.outForDeliveryAt) return "on_the_way";
  if (status === "ready") return "pickup_now";
  return "in_kitchen";
}

export function toCourierDelivery(order: CourierOrderInput): CourierDelivery {
  const paid = (order.paymentStatus ?? "pending") === "paid";
  return {
    id: order.id,
    orderNumber: order.orderNumber ?? "",
    stage: courierStage(order),
    customerName: (order.customerFullName || order.customerName || "").trim(),
    customerPhone: (order.customerPhone || "").trim(),
    address: (order.deliveryAddress || "").trim(),
    locationUrl: parseLocationLink(order.deliveryLocationUrl)?.url ?? null,
    zone: (order.deliveryZoneName || "").trim(),
    notes: (order.notes || "").trim(),
    items: (order.items ?? []).map((item) => ({
      name: item.productName ?? "",
      quantity: item.quantity ?? 1,
      extras: (item.modifiers ?? []).map((m) => ((m.quantity ?? 1) > 1 ? `${m.optionName} ×${m.quantity}` : m.optionName ?? "")),
    })),
    total: order.total ?? 0,
    collect: awaitsPaymentAtDoor(order) ? order.total ?? 0 : null,
    paidWith: !paid
      ? null
      : order.paidVia === "courier_card"
        ? "card"
        : order.paidVia === "courier_cash" || order.paidVia === "cash_counter"
          ? "cash"
          : isCardOrder(order)
            ? "online"
            : "cash",
    outForDeliveryAt: order.outForDeliveryAt ?? null,
    deliveredAt: order.deliveredAt ?? null,
  };
}

const STAGE_ORDER: Record<CourierStage, number> = { cancelled: 0, pickup_now: 1, on_the_way: 2, in_kitchen: 3, delivered: 4 };

/** What to do now first: cancelled (don't leave!), pick up, on the way, in the kitchen, then done today. */
export function sortCourierDeliveries(list: CourierDelivery[]): CourierDelivery[] {
  return [...list].sort(
    (a, b) =>
      STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] ||
      (b.stage === "delivered" ? (b.deliveredAt ?? "").localeCompare(a.deliveredAt ?? "") : (a.outForDeliveryAt ?? "").localeCompare(b.outForDeliveryAt ?? "")) ||
      a.orderNumber.localeCompare(b.orderNumber)
  );
}

// ---- actions ----

export type CourierAction = "out" | "delivered";
export type PaidWith = "cash" | "card";

/** Field values the store writes; `now` stands for the server time stamp. */
export type CourierPatch = Record<string, string | "now">;

export type CourierActionDecision =
  | { ok: true; patch: CourierPatch; paidAtDoor: PaidWith | null }
  | { ok: false; code: "NOT_DELIVERY" | "CANCELLED" | "ALREADY_DELIVERED" | "PAYMENT_REQUIRED" };

/**
 * "out" (I'm leaving): stamps out-for-delivery; an order still in the kitchen is marked ready too.
 * "delivered": status delivered (and the earlier stamps if missing); an unpaid cash order needs how
 * it was paid (cash / card) and is marked paid by the courier.
 */
export function decideCourierAction(
  order: CourierOrderInput,
  action: CourierAction,
  paidWith: PaidWith | null,
  courierName: string
): CourierActionDecision {
  if (order.orderType !== "delivery") return { ok: false, code: "NOT_DELIVERY" };
  const status = normalizeOrderStatus(order.status);
  if (status === "cancelled") return { ok: false, code: "CANCELLED" };
  if (status === "delivered") return { ok: false, code: "ALREADY_DELIVERED" };

  const patch: CourierPatch = {};
  if (status !== "ready") patch.status = toStoredOrderStatus("ready");
  if (!order.readyAt) patch.readyAt = "now";
  if (!order.outForDeliveryAt) patch.outForDeliveryAt = "now";
  if (action === "out") return { ok: true, patch, paidAtDoor: null };

  const collect = awaitsPaymentAtDoor(order);
  if (collect && paidWith !== "cash" && paidWith !== "card") return { ok: false, code: "PAYMENT_REQUIRED" };
  delete patch.status;
  patch.status = toStoredOrderStatus("delivered");
  patch.deliveredAt = "now";
  patch.completedAt = "now";
  if (collect && paidWith) {
    patch.paymentStatus = "paid";
    patch.paidAt = "now";
    patch.paidBy = courierName;
    patch.paidVia = paidWith === "card" ? "courier_card" : "courier_cash";
  }
  return { ok: true, patch, paidAtDoor: collect ? paidWith : null };
}

// ---- shift ----

/** Deliveries still to do (in the kitchen, to pick up, on the way): the shift can't end while any is open. */
export function openDeliveryCount(list: Pick<CourierDelivery, "stage">[]): number {
  return list.filter((d) => d.stage === "in_kitchen" || d.stage === "pickup_now" || d.stage === "on_the_way").length;
}

// ---- navigation links ----

function destination(delivery: Pick<CourierDelivery, "address" | "zone">): string {
  return [delivery.address, delivery.zone].filter(Boolean).join(", ");
}

/** The customer's own link when it is of this kind (Waze / Google Maps), else none. */
function ownLink(delivery: { locationUrl?: string | null }, kind: "waze" | "google"): string | null {
  const link = parseLocationLink(delivery.locationUrl);
  return link?.kind === kind ? link.url : null;
}

export function wazeUrl(delivery: Pick<CourierDelivery, "address" | "zone"> & { locationUrl?: string | null }): string {
  const own = ownLink(delivery, "waze");
  if (own) return own;
  return `https://waze.com/ul?q=${encodeURIComponent(destination(delivery))}&navigate=yes`;
}

export function googleMapsUrl(delivery: Pick<CourierDelivery, "address" | "zone"> & { locationUrl?: string | null }): string {
  const own = ownLink(delivery, "google");
  if (own) return own;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination(delivery))}`;
}
