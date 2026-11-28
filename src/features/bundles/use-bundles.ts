"use client";

import { useEffect, useState } from "react";
import { bundleActive, readBundle, type Bundle } from "@/lib/bundles/bundle";

/**
 * The bundles on now (from /api/catalog/bundles), shared by the offers page, the menu, the cart and
 * the waiter screen: one request for all of them, again every minute while a page uses them, and
 * a bundle drops off by itself at its end time. The server checks the bundle again on every order.
 */

type Snapshot = { bundles: Bundle[]; loaded: boolean };

let snapshot: Snapshot = { bundles: [], loaded: false };
let inflight: Promise<void> | null = null;
let lastFetch = 0;
const listeners = new Set<(s: Snapshot) => void>();
const REFRESH_MS = 60_000;

function publish(next: Snapshot) {
  snapshot = next;
  for (const l of listeners) l(snapshot);
}

async function fetchBundles(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch("/api/catalog/bundles", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; bundles?: unknown[] } | null;
      const list = Array.isArray(data?.bundles)
        ? data!.bundles
            .map((raw) => (raw && typeof raw === "object" ? readBundle(String((raw as { id?: unknown }).id ?? ""), raw) : null))
            .filter((b): b is Bundle => !!b && !!b.id)
        : [];
      lastFetch = Date.now();
      publish({ bundles: list, loaded: true });
    } catch {
      publish({ ...snapshot, loaded: true });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The bundles on now. `loaded` is false until the first answer (or failure). */
export function useActiveBundles(): Snapshot {
  const [state, setState] = useState<Snapshot>(snapshot);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    listeners.add(setState);
    if (!snapshot.loaded || Date.now() - lastFetch > REFRESH_MS) void fetchBundles();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (Date.now() - lastFetch > REFRESH_MS) void fetchBundles();
    }, 30_000);
    return () => {
      listeners.delete(setState);
      window.clearInterval(timer);
    };
  }, []);
  return { loaded: state.loaded, bundles: state.bundles.filter((b) => bundleActive(b, now)) };
}

/** Tests: start again with nothing loaded. */
export function resetBundlesCacheForTests() {
  snapshot = { bundles: [], loaded: false };
  inflight = null;
  lastFetch = 0;
}
