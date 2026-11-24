import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { normalizeFulfillmentSettings, type FulfillmentSettings } from "@/lib/fulfillment/settings";
import { DEFAULT_OPENING_HOURS, resolveOpeningHours, type OpeningHours } from "@/lib/settings/opening-hours";
import type { CatalogProduct } from "@/lib/orders/server-order";

/** Server-side reads for order creation and card payments (Admin SDK). */

export async function loadFulfillmentContext(
  db: Firestore
): Promise<{ fulfillment: FulfillmentSettings; openingHours: OpeningHours }> {
  const snap = await db.collection(COLLECTIONS.settings).doc("app").get();
  const data = snap.exists ? (snap.data() as { fulfillment?: unknown; openingHours?: unknown; hours?: string }) : undefined;
  return {
    fulfillment: normalizeFulfillmentSettings(data?.fulfillment),
    // Only a custom free-text "hours" (no weekly schedule) gives null; the default week is used then.
    openingHours: resolveOpeningHours(data) ?? DEFAULT_OPENING_HOURS,
  };
}

/** Catalog products by id; missing ids map to undefined. */
export async function loadCatalogProducts(
  db: Firestore,
  ids: string[]
): Promise<Map<string, CatalogProduct | undefined>> {
  const unique = [...new Set(ids)];
  const result = new Map<string, CatalogProduct | undefined>();
  if (unique.length === 0) return result;
  const refs = unique.map((id) => db.collection(COLLECTIONS.products).doc(id));
  const snaps = await db.getAll(...refs);
  snaps.forEach((snap, i) => {
    result.set(unique[i]!, snap.exists ? (snap.data() as CatalogProduct) : undefined);
  });
  return result;
}
