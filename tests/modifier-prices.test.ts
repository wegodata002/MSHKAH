// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Firestore } from "firebase-admin/firestore";
import { priceLineModifiers, type RequestedModifier } from "@/lib/orders/modifier-pricing";
import { loadModifierConfigs } from "@/lib/orders/admin-modifier-config";
import { buildServerOrder, type CatalogProduct, type CreateOrderRequest } from "@/lib/orders/server-order";
import { buildProductBuilderConfig } from "@/lib/product-builder/engine";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { localToDate } from "@/lib/fulfillment/availability";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import type { BusinessRule, InventoryLink, ModifierGroup, ModifierOption, ProductModifierGroup, ProductModifierOption } from "@/types/modifiers";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

// ---- catalog: latte with milk (one only) and syrups (up to 2); crepe with toppings ----
const group = (id: string, name: string, over: Partial<ModifierGroup> = {}): ModifierGroup => ({
  id, name_he: name, name_ar: `${name}-ar`, name_en: `${name}-en`, selectionType: "single", requirement: "optional",
  minSelections: 0, maxSelections: 1, displayType: "buttons", sortOrder: 1, active: true, archived: false, createdAt: "", updatedAt: "", ...over,
});
const option = (id: string, groupId: string, priceDelta: number, over: Partial<ModifierOption> = {}): ModifierOption => ({
  id, groupId, name_he: `${id}-he`, name_ar: `${id}-ar`, name_en: `${id}-en`, priceDelta, cost: 0, sortOrder: 1,
  active: true, archived: false, createdAt: "", updatedAt: "", ...over,
});
const link = (productId: string, groupId: string, over: Partial<ProductModifierGroup> = {}): ProductModifierGroup => ({
  id: `${productId}-${groupId}`, productId, groupId, sortOrder: 1, active: true, ...over,
});

const GROUPS = [
  group("milk", "חלב"),
  group("syrup", "סירופ", { selectionType: "multiple", maxSelections: 2 }),
  group("size", "גודל", { requirement: "required" }),
  group("topping", "תוספת"),
  group("old", "ישן", { active: false }),
];
const OPTIONS = [
  option("oat", "milk", 3, { kitchenNote: "oat milk" }),
  option("soy", "milk", 2),
  option("almond", "milk", 4),
  option("vanilla", "syrup", 2),
  option("caramel", "syrup", 2),
  option("hazelnut", "syrup", 2),
  option("large", "size", 5),
  option("nutella", "topping", 6),
  option("retired", "milk", 1, { archived: true }),
  option("ghost", "old", 1),
];
const LINKS = [link("latte", "milk"), link("latte", "syrup"), link("latte", "size"), link("latte", "old"), link("crepe", "topping")];
const PRODUCT_OPTIONS: ProductModifierOption[] = [
  { id: "latte-soy", productId: "latte", optionId: "soy", priceDeltaOverride: 1.5, active: true },
  { id: "latte-almond", productId: "latte", optionId: "almond", active: false },
];
const INVENTORY: InventoryLink[] = [{ id: "inv-caramel", optionId: "caramel", itemName: "caramel", quantityOnHand: 0, trackInventory: true, active: true }];
/** With oat milk there is no hazelnut syrup. */
const RULES: BusinessRule[] = [
  { id: "r1", name: "oat-no-hazelnut", enabled: true, priority: 1, conditions: [{ type: "option_selected", optionId: "oat" }], actions: [{ type: "hide_option", optionId: "hazelnut" }], createdAt: "", updatedAt: "" },
];

const config = (productId: string) =>
  buildProductBuilderConfig({
    productId, groups: GROUPS, options: OPTIONS, productGroups: LINKS.filter((l) => l.productId === productId),
    productOptions: PRODUCT_OPTIONS.filter((p) => p.productId === productId), rules: RULES, suggestions: [], inventory: INVENTORY,
  });
const LATTE = config("latte");
const pick = (...entries: [string, string, number?][]): RequestedModifier[] => entries.map(([groupId, optionId, quantity]) => ({ groupId, optionId, quantity: quantity ?? 1 }));
const price = (mods: RequestedModifier[], cfg = LATTE) => priceLineModifiers(cfg, mods, { productId: cfg.productId }, "he");

