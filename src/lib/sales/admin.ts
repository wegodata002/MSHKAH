import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { applySale, readProductSales, SALE_KINDS, type ProductSale, type SaleKind } from "@/lib/sales/sale-price";

/**
 * Admin → Sales (Admin only, server only). A sale lives in `sales/{id}` and is COPIED onto each of
 * its products (`products/{id}.sales`), which is what the menu and the order pricing read. Saving,
 * ending and deleting change both in one transaction, so a product never shows a sale that is gone.
 * A product is in one sale at a time: a sale whose dates overlap another sale of the same product is
 * refused.
 */

export type SaleName = { he: string; ar: string; en: string };

export type SaleRecord = {
  id: string;
  name: SaleName;
  kind: SaleKind;
  value: number;
  startsAt: string;
  endsAt: string;
  productIds: string[];
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  /** "End now": when it was ended before its date. */
  endedEarlyAt?: string;
};

export type SaleStatus = "active" | "scheduled" | "ended";

export type SaleInput = { name: SaleName; kind: SaleKind; value: number; startsAt: string; endsAt: string; productIds: string[] };

export type SaleError =
  | { code: "NAME" }
  | { code: "KIND" }
  | { code: "VALUE" }
  | { code: "DATES" }
  | { code: "NO_PRODUCTS" }
  | { code: "TOO_MANY_PRODUCTS"; max: number }
  | { code: "PRODUCT_NOT_FOUND"; productIds: string[] }
  /** The sale would not lower the price of these products (new price / ₪ off too big or too small). */
  | { code: "NOT_LOWER"; products: string[] }
  | { code: "OVERLAP"; products: string[]; saleName: string }
  | { code: "NOT_FOUND" }
  /** "End now" on a sale that is not on now. */
  | { code: "NOT_ACTIVE" };

export const MAX_SALE_PRODUCTS = 200;

const ISO = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function saleStatus(sale: Pick<SaleRecord, "startsAt" | "endsAt">, now: Date): SaleStatus {
  const t = now.getTime();
  if (t >= Date.parse(sale.endsAt)) return "ended";
  return t < Date.parse(sale.startsAt) ? "scheduled" : "active";
}

/** The request, checked on its own (not against the database). Pure. */
export function parseSaleInput(raw: unknown): { ok: true; input: SaleInput } | { ok: false; error: SaleError } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (r.name && typeof r.name === "object" ? r.name : {}) as Record<string, unknown>;
  const name = { he: text(n.he, 80), ar: text(n.ar, 80), en: text(n.en, 80) };
  if (!name.he) return { ok: false, error: { code: "NAME" } };
  const kind = r.kind as SaleKind;
  if (!SALE_KINDS.includes(kind)) return { ok: false, error: { code: "KIND" } };
  const value = Math.round(Number(r.value) * 100) / 100;
  if (!Number.isFinite(value) || value <= 0 || (kind === "percent" && (value >= 100 || !Number.isInteger(value)))) return { ok: false, error: { code: "VALUE" } };
  if (!ISO(r.startsAt) || !ISO(r.endsAt) || Date.parse(r.startsAt) >= Date.parse(r.endsAt)) return { ok: false, error: { code: "DATES" } };
  const ids = Array.isArray(r.productIds) ? [...new Set(r.productIds.filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)))] : [];
  if (ids.length === 0) return { ok: false, error: { code: "NO_PRODUCTS" } };
  if (ids.length > MAX_SALE_PRODUCTS) return { ok: false, error: { code: "TOO_MANY_PRODUCTS", max: MAX_SALE_PRODUCTS } };
  return {
    ok: true,
    input: { name, kind, value, startsAt: new Date(r.startsAt).toISOString(), endsAt: new Date(r.endsAt).toISOString(), productIds: ids },
  };
}

type ProductDoc = { id: string; price?: unknown; nameHe?: unknown; sales?: unknown; exists: boolean };

