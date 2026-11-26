// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { createFakeFirestore } from "./helpers/fake-firestore";
import {
  activeSale,
  applySale,
  israelLocalToIso,
  isoToIsraelLocal,
  priceNow,
  readProductSales,
  saleUntilText,
  withoutSaleFields,
  type ProductSale,
} from "@/lib/sales/sale-price";
import { checkSaleAgainst, nextProductSales, parseSaleInput, saleStatus, type SaleRecord } from "@/lib/sales/admin";
import { priceCartLine, saleChanges } from "@/lib/sales/cart-pricing";
import { splitOffers } from "@/lib/catalog/offers";
import { buildServerOrder, type CatalogProduct, type CreateOrderRequest } from "@/lib/orders/server-order";
import { buildProductBuilderConfig } from "@/lib/product-builder/engine";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { localToDate } from "@/lib/fulfillment/availability";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { mapProduct } from "@/lib/mappers";
import { ADMIN_TRANSLATIONS } from "@/data/admin-translations";
import { UI_TRANSLATIONS_SEED } from "@/data/ui-translations-seed";
import type { ModifierGroup, ModifierOption } from "@/types/modifiers";
import type { Product } from "@/types";

const fake = createFakeFirestore();
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fake.db }));
const admin = await import("@/lib/sales/admin");
const db = fake.db as unknown as Parameters<typeof admin.saveSale>[0];
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const S = "2026-11-24T08:00:00.000Z";
const E = "2026-11-30T21:59:00.000Z";
const sale = (over: Partial<ProductSale> = {}): ProductSale => ({ saleId: "SaleWeek01", kind: "percent", value: 20, startsAt: S, endsAt: E, ...over });
const at = (iso: string) => Date.parse(iso);

describe("the price now", () => {
  it("percent, ₪ off and a new price; rounded to the agora; never below 0 or above the regular price", () => {
    expect(applySale(18, { kind: "percent", value: 20 })).toBe(14.4);
    expect(applySale(19.9, { kind: "percent", value: 15 })).toBe(16.92);
    expect(applySale(14, { kind: "amount", value: 5 })).toBe(9);
    expect(applySale(14, { kind: "amount", value: 50 })).toBe(0);
    expect(applySale(14, { kind: "price", value: 10 })).toBe(10);
    expect(applySale(14, { kind: "price", value: 20 })).toBe(14);
  });

  it("on from the start (inclusive) until the end (exclusive); before and after: the regular price, by itself", () => {
    const product = { price: 18, sales: [sale()] };
    expect(priceNow(product, at("2026-11-24T07:59:59.999Z"))).toEqual({ price: 18, regular: 18, sale: null });
    expect(priceNow(product, at(S))).toMatchObject({ price: 14.4, regular: 18, sale: { saleId: "SaleWeek01" } });
    expect(priceNow(product, at("2026-11-30T21:58:59Z")).price).toBe(14.4);
    expect(priceNow(product, at(E))).toEqual({ price: 18, regular: 18, sale: null });
  });

  it("one sale after another on the same product: each in its own dates", () => {
    const next = sale({ saleId: "SaleNext01", kind: "price", value: 10, startsAt: E, endsAt: "2026-12-05T22:00:00.000Z" });
    const product = { price: 18, sales: [sale(), next] };
    expect(priceNow(product, at("2026-11-25T10:00:00Z")).price).toBe(14.4);
    expect(priceNow(product, at("2026-12-01T10:00:00Z"))).toMatchObject({ price: 10, sale: { saleId: "SaleNext01" } });
  });

  it("anything malformed is ignored (never trusted as a price); a 'sale' that does not lower the price is none", () => {
    const junk = [{ saleId: "", kind: "percent", value: 20, startsAt: S, endsAt: E }, { saleId: "x", kind: "free", value: 1, startsAt: S, endsAt: E }, { saleId: "y", kind: "percent", value: 100, startsAt: S, endsAt: E }, { saleId: "z", kind: "price", value: 5, startsAt: E, endsAt: S }, "nope", null];
    expect(readProductSales(junk)).toEqual([]);
    expect(readProductSales("x")).toEqual([]);
    expect(priceNow({ price: 18, sales: junk }, at("2026-11-25T10:00:00Z")).sale).toBeNull();
    expect(priceNow({ price: 8, sales: [sale({ kind: "price", value: 10 })] }, at("2026-11-25T10:00:00Z"))).toEqual({ price: 8, regular: 8, sale: null });
    expect(activeSale(undefined, Date.now())).toBeNull();
  });

  it("Israel time: winter (UTC+2) and summer (UTC+3), both ways; 'until' text", () => {
    expect(israelLocalToIso("2026-11-30T23:59")).toBe("2026-11-30T21:59:00.000Z");
    expect(israelLocalToIso("2026-07-01T10:00")).toBe("2026-07-01T07:00:00.000Z");
    expect(isoToIsraelLocal("2026-11-30T21:59:00.000Z")).toBe("2026-11-30T23:59");
    expect(israelLocalToIso("nope")).toBeNull();
    expect(saleUntilText("2026-11-30T21:59:00.000Z")).toBe("30.11");
    expect(saleUntilText("2026-11-30T22:00:00.000Z")).toBe("30.11"); // midnight = the end of the 30th
    expect(saleUntilText("2026-11-30T16:00:00.000Z")).toBe("30.11 18:00");
  });

  it("the mapper reads the field into products (bad entries left out); none → no field", () => {
    const base = { id: "p1", nameHe: "קפה", nameAr: "", nameEn: "", categoryId: "c", price: 18, popular: false, newProduct: false, available: true, sortOrder: 1 };
    expect(mapProduct({ ...base, sales: [sale(), { bad: true }] } as never).sales).toEqual([sale()]);
    expect("sales" in mapProduct(base as never)).toBe(false);
  });
});

