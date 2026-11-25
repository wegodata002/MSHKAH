"use client";

import { useSyncExternalStore } from "react";
import { MY_ORDERS_KEEP_MS, MY_ORDERS_MAX } from "@/lib/orders/my-orders-limits";

/**
 * Orders placed (or found) on this device, for "My orders" in the bottom bar. Kept in this browser only
 * (localStorage) for 90 days, up to 60 orders; holds the tracking link token, never personal details.
 */
export type MyOrderEntry = { token: string; orderNumber: string; savedAt: number };

const STORAGE_KEY = "mishkat-my-orders";
export { MY_ORDERS_KEEP_MS };
const MAX_ENTRIES = MY_ORDERS_MAX;
const EMPTY: readonly MyOrderEntry[] = [];

let cache: readonly MyOrderEntry[] | null = null;
const listeners = new Set<() => void>();

/** Newest first, older than 90 days dropped, one entry per order. */
export function pruneMyOrders(entries: unknown, now = Date.now()): MyOrderEntry[] {
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  return entries
    .filter(
      (e): e is MyOrderEntry =>
        !!e &&
        typeof e === "object" &&
        typeof (e as MyOrderEntry).token === "string" &&
        typeof (e as MyOrderEntry).orderNumber === "string" &&
        typeof (e as MyOrderEntry).savedAt === "number"
    )
    .filter((e) => now - e.savedAt < MY_ORDERS_KEEP_MS)
    .sort((a, b) => b.savedAt - a.savedAt)
    .filter((e) => (seen.has(e.token) ? false : (seen.add(e.token), true)))
    .slice(0, MAX_ENTRIES);
}

function read(): readonly MyOrderEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return pruneMyOrders(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

function getSnapshot() {
  if (!cache) cache = read();
  return cache;
}

function emit() {
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  cache = read();
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** Remember an order on this device (after ordering, or after finding it by number + phone). */
export function rememberMyOrder(entry: { token: string; orderNumber: string }) {
  if (typeof window === "undefined" || !entry.token || !entry.orderNumber) return;
  const next = pruneMyOrders([{ ...entry, savedAt: Date.now() }, ...getSnapshot().filter((e) => e.token !== entry.token)]);
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the list just stays for this visit.
  }
  emit();
}

export function useMyOrders(): readonly MyOrderEntry[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}