describe("add-on prices come from the catalog", () => {
  it("price, names and kitchen note from the product's groups", () => {
    const result = price(pick(["milk", "oat"], ["syrup", "vanilla"]));
    expect(result).toEqual({
      ok: true,
      extras: 5,
      modifiers: [
        { groupId: "milk", groupName: "חלב", optionId: "oat", optionName: "oat-he", priceDelta: 3, quantity: 1, kitchenNote: "oat milk" },
        { groupId: "syrup", groupName: "סירופ", optionId: "vanilla", optionName: "vanilla-he", priceDelta: 2, quantity: 1 },
      ],
    });
  });

  it("the product's own price for an option wins (override)", () => {
    expect(price(pick(["milk", "soy"]))).toMatchObject({ ok: true, extras: 1.5 });
  });

  it("names follow the order language", () => {
    const result = priceLineModifiers(LATTE, pick(["milk", "oat"]), { productId: "latte" }, "en");
    expect(result.ok && result.modifiers[0]).toMatchObject({ groupName: "חלב-en", optionName: "oat-en" });
  });

  it("the same option twice counts once with both quantities", () => {
    expect(price(pick(["syrup", "vanilla"], ["syrup", "vanilla"]))).toMatchObject({ ok: true, extras: 4, modifiers: [{ optionId: "vanilla", quantity: 2 }] });
  });

  it("nothing chosen: no add-ons, even for a product without groups", () => {
    expect(priceLineModifiers(undefined, [], { productId: "x" }, "he")).toEqual({ ok: true, modifiers: [], extras: 0 });
  });

  it("a required group left empty is not refused (assistant and quick add skip the add-on window)", () => {
    expect(price([]).ok).toBe(true);
    expect(price(pick(["milk", "oat"])).ok).toBe(true);
  });
});

describe("add-ons that are refused", () => {
  const refused = (mods: RequestedModifier[], cfg = LATTE) => {
    const r = price(mods, cfg);
    return r.ok ? "accepted" : r.reason;
  };

  it("an option that does not exist, or is in another group", () => {
    expect(refused(pick(["milk", "nope"]))).toBe("unknown_option");
    expect(refused(pick(["syrup", "oat"]))).toBe("unknown_option");
    expect(refused(pick(["nope", "oat"]))).toBe("unknown_option");
  });

  it("an option of another product's group", () => {
    expect(refused(pick(["topping", "nutella"]))).toBe("unknown_option");
    expect(refused(pick(["milk", "oat"]), config("crepe"))).toBe("unknown_option");
  });

  it("archived option, switched-off group, option switched off for this product", () => {
    expect(refused(pick(["milk", "retired"]))).toBe("unknown_option");
    expect(refused(pick(["old", "ghost"]))).toBe("unknown_option");
    expect(refused(pick(["milk", "almond"]))).toBe("unknown_option");
  });

  it("out of stock", () => {
    expect(refused(pick(["syrup", "caramel"]))).toBe("unavailable");
  });

  it("hidden by a rule for this choice", () => {
    expect(refused(pick(["syrup", "hazelnut"]))).toBe("accepted");
    expect(refused(pick(["milk", "oat"], ["syrup", "hazelnut"]))).toBe("unknown_option");
  });

  it("over the group's limit", () => {
    expect(refused(pick(["milk", "oat"], ["milk", "soy"]))).toBe("too_many");
    expect(refused(pick(["milk", "oat", 2]))).toBe("too_many");
    expect(refused(pick(["syrup", "vanilla"], ["syrup", "hazelnut"], ["syrup", "vanilla"]))).toBe("too_many");
  });

  it("a broken quantity", () => {
    expect(refused([{ groupId: "milk", optionId: "oat", quantity: 0 }])).toBe("unknown_option");
    expect(refused([{ groupId: "milk", optionId: "oat", quantity: Number.NaN }])).toBe("unknown_option");
  });

  it("any add-on on a product without groups", () => {
    expect(refused(pick(["milk", "oat"]), config("tea"))).toBe("unknown_option");
    expect(priceLineModifiers(undefined, pick(["milk", "oat"]), { productId: "tea" }, "he")).toEqual({ ok: false, reason: "unknown_option" });
  });
});

