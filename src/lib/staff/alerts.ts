/**
 * New-work alerts on the staff screens (pure parts): what is new since the last check, and the tab
 * title badge. The browser side (sound, vibration, title) is in `features/staff/use-work-alerts.ts`.
 */

/** "(2) MISHKAT" while there is unseen new work; the plain title otherwise. */
export function titleWithBadge(base: string, count: number): string {
  const clean = base.replace(/^\(\d+\)\s*/, "");
  return count > 0 ? `(${count}) ${clean}` : clean;
}

/** Courier: deliveries assigned since the last check that still need them (not delivered / cancelled). */
export function newCourierWork(
  previousIds: ReadonlySet<string> | null,
  list: readonly { id: string; stage: string }[]
): string[] {
  if (!previousIds) return []; // first load: nothing is "new"
  return list.filter((d) => !previousIds.has(d.id) && d.stage !== "delivered" && d.stage !== "cancelled").map((d) => d.id);
}

export type WaiterAlertOrder = { id: string; orderNumber: string; tableId: string; stage: string };

/**
 * Waiter: a new order at a table (from a guest or another waiter; not one this screen just sent),
 * and an order that became ready to serve.
 */
export function newWaiterWork(
  previous: ReadonlyMap<string, string> | null,
  orders: readonly WaiterAlertOrder[],
  sentHere: ReadonlySet<string> = new Set()
): { newOrders: WaiterAlertOrder[]; nowReady: WaiterAlertOrder[] } {
  if (!previous) return { newOrders: [], nowReady: [] }; // first load
  const newOrders = orders.filter((o) => !previous.has(o.id) && o.stage !== "cancelled" && o.stage !== "served" && !sentHere.has(o.orderNumber));
  const nowReady = orders.filter((o) => o.stage === "ready" && previous.has(o.id) && previous.get(o.id) !== "ready");
  // A new order that is already ready counts once, as new.
  return { newOrders, nowReady };
}
