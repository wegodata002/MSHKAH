import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { priceNow, money } from "@/lib/sales/sale-price";
import {
  bundleActive,
  bundleSeparateRange,
  MAX_BUNDLE_SLOTS,
  readBundle,
  readSlot,
  slotCount,
  type Bundle,
  type BundleSlot,
  type BundleText,
} from "@/lib/bundles/bundle";

/**
 * Admin → Sales → Bundles (Admin only, server only). A bundle lives in `bundles/{id}`; the menu reads
 * the bundles that are on through /api/catalog/bundles, and the order pricing and the card charge
 * read the bundle itself from here. The browser never writes a bundle.
 */

export type BundleRecord = Bundle & {
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  /** "End now": when it was ended before its date. */
  endedEarlyAt?: string;
};

export type BundleStatus = "active" | "scheduled" | "ended";

export type BundleInput = Omit<Bundle, "id">;

export type BundleError =
  | { code: "NAME" }
  | { code: "PRICE" }
  | { code: "DATES" }
  | { code: "NO_SLOTS" }
  | { code: "TOO_MANY_SLOTS"; max: number }
  /** A part that is incomplete (no product, nothing to choose from, a count out of range). */
  | { code: "SLOT"; index: number }
  | { code: "FREE_DELIVERY_MIN" }
  | { code: "PRODUCT_NOT_FOUND"; productIds: string[] }
  /** A part has nothing that can be ordered now (all its products off, an empty category). */
  | { code: "SLOT_EMPTY"; index: number }
  /** The bundle would not be cheaper than its cheapest products bought separately (₪). */
  | { code: "NOT_LOWER"; separately: number }
  | { code: "NOT_FOUND" }
  | { code: "NOT_ACTIVE" };

const ISO = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const readText = (v: unknown, max: number): BundleText => {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return { he: text(o.he, max), ar: text(o.ar, max), en: text(o.en, max) };
};

export function bundleStatus(bundle: Pick<Bundle, "startsAt" | "endsAt">, now: Date): BundleStatus {
  if (now.getTime() >= Date.parse(bundle.endsAt)) return "ended";
  return bundleActive(bundle, now) ? "active" : "scheduled";
}

/** The request, checked on its own (not against the database). Pure. */
export function parseBundleInput(raw: unknown): { ok: true; input: BundleInput } | { ok: false; error: BundleError } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = readText(r.name, 80);
  if (!name.he) return { ok: false, error: { code: "NAME" } };
  const price = money(Number(r.price));
  if (!Number.isFinite(price) || price <= 0 || price > 10_000) return { ok: false, error: { code: "PRICE" } };
  if (!ISO(r.startsAt) || !ISO(r.endsAt) || Date.parse(r.startsAt) >= Date.parse(r.endsAt)) return { ok: false, error: { code: "DATES" } };
  const rawSlots = Array.isArray(r.slots) ? r.slots : [];
  if (rawSlots.length === 0) return { ok: false, error: { code: "NO_SLOTS" } };
  if (rawSlots.length > MAX_BUNDLE_SLOTS) return { ok: false, error: { code: "TOO_MANY_SLOTS", max: MAX_BUNDLE_SLOTS } };
  const slots: BundleSlot[] = [];
  for (const [index, s] of rawSlots.entries()) {
    const slot = readSlot(s);
    if (!slot || slots.some((x) => x.id === slot.id)) return { ok: false, error: { code: "SLOT", index } };
    slots.push(slot);
  }
  const freeDelivery = r.freeDelivery === true;
  const min = r.freeDeliveryMin === undefined || r.freeDeliveryMin === null || r.freeDeliveryMin === "" ? 0 : money(Number(r.freeDeliveryMin));
  if (!Number.isFinite(min) || min < 0 || min > 10_000) return { ok: false, error: { code: "FREE_DELIVERY_MIN" } };
  const imageUrl = text(r.imageUrl, 2000);
  return {
    ok: true,
    input: {
      name,
      description: readText(r.description, 300),
      ...(imageUrl && /^https:\/\//.test(imageUrl) ? { imageUrl } : {}),
      price,
      startsAt: new Date(r.startsAt).toISOString(),
      endsAt: new Date(r.endsAt).toISOString(),
      slots,
      freeDelivery,
      freeDeliveryMin: freeDelivery ? min : 0,
      couponsAllowed: r.couponsAllowed === true,
    },
  };
}

export type CatalogDoc = { id: string; exists: boolean; price?: unknown; sales?: unknown; categoryId?: unknown; available?: unknown; active?: unknown };

/**
 * The bundle against the catalog (pure): every product exists, every part has something to order,
 * and the bundle is cheaper than its cheapest products bought separately now (sale prices included).
 */
export function checkBundleAgainst(input: BundleInput, products: readonly CatalogDoc[], now: Date): BundleError | null {
  const byId = new Map(products.map((p) => [p.id, p]));
  const named = input.slots.flatMap((s) => (s.kind === "fixed" ? [s.productId] : s.kind === "choice" ? s.productIds : []));
  const missing = [...new Set(named.filter((id) => !byId.get(id)?.exists))];
  if (missing.length > 0) return { code: "PRODUCT_NOT_FOUND", productIds: missing };
  const priced = products
    .filter((p) => p.exists)
    .map((p) => ({ id: p.id, categoryId: p.categoryId, priceNow: priceNow({ price: p.price, sales: p.sales }, now).price, orderable: p.available !== false && p.active !== false }));
  for (const [index, slot] of input.slots.entries()) {
    if (!bundleSeparateRange({ slots: [slot] }, priced)) return { code: "SLOT_EMPTY", index };
  }
  const range = bundleSeparateRange(input, priced);
  if (range && input.price >= range.min) return { code: "NOT_LOWER", separately: range.min };
  return null;
}

