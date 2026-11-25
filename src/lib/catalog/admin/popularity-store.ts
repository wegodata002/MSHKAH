import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  POPULAR_MIN_UNITS,
  POPULAR_REFRESH_MS,
  POPULAR_WINDOW_DAYS,
  rankByUnits,
  totalUnits,
  unitsSold,
  type SaleOrder,
} from "@/lib/catalog/popularity";

/** Saved in `stats/popularity` (server only): the ranking, which period it covers, and when it was made. */
export type PopularityDoc = {
  ranking: string[];
  period: "30d" | "all";
  computedAtMs: number;
};

const DOC_ID = "popularity";
const ORDER_FIELDS = ["items", "status", "paymentStatus", "isTestOrder"] as const;

async function compute(db: Firestore, nowMs: number): Promise<PopularityDoc> {
  const since = Timestamp.fromMillis(nowMs - POPULAR_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  // One range filter on a single field: no extra database index needed. Only the fields counted are read.
  const recent = await db
    .collection(COLLECTIONS.orders)
    .where("createdAt", ">=", since)
    .select(...ORDER_FIELDS)
    .get();
  let units = unitsSold(recent.docs.map((d) => d.data() as SaleOrder));
  let period: PopularityDoc["period"] = "30d";
  if (totalUnits(units) < POPULAR_MIN_UNITS) {
    // Too few sales lately (a young business, a quiet month): all orders instead.
    const all = await db.collection(COLLECTIONS.orders).select(...ORDER_FIELDS).get();
    units = unitsSold(all.docs.map((d) => d.data() as SaleOrder));
    period = "all";
  }
  return { ranking: rankByUnits(units), period, computedAtMs: nowMs };
}

/**
 * The saved ranking, recomputed when it is older than 6 hours (or missing). A failed save never
 * fails the answer; a failed computation answers with the last saved ranking when there is one.
 */
export async function getPopularity(db: Firestore, nowMs = Date.now()): Promise<PopularityDoc> {
  const ref = db.collection(COLLECTIONS.stats).doc(DOC_ID);
  const snap = await ref.get();
  const saved = snap.exists ? (snap.data() as PopularityDoc) : null;
  if (saved && Array.isArray(saved.ranking) && nowMs - Number(saved.computedAtMs) < POPULAR_REFRESH_MS) return saved;
  try {
    const fresh = await compute(db, nowMs);
    await ref.set(fresh).catch((error) => console.error("[popularity] save failed:", error instanceof Error ? error.message : error));
    return fresh;
  } catch (error) {
    console.error("[popularity] compute failed:", error instanceof Error ? error.message : error);
    if (saved && Array.isArray(saved.ranking)) return saved;
    throw error;
  }
}
