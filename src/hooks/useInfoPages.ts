"use client";

import { useSyncExternalStore } from "react";
import { subscribeToInfoPages } from "@/services/infoPagesService";
import type { InfoPages } from "@/lib/info-pages/content";

/**
 * The info pages document, live. One listener for the whole page however many components use it
 * (the footer is on every page). `null` while loading or when it could not be read.
 */
type Snapshot = { pages: InfoPages | null; loading: boolean };

let current: Snapshot = { pages: null, loading: true };
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;
const SERVER: Snapshot = { pages: null, loading: true };

function emit(next: Snapshot) {
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!stop) {
    stop = subscribeToInfoPages(
      (pages) => emit({ pages, loading: false }),
      () => emit({ pages: null, loading: false })
    );
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stop) {
      stop();
      stop = null;
      current = { pages: current.pages, loading: true };
    }
  };
}

export function useInfoPages(): Snapshot {
  return useSyncExternalStore(subscribe, () => current, () => SERVER);
}
