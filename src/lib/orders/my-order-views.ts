"use client";

import { useEffect, useState } from "react";
import { useMyOrders, type MyOrderEntry } from "@/lib/orders/my-orders";
import { isTrackingActive, type OrderTrackingView } from "@/lib/orders/tracking-view";

/**
 * The orders on this device with their current status, loaded in one call (/api/orders/track/batch).
 * Shared by the menu counter, the bottom bar and "My orders": one request per 30 seconds at most.
 */

export type MyOrderTab = "active" | "done";
export type MyOrderType = "all" | "pickup" | "delivery" | "dine_in";
export type MyOrderItem = { entry: MyOrderEntry; view: OrderTrackingView | null };

/** Still moving: received, preparing, ready, on the way. Unknown (link no longer valid) counts as done. */
export function isActiveItem(item: MyOrderItem): boolean {
  return !!item.view && isTrackingActive(item.view);
}

export function splitMyOrders(items: readonly MyOrderItem[]): Record<MyOrderTab, MyOrderItem[]> {
  return { active: items.filter(isActiveItem), done: items.filter((i) => !isActiveItem(i)) };
}

export function countMyOrderTypes(items: readonly MyOrderItem[]): Record<Exclude<MyOrderType, "all">, number> {
  const count = (type: string) => items.filter((i) => i.view?.orderType === type).length;
  return { pickup: count("pickup"), delivery: count("delivery"), dine_in: count("dine_in") };
}

export function filterMyOrderType(items: readonly MyOrderItem[], type: MyOrderType): MyOrderItem[] {
  return type === "all" ? [...items] : items.filter((i) => i.view?.orderType === type);
}

// ---- shared loading (browser) ----

const FRESH_MS = 30_000;
let cache: { key: string; at: number; views: Record<string, OrderTrackingView> } | null = null;
let inflight: { key: string; promise: Promise<Record<string, OrderTrackingView> | null> } | null = null;
const listeners = new Set<() => void>();

function load(tokens: string[], key: string) {
  if (inflight?.key === key) return inflight.promise;
  const promise = fetch("/api/orders/track/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens }),
    cache: "no-store",
  })
    .then((res) => (res.ok ? (res.json() as Promise<{ ok?: boolean; orders?: Record<string, OrderTrackingView> }>) : null))
    .then((data) => {
      if (!data?.ok || !data.orders) return null;
      cache = { key, at: Date.now(), views: data.orders };
      listeners.forEach((l) => l());
      return data.orders;
    })
    .catch(() => null)
    .finally(() => {
      if (inflight?.key === key) inflight = null;
    });
  inflight = { key, promise };
  return promise;
}

/** The orders on this device, newest first, each with its status once loaded (`loaded` false until then). */
export function useMyOrderItems(): { items: MyOrderItem[]; loaded: boolean } {
  const entries = useMyOrders();
  const key = entries.map((e) => e.token).join(",");
  const [, rerender] = useState(0);

  useEffect(() => {
    const listener = () => rerender((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!key) return;
    if (cache?.key === key && Date.now() - cache.at < FRESH_MS) return;
    void load(key.split(","), key);
  }, [key]);

  const views = cache?.key === key ? cache.views : null;
  return {
    items: entries.map((entry) => ({ entry, view: views?.[entry.token] ?? null })),
    loaded: !key || !!views,
  };
}

/** Number of orders still in progress on this device (for the menu and the bottom bar). */
export function useActiveOrderCount(): number {
  const { items } = useMyOrderItems();
  return items.filter(isActiveItem).length;
}
