import { normalizeOrderStatus, type OperationalOrderStatus } from "@/lib/orders/status";
import type { Order, PaymentStatus } from "@/types";

/**
 * What the customer's order-tracking page may see. Built on the server from the order and nothing
 * else is sent: no phone, email, address, courier, internal notes or alerts.
 */
export type TrackingOrderType = "pickup" | "delivery" | "dine_in";

export type OrderTrackingView = {
  orderNumber: string;
  orderType: TrackingOrderType;
  status: OperationalOrderStatus;
  createdAt: string;
  times: {
    received: string | null;
    preparing: string | null;
    ready: string | null;
    outForDelivery: string | null;
    delivered: string | null;
    cancelled: string | null;
  };
  pickupTime: string | null;
  deliveryZoneName: string | null;
  tableId: string | null;
  items: { name: string; quantity: number; extras: string[]; total: number }[];
  subtotal: number | null;
  discount: number | null;
  /** Club points paid with, in ₪ (null = none). */
  points: number | null;
  delivery: number | null;
  total: number;
  payment: "cash" | "card" | "other";
  paymentStatus: PaymentStatus;
};

export type TrackingStepKey = "received" | "preparing" | "ready" | "out_for_delivery" | "delivered";
export type TrackingStepState = "done" | "current" | "todo";
export type TrackingStep = { key: TrackingStepKey; state: TrackingStepState; at: string | null };

type OrderForTracking = Order & { outForDeliveryAt?: string | null; tableId?: string | null };

function orderTypeOf(raw: unknown): TrackingOrderType {
  return raw === "delivery" ? "delivery" : raw === "dine_in" ? "dine_in" : "pickup";
}

function paymentOf(order: Pick<Order, "paymentMethod" | "paymentProvider">): OrderTrackingView["payment"] {
  const method = (order.paymentMethod || "").toLowerCase();
  if (order.paymentProvider === "HYP" || method === "card" || method === "credit") return "card";
  if (method === "cash") return "cash";
  return "other";
}

function money(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildTrackingView(order: OrderForTracking): OrderTrackingView {
  return {
    orderNumber: order.orderNumber,
    orderType: orderTypeOf(order.orderType),
    status: normalizeOrderStatus(order.status),
    createdAt: order.createdAt,
    times: {
      received: order.receivedAt ?? order.createdAt ?? null,
      preparing: order.preparationStartedAt ?? null,
      ready: order.readyAt ?? null,
      outForDelivery: order.outForDeliveryAt ?? null,
      delivered: order.deliveredAt ?? order.completedAt ?? null,
      cancelled: order.cancelledAt ?? null,
    },
    pickupTime: order.pickupTime || null,
    deliveryZoneName: order.deliveryZoneName || null,
    tableId: order.tableId || null,
    items: (order.items ?? []).map((item) => ({
      name: item.productName,
      quantity: item.quantity,
      extras: (item.modifiers ?? []).map((m) => (m.quantity > 1 ? `${m.optionName} ×${m.quantity}` : m.optionName)),
      total: Math.round(item.price * item.quantity * 100) / 100,
    })),
    subtotal: money(order.subtotal),
    discount: money(order.discount),
    points: money(order.pointsDiscount),
    delivery: money(order.delivery),
    total: order.total,
    payment: paymentOf(order),
    paymentStatus: order.paymentStatus ?? "pending",
  };
}

/** The steps the customer sees, by order type. */
export function trackingStepKeys(orderType: TrackingOrderType): TrackingStepKey[] {
  return orderType === "delivery"
    ? ["received", "preparing", "ready", "out_for_delivery", "delivered"]
    : ["received", "preparing", "ready", "delivered"];
}

/**
 * Where the order is now. Delivery: "out for delivery" is a time stamp on a ready order (set by the
 * manager, later also by the courier), not a status of its own. Cancelled orders have no steps.
 */
export function trackingSteps(view: OrderTrackingView): TrackingStep[] {
  const keys = trackingStepKeys(view.orderType);
  if (view.status === "cancelled") return [];

  let current: TrackingStepKey | null;
  if (view.status === "delivered") current = null; // all done
  else if (view.status === "ready") current = view.orderType === "delivery" && view.times.outForDelivery ? "out_for_delivery" : "ready";
  else current = view.status;

  const currentIndex = current ? keys.indexOf(current) : keys.length;
  const at: Record<TrackingStepKey, string | null> = {
    received: view.times.received,
    preparing: view.times.preparing,
    ready: view.times.ready,
    out_for_delivery: view.times.outForDelivery,
    delivered: view.times.delivered,
  };
  return keys.map((key, index) => ({
    key,
    state: index < currentIndex ? "done" : index === currentIndex ? "current" : "todo",
    at: index <= currentIndex ? at[key] : null,
  }));
}

/** The headline state shown at the top of the tracking page. */
export type TrackingHeadline =
  | "received"
  | "preparing"
  | "ready_pickup"
  | "ready_delivery"
  | "ready_table"
  | "out_for_delivery"
  | "picked_up"
  | "delivered"
  | "served"
  | "cancelled";

export function trackingHeadline(view: OrderTrackingView): TrackingHeadline {
  switch (view.status) {
    case "cancelled":
      return "cancelled";
    case "delivered":
      return view.orderType === "delivery" ? "delivered" : view.orderType === "dine_in" ? "served" : "picked_up";
    case "ready":
      if (view.orderType === "delivery") return view.times.outForDelivery ? "out_for_delivery" : "ready_delivery";
      return view.orderType === "dine_in" ? "ready_table" : "ready_pickup";
    default:
      return view.status;
  }
}

/** Card orders not paid yet (payment page left halfway): say so on the tracking page. */
export function awaitingCardPayment(view: OrderTrackingView): boolean {
  return view.payment === "card" && view.paymentStatus !== "paid" && view.status !== "cancelled";
}

/** Still moving (the page keeps checking for updates); finished orders stop polling. */
export function isTrackingActive(view: OrderTrackingView): boolean {
  return view.status !== "delivered" && view.status !== "cancelled";
}