/** The products a bundle needs from the catalog: its named products, and all products of its categories. */
async function loadBundleProducts(db: Firestore, slots: readonly BundleSlot[]): Promise<CatalogDoc[]> {
  const ids = [...new Set(slots.flatMap((s) => (s.kind === "fixed" ? [s.productId] : s.kind === "choice" ? s.productIds : [])))];
  const categories = [...new Set(slots.flatMap((s) => (s.kind === "category" ? [s.categoryId] : [])))];
  const out = new Map<string, CatalogDoc>();
  if (ids.length > 0) {
    const snaps = await db.getAll(...ids.map((id) => db.collection(COLLECTIONS.products).doc(id)));
    snaps.forEach((s, i) => out.set(ids[i]!, { id: ids[i]!, exists: s.exists, ...((s.data() ?? {}) as Record<string, unknown>) }));
  }
  for (const categoryId of categories) {
    const snap = await db.collection(COLLECTIONS.products).where("categoryId", "==", categoryId).get();
    for (const d of snap.docs) out.set(d.id, { id: d.id, exists: true, ...(d.data() as Record<string, unknown>) });
  }
  return [...out.values()];
}

function readRecord(id: string, data: Record<string, unknown> | undefined): BundleRecord | null {
  const bundle = readBundle(id, data);
  if (!bundle || !data) return null;
  return {
    ...bundle,
    createdAt: String(data.createdAt ?? ""),
    updatedAt: String(data.updatedAt ?? ""),
    ...(typeof data.createdBy === "string" ? { createdBy: data.createdBy } : {}),
    ...(typeof data.endedEarlyAt === "string" ? { endedEarlyAt: data.endedEarlyAt } : {}),
  };
}

/** The bundles of an order (order pricing, card charge). Missing or malformed = undefined. */
export async function loadBundles(db: Firestore, ids: readonly string[]): Promise<Map<string, Bundle | undefined>> {
  const unique = [...new Set(ids)];
  const out = new Map<string, Bundle | undefined>();
  if (unique.length === 0) return out;
  const snaps = await db.getAll(...unique.map((id) => db.collection(COLLECTIONS.bundles).doc(id)));
  snaps.forEach((s, i) => out.set(unique[i]!, s.exists ? readBundle(unique[i]!, s.data()) ?? undefined : undefined));
  return out;
}

/** The bundles on now, for the menu (no admin fields). */
export async function listActiveBundles(db: Firestore, now = new Date()): Promise<Bundle[]> {
  // A handful of documents: read them all (no index needed) and keep the ones on now.
  const snap = await db.collection(COLLECTIONS.bundles).get();
  return snap.docs
    .map((d) => readBundle(d.id, d.data()))
    .filter((b): b is Bundle => !!b && bundleActive(b, now))
    .sort((a, b) => a.endsAt.localeCompare(b.endsAt));
}

export async function listBundles(db: Firestore, now = new Date()): Promise<Array<BundleRecord & { status: BundleStatus }>> {
  const snap = await db.collection(COLLECTIONS.bundles).get();
  const rank = { active: 0, scheduled: 1, ended: 2 } as const;
  return snap.docs
    .map((d) => readRecord(d.id, d.data() as Record<string, unknown>))
    .filter((b): b is BundleRecord => !!b)
    .map((b) => ({ ...b, status: bundleStatus(b, now) }))
    .sort((a, b) => rank[a.status] - rank[b.status] || b.startsAt.localeCompare(a.startsAt));
}

/** Create (`id` null) or update a bundle, after checking it against the catalog. */
export async function saveBundle(
  db: Firestore,
  input: BundleInput,
  opts: { id: string | null; actor: string; now?: Date }
): Promise<{ ok: true; bundle: BundleRecord } | { ok: false; error: BundleError }> {
  const now = opts.now ?? new Date();
  const col = db.collection(COLLECTIONS.bundles);
  const ref = opts.id ? col.doc(opts.id) : col.doc();
  const before = opts.id ? await ref.get() : null;
  if (opts.id && !before?.exists) return { ok: false, error: { code: "NOT_FOUND" } };
  const products = await loadBundleProducts(db, input.slots);
  const error = checkBundleAgainst(input, products, now);
  if (error) return { ok: false, error };
  const prev = (before?.data() ?? {}) as Record<string, unknown>;
  const nowIso = now.toISOString();
  const doc = {
    ...input,
    createdAt: typeof prev.createdAt === "string" ? prev.createdAt : nowIso,
    updatedAt: nowIso,
    createdBy: typeof prev.createdBy === "string" ? prev.createdBy : opts.actor,
  };
  await ref.set(doc);
  return { ok: true, bundle: { id: ref.id, ...doc } };
}

/** "End now" (a bundle that is on: off the menu at once, kept in the list) or delete. */
export async function endOrDeleteBundle(db: Firestore, id: string, mode: "end" | "delete", now = new Date()): Promise<{ ok: true } | { ok: false; error: BundleError }> {
  const ref = db.collection(COLLECTIONS.bundles).doc(id);
  const snap = await ref.get();
  const bundle = readRecord(id, snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
  if (!snap.exists) return { ok: false, error: { code: "NOT_FOUND" } };
  if (mode === "delete") {
    await ref.delete();
    return { ok: true };
  }
  if (!bundle || bundleStatus(bundle, now) !== "active") return { ok: false, error: { code: "NOT_ACTIVE" } };
  await ref.update({ endsAt: now.toISOString(), endedEarlyAt: now.toISOString(), updatedAt: now.toISOString() });
  return { ok: true };
}

/** How many products a bundle holds (for the admin list). */
export function bundleSize(bundle: Pick<Bundle, "slots">): number {
  return bundle.slots.reduce((sum, s) => sum + slotCount(s), 0);
}
