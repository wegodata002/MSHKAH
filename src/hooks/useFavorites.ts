"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { hasClubHint } from "@/lib/loyalty/club-hint";

/**
 * Favourite products (the heart on a product), one shared copy for the whole page: a heart tapped in
 * the product drawer updates the card, the Favourites page and the badges at once.
 *
 * - Not a signed-in club member: kept in this browser only (localStorage), as before; other open tabs
 *   follow through the "storage" event.
 * - A signed-in club member: kept on the member's account (/api/club/favorites), so they show on every
 *   device. At sign-in the favourites already on this device are merged into the account once and then
 *   removed from the device — after signing out, the device starts empty (approved).
 */
const STORAGE_KEY = "mishkat-favorites";
const EMPTY: ReadonlySet<string> = new Set();

type State = { ids: ReadonlySet<string>; account: boolean; checked: boolean };

let state: State | null = null;
let checkedHint: boolean | null = null;
let checking: Promise<void> | null = null;
const listeners = new Set<() => void>();
const SERVER: State = { ids: EMPTY, account: false, checked: false };

function readStored(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function setState(next: State) {
  state = next;
  listeners.forEach((listener) => listener());
}

function getSnapshot(): State {
  if (!state) state = { ids: readStored(), account: false, checked: !hasClubHint() };
  return state;
}

function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  if (getSnapshot().account) return; // the account list is not kept on the device
  setState({ ...getSnapshot(), ids: readStored() });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function saveDevice(next: ReadonlySet<string>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    // Storage full or blocked (private mode): keep the in-page copy.
  }
  setState({ ...getSnapshot(), ids: next });
}

async function postChange(body: Record<string, unknown>): Promise<string[] | null> {
  const res = await fetch("/api/club/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = res?.ok ? ((await res.json().catch(() => null)) as { ok?: boolean; ids?: string[] } | null) : null;
  return data?.ok && Array.isArray(data.ids) ? data.ids : null;
}

/** Signed in to the club on this device? Use the account list (merging the device's favourites once). */
function checkAccount(): Promise<void> {
  const hint = hasClubHint();
  if (checkedHint === hint && (checking || getSnapshot().checked)) return checking ?? Promise.resolve();
  checkedHint = hint;
  if (!hint) {
    setState({ ids: readStored(), account: false, checked: true });
    return Promise.resolve();
  }
  checking = (async () => {
    try {
      const res = await fetch("/api/club/favorites", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; member?: boolean; ids?: string[] } | null;
      if (!res.ok || !data?.ok || !data.member) {
        setState({ ids: readStored(), account: false, checked: true });
        return;
      }
      let ids = data.ids ?? [];
      const onDevice = [...readStored()];
      if (onDevice.length > 0) {
        const merged = await postChange({ action: "merge", ids: onDevice });
        if (!merged) {
          // Not merged (network): keep using this device's list until the next visit.
          setState({ ids: readStored(), account: false, checked: true });
          return;
        }
        ids = merged;
        try {
          window.localStorage.removeItem(STORAGE_KEY);
        } catch {
          // nothing kept
        }
      }
      setState({ ids: new Set(ids), account: true, checked: true });
    } catch {
      setState({ ids: readStored(), account: false, checked: true });
    } finally {
      checking = null;
    }
  })();
  return checking;
}

/**
 * Not signed in to the club: products deleted from the menu leave this device's favourites (checked
 * on the Favourites page), so the ♡ count is right. The account list is cleaned on the server instead.
 */
export function dropDeviceFavorites(deletedIds: readonly string[]): void {
  const snap = getSnapshot();
  if (snap.account || deletedIds.length === 0) return;
  const next = new Set([...readStored()].filter((id) => !deletedIds.includes(id)));
  saveDevice(next);
}

export function useFavorites() {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => SERVER);
  const favorites = current.ids;

  useEffect(() => {
    void checkAccount();
  }, []);

  const toggleFavorite = useCallback((productId: string) => {
    const snap = getSnapshot();
    const next = new Set(snap.ids);
    const adding = !next.has(productId);
    if (adding) next.add(productId);
    else next.delete(productId);
    if (!snap.account) {
      saveDevice(next);
      return;
    }
    // Account: shown at once, saved on the server; put back if the server refused.
    setState({ ...snap, ids: next });
    void postChange({ action: adding ? "add" : "remove", id: productId }).then((ids) => {
      if (ids) setState({ ...getSnapshot(), ids: new Set(ids) });
      else setState({ ...getSnapshot(), ids: snap.ids });
    });
  }, []);

  const isFavorite = useCallback((productId: string) => favorites.has(productId), [favorites]);

  return {
    favorites,
    count: favorites.size,
    toggleFavorite,
    isFavorite,
    /** Kept on the club account (signed in) rather than on this device. */
    account: current.account,
    /** The account check finished (false while it is still asking the server). */
    checked: current.checked,
  };
}