describe("the order on the server", () => {
  const PRODUCTS = new Map<string, CatalogProduct | undefined>([
    ["latte", { price: 16, nameHe: "לאטה", nameEn: "Latte", available: true }],
    ["crepe", { price: 38, nameHe: "קרפ", nameEn: "Crepe", available: true }],
  ]);
  const CONFIGS = new Map([["latte", LATTE], ["crepe", config("crepe")]]);
  const NOON = localToDate({ year: 2026, month: 11, day: 24 }, 12 * 60);
  const order = (items: CreateOrderRequest["items"]) =>
    buildServerOrder(
      { items, customer: { name: "דנה", phone: "050-1234567" }, locale: "he", payment: "counter", fulfillment: { type: "pickup" } } as CreateOrderRequest,
      { products: PRODUCTS, modifierConfigs: CONFIGS, fulfillment: DEFAULT_FULFILLMENT, openingHours: DEFAULT_OPENING_HOURS, now: NOON, orderNumber: "MC-2026-TEST0001" }
    );

  it("ignores every price the browser sends", () => {
    const result = order([
      { productId: "latte", quantity: 2, modifiers: [{ groupId: "milk", groupName: "x", optionId: "oat", optionName: "x", priceDelta: -16, quantity: 1, kitchenNote: "free!" }] },
      { productId: "crepe", quantity: 1, modifiers: [{ groupId: "topping", optionId: "nutella", quantity: 1 }] },
    ] as CreateOrderRequest["items"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.items[0]).toMatchObject({ price: 19, basePrice: 16, kitchenNotes: ["oat-he: oat milk"] });
    expect(result.order.items[0]!.modifiers).toEqual([{ groupId: "milk", groupName: "חלב", optionId: "oat", optionName: "oat-he", priceDelta: 3, quantity: 1, kitchenNote: "oat milk" }]);
    expect(result.order.items[1]).toMatchObject({ price: 44 });
    expect(result.order.total).toBe(19 * 2 + 44);
  });

  it("refuses an order with an add-on that is not on the product, naming the products", () => {
    const result = order([
      { productId: "latte", quantity: 1, modifiers: [{ groupId: "milk", optionId: "made-up", quantity: 1 }] },
      { productId: "crepe", quantity: 1, modifiers: [{ groupId: "milk", optionId: "oat", quantity: 1 }] },
    ] as CreateOrderRequest["items"]);
    expect(result).toEqual({ ok: false, error: { code: "OPTIONS_UNAVAILABLE", productNames: ["לאטה", "קרפ"] } });
  });

  it("refuses an add-on that ran out", () => {
    const result = order([{ productId: "latte", quantity: 1, modifiers: [{ groupId: "syrup", optionId: "caramel", quantity: 1 }] }] as CreateOrderRequest["items"]);
    expect(result).toEqual({ ok: false, error: { code: "OPTIONS_UNAVAILABLE", productNames: ["לאטה"] } });
  });

  it("an add-on that is still in the menu works with older carts (names/price sent as before)", () => {
    const result = order([
      { productId: "latte", quantity: 1, modifiers: [{ groupId: "milk", groupName: "חלב", optionId: "oat", optionName: "שיבולת", priceDelta: 3, quantity: 1 }] },
    ] as CreateOrderRequest["items"]);
    expect(result.ok && result.order.total).toBe(19);
  });
});

// ---- the server loader, with an in-memory Firestore stand-in ----
type Doc = Record<string, unknown>;
function fakeDb(data: Record<string, Record<string, Doc>>) {
  const reads: string[] = [];
  const snap = (col: string, id: string) => ({ id, exists: id in (data[col] ?? {}), data: () => data[col]?.[id] });
  const db = {
    collection: (col: string) => ({
      doc: (id: string) => ({ col, id }),
      where: (field: string, op: string, values: string[]) => {
        if (op !== "in" || values.length > 30) throw new Error(`bad query ${col}.${field} ${op} ${values.length}`);
        return {
          get: async () => {
            reads.push(`${col}:${field}`);
            const docs = Object.entries(data[col] ?? {}).filter(([, d]) => values.includes(d[field] as string)).map(([id]) => snap(col, id));
            return { docs };
          },
        };
      },
      get: async () => {
        reads.push(`${col}:all`);
        return { docs: Object.keys(data[col] ?? {}).map((id) => snap(col, id)) };
      },
    }),
    getAll: async (...refs: { col: string; id: string }[]) => refs.map((r) => snap(r.col, r.id)),
  };
  return { db: db as unknown as Firestore, reads };
}

describe("loading the add-on groups on the server", () => {
  const firestoreGroup = (name: string, over: Doc = {}) => ({ nameHe: name, nameAr: name, nameEn: name, selectionType: "single", requirement: "optional", minSelections: 0, maxSelections: 1, displayType: "buttons", sortOrder: 1, active: true, ...over });
  const firestoreOption = (groupId: string, priceDelta: number, over: Doc = {}) => ({ groupId, nameHe: "x", nameAr: "x", nameEn: "x", priceDelta, sortOrder: 1, active: true, ...over });

  it("builds each product's groups like the menu does", async () => {
    const { db } = fakeDb({
      product_modifier_groups: { l1: { productId: "latte", groupId: "milk", sortOrder: 1, active: true }, l2: { productId: "crepe", groupId: "topping", sortOrder: 1, active: true } },
      modifier_groups: { milk: firestoreGroup("חלב"), topping: firestoreGroup("תוספת") },
      modifier_options: { oat: firestoreOption("milk", 3), soy: firestoreOption("milk", 2), nutella: firestoreOption("topping", 6) },
      product_modifier_options: { o1: { productId: "latte", optionId: "soy", priceDeltaOverride: 1, active: true } },
      business_rules: {},
      inventory_links: { i1: { optionId: "nutella", itemName: "n", quantityOnHand: 0, trackInventory: true, active: true } },
    });
    const configs = await loadModifierConfigs(db, ["latte", "crepe", "tea"]);
    expect([...configs.keys()]).toEqual(["latte", "crepe", "tea"]);
    expect(configs.get("latte")!.groups.map((g) => [g.group.id, g.options.map((o) => [o.id, o.effectivePriceDelta])])).toEqual([["milk", [["oat", 3], ["soy", 1]]]]);
    expect(configs.get("crepe")!.groups[0]!.options[0]).toMatchObject({ id: "nutella", inStock: false });
    expect(configs.get("tea")!.groups).toEqual([]);
  });

  it("a product with no groups needs one read only", async () => {
    const { db, reads } = fakeDb({ product_modifier_groups: {} });
    const configs = await loadModifierConfigs(db, ["tea"]);
    expect(configs.get("tea")!.groups).toEqual([]);
    expect(reads).toEqual(["product_modifier_groups:productId"]);
  });

  it("splits long lists into queries of 30 (Firestore limit)", async () => {
    const ids = Array.from({ length: 61 }, (_, i) => `p${i}`);
    const { db, reads } = fakeDb({ product_modifier_groups: {} });
    await loadModifierConfigs(db, ids);
    expect(reads.length).toBe(3);
  });
});

describe("wiring", () => {
  it("order creation loads the add-on groups on the server", () => {
    expect(read("src/app/api/orders/create/route.ts")).toContain("loadModifierConfigs: (ids) => loadModifierConfigs(db, ids)");
    expect(read("src/lib/orders/create-order-handler.ts")).toContain("modifierConfigs,");
  });

  it("the card charge (HYP) prices add-ons from the catalog, not from the order's stored prices", () => {
    const hyp = read("src/lib/payments/hyp/process.ts");
    expect(hyp).toContain("loadModifierConfigs(db, productIds)");
    expect(hyp).toContain("priceLineModifiers(");
    expect(hyp).not.toMatch(/stored\s*-\s*base/);
  });

  it("the checkout explains a refused add-on in three languages", () => {
    expect(read("src/app/checkout/page.tsx")).toContain('"OPTIONS_UNAVAILABLE"');
    expect(read("src/data/ui-translations-seed.ts").split('"checkout.optionsUnavailable":').length - 1).toBe(3);
  });
});
