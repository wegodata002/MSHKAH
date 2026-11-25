"use client";

import { useEffect, useMemo, useState } from "react";
import { mergePopular, popularIdSet } from "@/lib/catalog/popularity";
import { isPublicMenuProduct } from "@/lib/menu/category-tree";
import type { Product } from "@/types";

/**
 * "Most popular" in the browser: the server's ranking (real sales), loaded once per visit.
 * Until it arrives (or if it fails) only the manual "popular" pins count.
 */
let cached: string[] | null = null;
let inflight: Promise<string[]> | null = null;

function loadRanking(): Promise<string[]> {
  if (cached) return Promise.resolve(cached);
  inflight ??= fetch("/api/catalog/popular")
    .then((res) => (res.ok ? (res.json() as Promise<{ productIds?: unknown }>) : null))
    .then((data) => (Array.isArray(data?.productIds) ? data.productIds.filter((id): id is string => typeof id === "string") : []))
    .catch(() => [] as string[])
    .then((ids) => {
      cached = ids;
      inflight = null;
      return ids;
    });
  return inflight;
}

export function usePopularRanking(): string[] {
  const [ranking, setRanking] = useState<string[]>(cached ?? []);
  useEffect(() => {
    let alive = true;
    void loadRanking().then((ids) => alive && setRanking(ids));
    return () => {
      alive = false;
    };
  }, []);
  return ranking;
}

/**
 * Products with "popular" worked out: `isPopular` = a top seller or pinned by hand, `popularRank`
 * = place in the list (best sellers first, then pins). Pure.
 */
export function withPopularity(products: Product[], ranking: readonly string[]): Product[] {
  const pinned = products.filter((p) => p.isPopular).map((p) => p.id);
  const set = popularIdSet(ranking, pinned);
  const rank = new Map(mergePopular(ranking, pinned).map((id, i) => [id, i]));
  return products.map((p) => ({ ...p, isPopular: set.has(p.id), popularRank: rank.get(p.id) }));
}

/** The home page row: the first `limit` popular products that can be ordered now. Pure. */
export function topPopular(products: readonly Product[], limit = 8): Product[] {
  return products
    .filter((p) => p.popularRank !== undefined && p.available && isPublicMenuProduct(p))
    .sort((a, b) => a.popularRank! - b.popularRank!)
    .slice(0, limit);
}

export function usePopularProducts(products: Product[]): Product[] {
  const ranking = usePopularRanking();
  return useMemo(() => withPopularity(products, ranking), [products, ranking]);
}
