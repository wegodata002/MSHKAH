/**
 * Club members' favourite products, kept on the member (`favoriteProductIds`) so they show on every
 * device. Pure rules shared by the server route and the tests.
 */
export const MAX_FAVORITES = 200;
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isProductId(value: unknown): value is string {
  return typeof value === "string" && PRODUCT_ID.test(value);
}

/** Valid ids only, no duplicates, at most 200 (the most recent kept: new ones go last). */
export function cleanFavoriteIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of raw) {
    if (!isProductId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(-MAX_FAVORITES);
}

export type FavoritesChange = { action: "add" | "remove"; id: string } | { action: "merge"; ids: string[] };

/** The account list after a change (merge = the device's favourites added once, without duplicates). */
export function applyFavoritesChange(current: readonly string[], change: FavoritesChange): string[] {
  const list = cleanFavoriteIds(current);
  if (change.action === "merge") return cleanFavoriteIds([...list, ...change.ids.filter((id) => !list.includes(id))]);
  if (change.action === "remove") return list.filter((id) => id !== change.id);
  return cleanFavoriteIds([...list.filter((id) => id !== change.id), change.id]);
}

/** POST body → a change, or null when malformed. */
export function parseFavoritesChange(body: unknown): FavoritesChange | null {
  const b = (body && typeof body === "object" ? body : {}) as { action?: unknown; id?: unknown; ids?: unknown };
  if ((b.action === "add" || b.action === "remove") && isProductId(b.id)) return { action: b.action, id: b.id };
  if (b.action === "merge" && Array.isArray(b.ids) && b.ids.length <= MAX_FAVORITES) return { action: "merge", ids: cleanFavoriteIds(b.ids) };
  return null;
}
