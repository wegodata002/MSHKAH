"use client";

import { useSyncExternalStore } from "react";
import { findTable } from "@/lib/fulfillment/availability";
import type { DineInTable, FulfillmentSettings } from "@/lib/fulfillment/settings";

/**
 * The table whose QR code was scanned on this device (/t/<tableId>), kept for 3 hours. Only then is
 * "At the table" offered at checkout, so nobody orders to a table from home. Kept after an order too,
 * so the same table can order again.
 */
const STORAGE_KEY = "mishkat-table";
export const SCANNED_TABLE_TTL_MS = 3 * 60 * 60 * 1000;

export type ScannedTable = { tableId: string; savedAt: number };

let cache: ScannedTable | null | undefined;
const listeners = new Set<() => void>();

export function parseScannedTable(raw: unknown, now = Date.now()): ScannedTable | null {
  if (!raw || typeof raw !== "object") return null;
  const { tableId, savedAt } = raw as Partial<ScannedTable>;
  if (typeof tableId !== "string" || !/^(inside|outside)-\d{1,2}$/.test(tableId)) return null;
  if (typeof savedAt !== "number" || now - savedAt >= SCANNED_TABLE_TTL_MS || savedAt > now + 60_000) return null;
  return { tableId, savedAt };
}

function read(): ScannedTable | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return parseScannedTable(raw ? JSON.parse(raw) : null);
  } catch {
    return null;
  }
}

function getSnapshot(): ScannedTable | null {
  if (cache === undefined) cache = read();
  // Expired while the page was open.
  if (cache && Date.now() - cache.savedAt >= SCANNED_TABLE_TTL_MS) cache = null;
  return cache;
}

function emit() {
  listeners.forEach((l) => l());
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

function write(next: ScannedTable | null) {
  cache = next;
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked: kept for this visit only.
  }
  emit();
}

/** After scanning a table QR, or choosing another table at checkout ("Not your table? Change"). */
export function rememberTable(tableId: string) {
  write({ tableId, savedAt: Date.now() });
}

export function forgetTable() {
  write(null);
}

export function useScannedTable(): ScannedTable | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/** The scanned table if it is still one of the tables saved in the settings (renumbered → gone). */
export function scannedTableIn(settings: FulfillmentSettings | null | undefined, scanned: ScannedTable | null): DineInTable | null {
  if (!settings || !scanned) return null;
  return findTable(settings, scanned.tableId);
}