describe("the server prices the order with the sale (and coupons after it)", () => {
  const group: ModifierGroup = { id: "milk", name_he: "חלב", name_ar: "", name_en: "", selectionType: "single", requirement: "optional", minSelections: 0, maxSelections: 1, displayType: "buttons", sortOrder: 1, active: true, archived: false, createdAt: "", updatedAt: "" };
  const oat: ModifierOption = { id: "oat", groupId: "milk", name_he: "שיבולת", name_ar: "", name_en: "", priceDelta: 2, cost: 0, sortOrder: 1, active: true, archived: false, createdAt: "", updatedAt: "" };
  const CONFIGS = new Map([["latte", buildProductBuilderConfig({ productId: "latte", groups: [group], options: [oat], productGroups: [{ id: "l", productId: "latte", groupId: "milk", sortOrder: 1, active: true }], productOptions: [], rules: [], suggestions: [], inventory: [] })]]);
  const PRODUCTS = new Map<string, CatalogProduct | undefined>([
    ["latte", { price: 18, nameHe: "לאטה", available: true, sales: [sale()] }],
    ["croissant", { price: 14, nameHe: "קרואסון", available: true, sales: [sale({ saleId: "SaleBake01", kind: "price", value: 10 })] }],
    ["tea", { price: 12, nameHe: "תה", available: true }],
  ]);
  const DURING = localToDate({ year: 2026, month: 11, day: 25 }, 12 * 60);
  const AFTER = localToDate({ year: 2026, month: 12, day: 1 }, 12 * 60);
  const order = (now: Date, coupon?: string, storeCoupon?: { type: "percent" | "fixed"; value: number; minOrder: number } | null) =>
    buildServerOrder(
      {
        items: [
          { productId: "latte", quantity: 1, modifiers: [{ groupId: "milk", optionId: "oat", quantity: 1 }] },
          { productId: "croissant", quantity: 2 },
          { productId: "tea", quantity: 1 },
        ],
        customer: { name: "דנה", phone: "050-1234567" },
        locale: "he",
        payment: "counter",
        fulfillment: { type: "pickup" },
        ...(coupon ? { couponCode: coupon } : {}),
      } as CreateOrderRequest,
      { products: PRODUCTS, modifierConfigs: CONFIGS, fulfillment: DEFAULT_FULFILLMENT, openingHours: DEFAULT_OPENING_HOURS, now, orderNumber: "MC-2026-SALE0001", ...(storeCoupon !== undefined ? { storeCoupon } : {}) }
    );

  it("during the sale: sale base price, add-ons at full price, regular price and sale id kept on the line", () => {
    const r = order(DURING);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.items[0]).toMatchObject({ basePrice: 14.4, price: 16.4, regularBasePrice: 18, saleId: "SaleWeek01" });
    expect(r.order.items[1]).toMatchObject({ basePrice: 10, price: 10, regularBasePrice: 14, saleId: "SaleBake01" });
    expect(r.order.items[2]).toEqual(expect.objectContaining({ basePrice: 12, price: 12 }));
    expect(r.order.items[2]).not.toHaveProperty("saleId");
    expect(r.order.subtotal).toBe(48.4); // 16.40 + 2×10 + 12
    expect(r.order.total).toBe(48.4);
  });

  it("a coupon applies to the price after the sale", () => {
    const r = order(DURING, "SUMMER10", { type: "percent", value: 10, minOrder: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.discount).toBe(4.84);
    expect(r.order.total).toBe(43.56);
  });

  it("after the end: the regular price, by itself", () => {
    const r = order(AFTER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.order.items.map((i) => i.basePrice)).toEqual([18, 14, 12]);
    expect(r.order.items.some((i) => "saleId" in i)).toBe(false);
    expect(r.order.subtotal).toBe(60);
  });

  it("waiter / table orders go through the same pricing", () => {
    expect(read("src/lib/waiter/new-order.ts")).toContain("buildServerOrder(");
    expect(read("src/lib/orders/server-order.ts")).toContain("const pricing = priceNow(product, ctx.now);");
  });
});

