"use client";

import { useEffect, useState } from "react";
import { useMyOrders, type MyOrderEntry } from "@/lib/orders/my-orders";
import { isTrackingActive, type OrderTrackingView } from "@/lib/orders/tracking-view";
import { hasClubHint } from "@/lib/loyalty/club-hint";

/**
 * The orders on this device with their current status, loaded in one call (/api/orders/track/batch).
 * Shared by the menu counter, the bottom bar and "My orders": one request per 30 seconds at most.
 * A signed-in club member also gets the orders of their account from every device (/api/club/orders),
 * merged with this device's list (one entry per order).
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

// ---- the club account's orders (signed-in member) ----

export type AccountOrder = { token: string; orderNumber: string; view: OrderTrackingView };
/** Kept for this tab only, so moving between pages does not ask the server each time. */
export const CLUB_ORDERS_SESSION_KEY = "mishkat-club-orders";
const ACCOUNT_FRESH_MS = 60_000;
let account: { member: boolean; orders: AccountOrder[]; at: number } | null = null;
let accountInflight: Promise<void> | null = null;

function readAccountSession(): typeof account {
  try {
    const raw = window.sessionStorage.getItem(CLUB_ORDERS_SESSION_KEY);
    const v = raw ? (JSON.parse(raw) as { orders?: AccountOrder[]; at?: number }) : null;
    return v && Array.isArray(v.orders) && typeof v.at === "number" ? { member: true, orders: v.orders, at: v.at } : null;
  } catch {
    return null;
  }
}

function loadAccount(force = false): Promise<void> {
  if (!hasClubHint()) {
    if (account?.member !== false) {
      account = { member: false, orders: [], at: Date.now() };
      listeners.forEach((l) => l());
    }
    return Promise.resolve();
  }
  if (!account) account = readAccountSession();
  if (!force && account && Date.now() - account.at < ACCOUNT_FRESH_MS) return Promise.resolve();
  if (accountInflight) return accountInflight;
  accountInflight = fetch("/api/club/orders", { cache: "no-store" })
    .then((res) => (res.ok ? (res.json() as Promise<{ ok?: boolean; member?: boolean; orders?: AccountOrder[] }>) : null))
    .then((data) => {
      if (!data?.ok) {
        // Server not reachable: keep what was shown; a first visit falls back to the device list.
        if (!account) account = { member: true, orders: [], at: Date.now() };
        return;
      }
      account = { member: !!data.member, orders: data.member ? data.orders ?? [] : [], at: Date.now() };
      try {
        if (account.member) window.sessionStorage.setItem(CLUB_ORDERS_SESSION_KEY, JSON.stringify({ orders: account.orders, at: account.at }));
        else window.sessionStorage.removeItem(CLUB_ORDERS_SESSION_KEY);
      } catch {
        // not kept for the tab
      }
    })
    .catch(() => {
      if (!account) account = { member: true, orders: [], at: Date.now() };
    })
    .finally(() => {
      accountInflight = null;
      listeners.forEach((l) => l());
    });
  return accountInflight;
}

/** Sign-out: forget the account's orders kept for this tab. */
export function forgetClubOrders(): void {
  account = null;
  try {
    window.sessionStorage.removeItem(CLUB_ORDERS_SESSION_KEY);
  } catch {
    // nothing kept
  }
}

/**
 * The account's orders and this device's orders together: one entry per order (the tracking link is
 * the same for the same order), newest first. Pure.
 */
export function mergeAccountOrders(accountOrders: readonly AccountOrder[], device: readonly MyOrderItem[]): MyOrderItem[] {
  const fromAccount: MyOrderItem[] = accountOrders.map((o) => ({
    entry: { token: o.token, orderNumber: o.orderNumber, savedAt: Date.parse(o.view.createdAt) || 0 },
    view: o.view,
  }));
  const seen = new Set(fromAccount.map((i) => i.entry.token));
  const when = (i: MyOrderItem) => Date.parse(i.view?.createdAt ?? "") || i.entry.savedAt;
  return [...fromAccount, ...device.filter((i) => !seen.has(i.entry.token))].sort((a, b) => when(b) - when(a));
}

/**
 * The orders to show, newest first, each with its status once loaded (`loaded` false until then).
 * `member`: true = a signed-in club member (account orders included), false = not, null = still checking.
 */
export function useMyOrderItems(): { items: MyOrderItem[]; loaded: boolean; member: boolean | null } {
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

  useEffect(() => {
    void loadAccount();
  }, []);

  const views = cache?.key === key ? cache.views : null;
  const device = entries.map((entry) => ({ entry, view: views?.[entry.token] ?? null }));
  const member = account ? account.member : null;
  return {
    items: account?.member ? mergeAccountOrders(account.orders, device) : device,
    loaded: (!key || !!views) && account !== null,
    member,
  };
}

/** Number of orders still in progress on this device (for the menu and the bottom bar). */
export function useActiveOrderCount(): number {
  const { items } = useMyOrderItems();
  return items.filter(isActiveItem).length;
}