const productName = (p: ProductDoc) => (typeof p.nameHe === "string" && p.nameHe.trim()) || p.id;

/** Dates of two sales overlap. */
export function overlaps(a: Pick<SaleRecord, "startsAt" | "endsAt">, b: Pick<SaleRecord, "startsAt" | "endsAt">): boolean {
  return Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);
}

/** The sale against its products and the other sales. Pure. */
export function checkSaleAgainst(
  input: SaleInput,
  ctx: { selfId: string | null; products: readonly ProductDoc[]; otherSales: readonly SaleRecord[] }
): SaleError | null {
  const missing = ctx.products.filter((p) => !p.exists).map((p) => p.id);
  if (missing.length > 0) return { code: "PRODUCT_NOT_FOUND", productIds: missing };
  const notLower = ctx.products.filter((p) => {
    const regular = Number(p.price);
    return !Number.isFinite(regular) || regular <= 0 || applySale(regular, input) >= regular || (input.kind === "amount" && input.value >= regular) || (input.kind === "price" && input.value >= regular);
  });
  if (notLower.length > 0) return { code: "NOT_LOWER", products: notLower.map(productName) };
  const mine = new Set(input.productIds);
  for (const other of ctx.otherSales) {
    if (other.id === ctx.selfId || !overlaps(input, other)) continue;
    const shared = other.productIds.filter((id) => mine.has(id));
    if (shared.length > 0) {
      const names = ctx.products.filter((p) => shared.includes(p.id)).map(productName);
      return { code: "OVERLAP", products: names, saleName: other.name.he };
    }
  }
  return null;
}

/**
 * A product's `sales` list after a change: this sale put in (with its new terms) or taken out, and any
 * sale already over left out. Pure. Empty = the field is removed.
 */
export function nextProductSales(current: unknown, saleId: string, entry: ProductSale | null, now: Date): ProductSale[] {
  const kept = readProductSales(current).filter((s) => s.saleId !== saleId && Date.parse(s.endsAt) > now.getTime());
  return entry ? [...kept, entry].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) : kept;
}

const toEntry = (sale: Pick<SaleRecord, "id" | "kind" | "value" | "startsAt" | "endsAt">): ProductSale => ({
  saleId: sale.id,
  kind: sale.kind,
  value: sale.value,
  startsAt: sale.startsAt,
  endsAt: sale.endsAt,
});

const salesField = (list: ProductSale[]) => (list.length > 0 ? list : FieldValue.delete());

function readSale(id: string, data: Record<string, unknown> | undefined): SaleRecord | null {
  if (!data) return null;
  const n = (data.name ?? {}) as Partial<SaleName>;
  return {
    id,
    name: { he: String(n.he ?? ""), ar: String(n.ar ?? ""), en: String(n.en ?? "") },
    kind: data.kind as SaleKind,
    value: Number(data.value),
    startsAt: String(data.startsAt ?? ""),
    endsAt: String(data.endsAt ?? ""),
    productIds: Array.isArray(data.productIds) ? data.productIds.filter((x): x is string => typeof x === "string") : [],
    createdAt: String(data.createdAt ?? ""),
    updatedAt: String(data.updatedAt ?? ""),
    ...(typeof data.createdBy === "string" ? { createdBy: data.createdBy } : {}),
    ...(typeof data.endedEarlyAt === "string" ? { endedEarlyAt: data.endedEarlyAt } : {}),
  };
}

export async function listSales(db: Firestore, now = new Date()): Promise<Array<SaleRecord & { status: SaleStatus }>> {
  const snap = await db.collection(COLLECTIONS.sales).get();
  return snap.docs
    .map((d) => readSale(d.id, d.data() as Record<string, unknown>))
    .filter((s): s is SaleRecord => !!s)
    .map((s) => ({ ...s, status: saleStatus(s, now) }))
    .sort((a, b) => {
      const rank = { active: 0, scheduled: 1, ended: 2 } as const;
      return rank[a.status] - rank[b.status] || b.startsAt.localeCompare(a.startsAt);
    });
}

