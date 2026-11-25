import { normalizeOrderStatus, toStoredOrderStatus } from "@/lib/orders/status";
import type { DineInTable } from "@/lib/fulfillment/settings";

/**
 * Waiter screen logic (pure): today's table orders as the waiter sees them, each table's state,
 * and what "Served" / "Paid" change on an order.
 */

export type WaiterStage = "cancelled" | "in_kitchen" | "ready" | "served";

export type WaiterOrder = {
  id: string;
  orderNumber: string;
  tableId: string;
  customerName: string;
  items: { name: string; quantity: number; extras: string[] }[];
  notes: string;
  total: number;
  stage: WaiterStage;
  paid: boolean;
  /** How it was paid, when paid: online (card on the site), cash, card. */
  paidWith: "online" | "cash" | "card" | null;
  servedBy: string | null;
  servedAt: string | null;
  paidBy: string | null;
  createdAt: string;
};

/** The order fields the waiter logic reads (timestamps as ISO strings). */
export type WaiterOrderInput = {
  id: string;
  orderNumber?: string;
  orderType?: string;
  status?: string;
  tableId?: string;
  customerName?: string;
  customerFullName?: string;
  items?: { productName?: string; quantity?: number; modifiers?: { optionName?: string; quantity?: number }[] }[];
  notes?: string;
  total?: number;
  paymentMethod?: string;
  paymentProvider?: string;
  paymentStatus?: string;
  paidVia?: string;
  paidBy?: string;
  servedBy?: string;
  readyAt?: string | null;
  deliveredAt?: string | null;
  createdAt?: string;
};

function isCardOnline(order: Pick<WaiterOrderInput, "paymentMethod" | "paymentProvider">): boolean {
  const method = (order.paymentMethod || "").toLowerCase();
  return order.paymentProvider === "HYP" || method === "card";
}

export function waiterStage(order: Pick<WaiterOrderInput, "status">): WaiterStage {
  const status = normalizeOrderStatus(order.status);
  if (status === "cancelled") return "cancelled";
  if (status === "delivered") return "served";
  if (status === "ready") return "ready";
  return "in_kitchen";
}

export function toWaiterOrder(order: WaiterOrderInput): WaiterOrder {
  const paid = (order.paymentStatus ?? "pending") === "paid";
  return {
    id: order.id,
    orderNumber: order.orderNumber ?? "",
    tableId: order.tableId ?? "",
    customerName: (order.customerFullName || order.customerName || "").trim(),
    items: (order.items ?? []).map((item) => ({
      name: item.productName ?? "",
      quantity: item.quantity ?? 1,
      extras: (item.modifiers ?? []).map((m) => ((m.quantity ?? 1) > 1 ? `${m.optionName} ×${m.quantity}` : m.optionName ?? "")),
    })),
    notes: (order.notes || "").trim(),
    total: order.total ?? 0,
    stage: waiterStage(order),
    paid,
    paidWith: !paid
      ? null
      : order.paidVia === "waiter_card" || order.paidVia === "courier_card"
        ? "card"
        : order.paidVia
          ? "cash"
          : isCardOnline(order)
            ? "online"
            : "cash",
    servedBy: order.servedBy?.trim() || null,
    servedAt: order.deliveredAt ?? null,
    paidBy: paid ? order.paidBy?.trim() || null : null,
    createdAt: order.createdAt ?? "",
  };
}

/** Still needs the waiter: not cancelled and not (served and paid). */
export function isOpenAtTable(order: Pick<WaiterOrder, "stage" | "paid">): boolean {
  return order.stage !== "cancelled" && !(order.stage === "served" && order.paid);
}

export type TableState = "ready" | "in_kitchen" | "to_pay" | "free";

export type TableSummary = {
  table: DineInTable;
  state: TableState;
  readyCount: number;
  openOrders: WaiterOrder[];
  cancelledOrders: WaiterOrder[];
  toPay: number;
};

/** One table: its open orders (oldest first), today's cancelled ones, and what needs attention first. */
export function summarizeTable(table: DineInTable, orders: WaiterOrder[]): TableSummary {
  const mine = orders.filter((o) => o.tableId === table.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const openOrders = mine.filter(isOpenAtTable);
  const cancelledOrders = mine.filter((o) => o.stage === "cancelled");
  const readyCount = openOrders.filter((o) => o.stage === "ready").length;
  const toPay = Math.round(openOrders.filter((o) => !o.paid).reduce((sum, o) => sum + o.total, 0) * 100) / 100;
  const state: TableState =
    readyCount > 0 ? "ready" : openOrders.some((o) => o.stage === "in_kitchen") ? "in_kitchen" : toPay > 0 ? "to_pay" : "free";
  return { table, state, readyCount, openOrders, cancelledOrders, toPay };
}

// ---- actions ----

export type PaidWith = "cash" | "card";
/** Field values the store writes; `now` stands for the server time stamp. */
export type WaiterPatch = Record<string, string | "now">;

export type WaiterDecision =
  | { ok: true; patch: WaiterPatch; paid: boolean }
  | { ok: false; code: "NOT_TABLE_ORDER" | "CANCELLED" | "ALREADY_SERVED" | "ALREADY_PAID" | "PAID_ONLINE" };

/** "Served": status served (an order still in the kitchen is marked ready too), with who and when. */
export function decideServed(order: WaiterOrderInput, actor: string): WaiterDecision {
  if (order.orderType !== "dine_in") return { ok: false, code: "NOT_TABLE_ORDER" };
  const stage = waiterStage(order);
  if (stage === "cancelled") return { ok: false, code: "CANCELLED" };
  if (stage === "served") return { ok: false, code: "ALREADY_SERVED" };
  const patch: WaiterPatch = { status: toStoredOrderStatus("delivered"), deliveredAt: "now", completedAt: "now", servedBy: actor };
  if (!order.readyAt) patch.readyAt = "now";
  return { ok: true, patch, paid: false };
}

/** "Paid": cash or card at the table, with who and when (club points follow). */
export function decidePaid(order: WaiterOrderInput, paidWith: PaidWith, actor: string): WaiterDecision {
  if (order.orderType !== "dine_in") return { ok: false, code: "NOT_TABLE_ORDER" };
  if (waiterStage(order) === "cancelled") return { ok: false, code: "CANCELLED" };
  if ((order.paymentStatus ?? "pending") === "paid") return { ok: false, code: "ALREADY_PAID" };
  if (isCardOnline(order)) return { ok: false, code: "PAID_ONLINE" };
  return {
    ok: true,
    patch: { paymentStatus: "paid", paidAt: "now", paidBy: actor, paidVia: paidWith === "card" ? "waiter_card" : "waiter_cash" },
    paid: true,
  };
}

/** Who did it, as saved on the order: "רנא", or "רנא · טאבלט בר" from the fixed tablet. */
export function actorLabel(waiterName: string, deviceName?: string | null): string {
  return deviceName ? `${waiterName} · ${deviceName}` : waiterName;
}
