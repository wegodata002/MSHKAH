import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { applyFavoritesChange, cleanFavoriteIds, type FavoritesChange } from "@/lib/loyalty/favorites";

/** Server-only: the member's favourite products (`loyaltyMembers/{id}.favoriteProductIds`). */
export async function changeMemberFavorites(db: Firestore, memberId: string, change: FavoritesChange): Promise<string[]> {
  const ref = db.collection(COLLECTIONS.loyaltyMembers).doc(memberId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = cleanFavoriteIds((snap.data() as { favoriteProductIds?: unknown } | undefined)?.favoriteProductIds);
    const next = applyFavoritesChange(current, change);
    if (next.length !== current.length || next.some((id, i) => id !== current[i])) {
      tx.update(ref, { favoriteProductIds: next, updatedAt: new Date().toISOString() });
    }
    return next;
  });
}

/**
 * Products deleted from the menu leave the member's favourites, so the ♡ count is right without
 * loading the menu. Only products whose document is gone are removed: a product hidden for now stays
 * (it just isn't shown while hidden).
 */
export async function dropDeletedFavorites(db: Firestore, memberId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [...ids];
  const snaps = await db.getAll(...ids.map((id) => db.collection(COLLECTIONS.products).doc(id)));
  const gone = new Set(snaps.filter((s) => !s.exists).map((s) => s.id));
  if (gone.size === 0) return [...ids];
  const ref = db.collection(COLLECTIONS.loyaltyMembers).doc(memberId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = cleanFavoriteIds((snap.data() as { favoriteProductIds?: unknown } | undefined)?.favoriteProductIds);
    const next = current.filter((id) => !gone.has(id));
    if (next.length !== current.length) tx.update(ref, { favoriteProductIds: next, updatedAt: new Date().toISOString() });
    return next;
  });
}