/** Create (`id` null) or update a sale, and copy it onto its products (old ones lose it). */
export async function saveSale(
  db: Firestore,
  input: SaleInput,
  opts: { id: string | null; actor: string; now?: Date }
): Promise<{ ok: true; sale: SaleRecord } | { ok: false; error: SaleError }> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const salesCol = db.collection(COLLECTIONS.sales);
  const ref = opts.id ? salesCol.doc(opts.id) : salesCol.doc();
  return db.runTransaction(async (tx) => {
    const [selfSnap, allSnap] = await Promise.all([tx.get(ref), tx.get(salesCol)]);
    const before = opts.id ? readSale(ref.id, selfSnap.exists ? (selfSnap.data() as Record<string, unknown>) : undefined) : null;
    if (opts.id && !before) return { ok: false as const, error: { code: "NOT_FOUND" } as SaleError };
    const touched = [...new Set([...input.productIds, ...(before?.productIds ?? [])])];
    const productRefs = touched.map((id) => db.collection(COLLECTIONS.products).doc(id));
    const productSnaps = productRefs.length > 0 ? await Promise.all(productRefs.map((r) => tx.get(r))) : [];
    const products: ProductDoc[] = productSnaps.map((s, i) => ({ id: touched[i]!, exists: s.exists, ...((s.data() ?? {}) as Record<string, unknown>) }));
    const otherSales = allSnap.docs.map((d) => readSale(d.id, d.data() as Record<string, unknown>)).filter((s): s is SaleRecord => !!s);
    const inSale = new Set(input.productIds);
    const error = checkSaleAgainst(input, { selfId: ref.id, products: products.filter((p) => inSale.has(p.id)), otherSales });
    if (error) return { ok: false as const, error };

    const sale: SaleRecord = {
      id: ref.id,
      ...input,
      createdAt: before?.createdAt || nowIso,
      updatedAt: nowIso,
      createdBy: before?.createdBy ?? opts.actor,
    };
    const { id: _id, ...doc } = sale;
    void _id;
    tx.set(ref, doc);
    for (const p of products) {
      if (!p.exists) continue;
      const list = nextProductSales(p.sales, ref.id, inSale.has(p.id) ? toEntry(sale) : null, now);
      tx.update(db.collection(COLLECTIONS.products).doc(p.id), { sales: salesField(list) });
    }
    return { ok: true as const, sale };
  });
}

/**
 * "End now" (a sale that is on) or delete: the sale is taken off its products at once (the regular
 * price is back immediately). End now keeps the sale in the list with today as its end.
 */
export async function endOrDeleteSale(
  db: Firestore,
  id: string,
  mode: "end" | "delete",
  now = new Date()
): Promise<{ ok: true } | { ok: false; error: SaleError }> {
  const ref = db.collection(COLLECTIONS.sales).doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const sale = readSale(id, snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
    if (!sale) return { ok: false as const, error: { code: "NOT_FOUND" } as SaleError };
    if (mode === "end" && saleStatus(sale, now) !== "active") return { ok: false as const, error: { code: "NOT_ACTIVE" } as SaleError };
    const refs = sale.productIds.map((pid) => db.collection(COLLECTIONS.products).doc(pid));
    const snaps = refs.length > 0 ? await Promise.all(refs.map((r) => tx.get(r))) : [];
    if (mode === "delete") tx.delete(ref);
    else tx.update(ref, { endsAt: now.toISOString(), endedEarlyAt: now.toISOString(), updatedAt: now.toISOString() });
    snaps.forEach((s, i) => {
      if (!s.exists) return;
      const list = nextProductSales((s.data() as { sales?: unknown }).sales, id, null, now);
      tx.update(refs[i]!, { sales: salesField(list) });
    });
    return { ok: true as const };
  });
}
