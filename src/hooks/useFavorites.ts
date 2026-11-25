"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Favourite products (the heart on a product). Kept in this browser only (localStorage), one shared
 * copy for the whole page: a heart tapped in the product drawer updates the card, the Favourites page
 * and the bottom-bar badge at once, and other open tabs follow through the "storage" event.
 */
const STORAGE_KEY = "mishkat-favorites";
const EMPTY: ReadonlySet<string> = new Set();

let cache: ReadonlySet<string> | null = null;
const listeners = new Set<() => void>();

function readStored(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function getSnapshot(): ReadonlySet<string> {
  if (!cache) cache = readStored();
  return cache;
}

function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY;
}

function emit() {
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  cache = readStored();
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

function save(next: ReadonlySet<string>) {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // Storage full or blocked (private mode): keep the in-page copy.
  }
  emit();
}

export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleFavorite = useCallback((productId: string) => {
    const next = new Set(getSnapshot());
    if (next.has(productId)) next.delete(productId);
    else next.add(productId);
    save(next);
  }, []);

  const isFavorite = useCallback((productId: string) => favorites.has(productId), [favorites]);

  return { favorites, count: favorites.size, toggleFavorite, isFavorite };
}