describe("Admin → Sales rules", () => {
  const input = (over: Record<string, unknown> = {}) => ({ name: { he: "שבוע הקפה", ar: "", en: "" }, kind: "percent", value: 20, startsAt: S, endsAt: E, productIds: ["latte"], ...over });

  it("the request: name, kind, value (percent a whole 1–99), dates in order, products", () => {
    expect(parseSaleInput(input()).ok).toBe(true);
    expect(parseSaleInput(input({ name: { he: " " } }))).toEqual({ ok: false, error: { code: "NAME" } });
    expect(parseSaleInput(input({ kind: "free" }))).toEqual({ ok: false, error: { code: "KIND" } });
    for (const v of [0, -5, 100, 12.5, "x"]) expect(parseSaleInput(input({ value: v })), String(v)).toEqual({ ok: false, error: { code: "VALUE" } });
    expect(parseSaleInput(input({ kind: "amount", value: 2.5 })).ok).toBe(true);
    expect(parseSaleInput(input({ startsAt: E, endsAt: S }))).toEqual({ ok: false, error: { code: "DATES" } });
    expect(parseSaleInput(input({ productIds: [] }))).toEqual({ ok: false, error: { code: "NO_PRODUCTS" } });
    expect(parseSaleInput(input({ productIds: Array.from({ length: 201 }, (_, i) => `p${i}`) }))).toMatchObject({ ok: false, error: { code: "TOO_MANY_PRODUCTS" } });
  });

  it("refused: a price that would not go down, and a product already in a sale on overlapping dates", () => {
    const parsed = parseSaleInput(input({ kind: "price", value: 15, productIds: ["latte", "tea"] }));
    if (!parsed.ok) throw new Error("bad");
    const products = [{ id: "latte", exists: true, price: 18, nameHe: "לאטה" }, { id: "tea", exists: true, price: 12, nameHe: "תה" }];
    expect(checkSaleAgainst(parsed.input, { selfId: null, products, otherSales: [] })).toEqual({ code: "NOT_LOWER", products: ["תה"] });
    const ok = parseSaleInput(input({ productIds: ["latte"] }));
    if (!ok.ok) throw new Error("bad");
    const other: SaleRecord = { id: "SaleOther1", name: { he: "מאפה בוקר", ar: "", en: "" }, kind: "price", value: 10, startsAt: "2026-11-29T00:00:00.000Z", endsAt: "2026-12-05T00:00:00.000Z", productIds: ["latte"], createdAt: "", updatedAt: "" };
    expect(checkSaleAgainst(ok.input, { selfId: null, products, otherSales: [other] })).toEqual({ code: "OVERLAP", products: ["לאטה"], saleName: "מאפה בוקר" });
    // Back to back is fine; and a sale never overlaps itself (editing).
    expect(checkSaleAgainst(ok.input, { selfId: null, products, otherSales: [{ ...other, startsAt: E }] })).toBeNull();
    expect(checkSaleAgainst(ok.input, { selfId: "SaleOther1", products, otherSales: [other] })).toBeNull();
  });

  it("status and the product's list after a change (sales already over are dropped)", () => {
    const now = new Date("2026-11-25T10:00:00Z");
    expect(saleStatus({ startsAt: S, endsAt: E }, now)).toBe("active");
    expect(saleStatus({ startsAt: E, endsAt: "2026-12-30T00:00:00Z" }, now)).toBe("scheduled");
    expect(saleStatus({ startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-02T00:00:00Z" }, now)).toBe("ended");
    const old = sale({ saleId: "SaleOld001", startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-02T00:00:00Z" });
    expect(nextProductSales([old, sale()], "SaleWeek01", null, now)).toEqual([]);
    expect(nextProductSales([old], "SaleWeek01", sale({ value: 25 }), now)).toEqual([sale({ value: 25 })]);
  });
});

describe("Admin → Sales in the database (copied onto the products)", () => {
  beforeEach(() => {
    fake.reset();
    fake.put("products", "latte", { nameHe: "לאטה", price: 18, available: true });
    fake.put("products", "tea", { nameHe: "תה", price: 12, available: true });
  });
  const NOW = new Date("2026-11-25T10:00:00Z");
  const input = (over: Record<string, unknown> = {}) => {
    const p = parseSaleInput({ name: { he: "שבוע הקפה", ar: "أسبوع القهوة", en: "Coffee week" }, kind: "percent", value: 20, startsAt: S, endsAt: E, productIds: ["latte", "tea"], ...over });
    if (!p.ok) throw new Error("bad input");
    return p.input;
  };
  const productSales = async (id: string) => (await fake.db.collection("products").doc(id).get()).data()?.sales;

  it("create: the sale is saved and copied onto each product; the products' other fields are untouched", async () => {
    const r = await admin.saveSale(db, input(), { id: null, actor: "admin1", now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await productSales("latte")).toEqual([{ saleId: r.sale.id, kind: "percent", value: 20, startsAt: S, endsAt: E }]);
    expect((await fake.db.collection("products").doc("latte").get()).data()).toMatchObject({ nameHe: "לאטה", price: 18 });
    const list = await admin.listSales(db, NOW);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: "active", name: { en: "Coffee week" }, productIds: ["latte", "tea"], createdBy: "admin1" });
  });

  it("update: a product taken out of the sale loses it at once; new terms reach the others", async () => {
    const r = await admin.saveSale(db, input(), { id: null, actor: "admin1", now: NOW });
    if (!r.ok) throw new Error("save");
    const u = await admin.saveSale(db, input({ value: 30, productIds: ["latte"] }), { id: r.sale.id, actor: "admin1", now: NOW });
    expect(u.ok).toBe(true);
    expect((await productSales("latte"))[0]).toMatchObject({ value: 30 });
    expect((await productSales("tea")) as unknown).toEqual(FieldValue.delete());
  });

  it("overlap with another sale of the same product is refused (nothing written)", async () => {
    const r = await admin.saveSale(db, input({ productIds: ["latte"] }), { id: null, actor: "admin1", now: NOW });
    if (!r.ok) throw new Error("save");
    const second = await admin.saveSale(db, input({ name: { he: "שני", ar: "", en: "" }, kind: "price", value: 10, productIds: ["latte", "tea"] }), { id: null, actor: "admin1", now: NOW });
    expect(second).toEqual({ ok: false, error: { code: "OVERLAP", products: ["לאטה"], saleName: "שבוע הקפה" } });
    expect(await productSales("tea")).toBeUndefined();
    expect(await admin.listSales(db, NOW)).toHaveLength(1);
  });

  it("End now: the field is removed from the products at once; the sale stays as ended", async () => {
    const r = await admin.saveSale(db, input(), { id: null, actor: "admin1", now: NOW });
    if (!r.ok) throw new Error("save");
    expect(await admin.endOrDeleteSale(db, r.sale.id, "end", NOW)).toEqual({ ok: true });
    expect((await productSales("latte")) as unknown).toEqual(FieldValue.delete());
    expect((await productSales("tea")) as unknown).toEqual(FieldValue.delete());
    const [s] = await admin.listSales(db, NOW);
    expect(s).toMatchObject({ status: "ended", endsAt: NOW.toISOString(), endedEarlyAt: NOW.toISOString() });
    // Not on any more → "end now" again is refused.
    expect(await admin.endOrDeleteSale(db, r.sale.id, "end", NOW)).toEqual({ ok: false, error: { code: "NOT_ACTIVE" } });
  });

  it("Delete: the sale is gone and the field is removed from the products at once; another sale on the product stays", async () => {
    const r = await admin.saveSale(db, input({ productIds: ["latte"] }), { id: null, actor: "admin1", now: NOW });
    const later = await admin.saveSale(db, input({ name: { he: "דצמבר", ar: "", en: "" }, startsAt: E, endsAt: "2026-12-20T00:00:00.000Z", productIds: ["latte"] }), { id: null, actor: "admin1", now: NOW });
    if (!r.ok || !later.ok) throw new Error("save");
    expect(((await productSales("latte")) as ProductSale[]).map((s) => s.saleId)).toEqual([r.sale.id, later.sale.id]);
    expect(await admin.endOrDeleteSale(db, r.sale.id, "delete", NOW)).toEqual({ ok: true });
    expect(((await productSales("latte")) as ProductSale[]).map((s) => s.saleId)).toEqual([later.sale.id]);
    expect((await admin.listSales(db, NOW)).map((s) => s.id)).toEqual([later.sale.id]);
    expect(await admin.endOrDeleteSale(db, "MissingSale", "delete", NOW)).toEqual({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("the API is Admin only; the collection has no browser rule (firestore.rules untouched)", () => {
    const route = read("src/app/api/admin/sales/route.ts");
    expect(route).toContain("requireAdminOnly(request)");
    expect(read("firestore.rules")).not.toMatch(/match \/sales\//);
  });
});

describe("a product edit never deletes or overwrites the sale", () => {
  it("the sale fields are taken out of every product write from the admin", () => {
    expect(withoutSaleFields({ price: 20, sales: [], sale: {}, available: true })).toEqual({ price: 20, available: true });
    expect(read("src/services/productService.ts")).toContain("...withoutSaleFields(input as Record<string, unknown>),");
    const editor = read("src/services/productEditorSaveService.ts");
    expect(editor).toContain("const patch = withoutSaleFields({ ...input.productPatch }");
    expect(editor).toContain("withoutSaleFields(productSchema.parse(input.productValues)");
  });

  it("the editor and the list write only the fields they change (update, not a whole-document set)", () => {
    const editor = read("src/services/productEditorSaveService.ts");
    expect(editor).toMatch(/batch\.update\(\s*productRef,/);
    const service = read("src/services/productService.ts");
    expect(service).toContain("await updateDoc(ref, sanitizeFirestoreData({");
    expect(service.indexOf("...withoutSaleFields(input")).toBeGreaterThan(service.indexOf("await updateDoc(ref, sanitizeFirestoreData({"));
  });
});

describe("cart and offers", () => {
  const product = { id: "latte", price: 18, sales: [sale()] };
  const line = { lineId: "l1", product, selections: [{ priceDelta: 2, quantity: 1 }], unitPrice: 20 };

  it("a cart line is priced now: sale price + add-ons at full price; after the end the regular price; live menu wins", () => {
    expect(priceCartLine(line, undefined, at("2026-11-25T10:00:00Z"))).toMatchObject({ unitPrice: 16.4, regularUnitPrice: 20, sale: { saleId: "SaleWeek01" } });
    expect(priceCartLine(line, undefined, at("2026-12-01T10:00:00Z"))).toEqual({ unitPrice: 20, regularUnitPrice: 20, sale: null });
    // Ended in the admin meanwhile: the live product has no sale any more.
    expect(priceCartLine(line, { price: 18 }, at("2026-11-25T10:00:00Z"))).toEqual({ unitPrice: 20, regularUnitPrice: 20, sale: null });
  });

  it("the cart says when a sale started or ended on a product already in it (not when one is added)", () => {
    const before = new Map([["l1", "SaleWeek01"], ["l2", null]]);
    expect(saleChanges(before, [{ lineId: "l1", productId: "latte", saleId: null }, { lineId: "l2", productId: "tea", saleId: "S2" }, { lineId: "l3", productId: "x", saleId: "S3" }])).toEqual([
      { lineId: "l1", productId: "latte", change: "ended" },
      { lineId: "l2", productId: "tea", change: "started" },
    ]);
  });

  it("offers page: on sale now first, then the recommended ones not on sale", () => {
    const p = (id: string, over: Partial<Product> = {}) => ({ id, name_he: id, name_ar: "", name_en: "", price: 10, available: true, active: true, categoryId: "c", ...over }) as Product;
    const products = [p("a"), p("b", { sales: [sale()] }), p("c"), p("d", { sales: [sale()], available: false })];
    const { onSale, recommended } = splitOffers(products, [{ productId: "c" }, { productId: "b" }], at("2026-11-25T10:00:00Z"));
    expect(onSale.map((x) => x.id)).toEqual(["b", "d"]);
    expect(recommended.map((x) => x.id)).toEqual(["c"]);
    expect(splitOffers(products, [], at("2026-12-01T10:00:00Z")).onSale).toEqual([]);
  });
});

describe("texts in Hebrew, Arabic and English", () => {
  it("every new key exists in the three languages", () => {
    const keys = (m: Record<string, string>, prefix: string) => Object.keys(m).filter((k) => k.startsWith(prefix)).sort();
    const adminHe = keys(ADMIN_TRANSLATIONS.he, "admin.sales.");
    expect(adminHe.length).toBeGreaterThan(40);
    expect(keys(ADMIN_TRANSLATIONS.ar, "admin.sales.")).toEqual(adminHe);
    expect(keys(ADMIN_TRANSLATIONS.en, "admin.sales.")).toEqual(adminHe);
    for (const k of ["sale.badge", "sale.until", "sale.regularPrice", "sale.save", "sale.addonsFull", "cart.saleSavings", "cart.saleEnded", "cart.saleStarted", "offers.onSale", "offers.recommended"]) {
      for (const l of ["he", "ar", "en"] as const) expect(UI_TRANSLATIONS_SEED[l][k], `${l} ${k}`).toBeTruthy();
    }
  });
});
