import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cartReducer } from "@/features/cart/cart-context";
import type { CartItem, Product } from "@/types";
import type { SelectedModifier } from "@/types/modifiers";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
type State = Parameters<typeof cartReducer>[0];

function product(id: string): Product {
  return {
    id,
    name_he: id,
    name_ar: id,
    name_en: id,
    description_he: "",
    description_ar: "",
    description_en: "",
    categoryId: "cat",
    price: 14,
    cost: 0,
    profit: 0,
    businessType: "food",
    image: "",
    isPopular: false,
    isNew: false,
    available: true,
    active: true,
    sortOrder: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const oat: SelectedModifier = {
  groupId: "milk",
  groupName: "Milk",
  optionId: "oat",
  optionName: "Oat milk",
  priceDelta: 3,
  quantity: 1,
} as SelectedModifier;

function line(lineId: string, overrides: Partial<CartItem> = {}): CartItem {
  return { lineId, product: product("cappuccino"), quantity: 1, selections: [], unitPrice: 14, ...overrides };
}

const state = (items: CartItem[]): State => ({ items, isOpen: false, couponCode: "", couponDiscount: 0 });

describe("editing a cart line", () => {
  it("saves add-ons, quantity and note on the same line", () => {
    const next = cartReducer(state([line("a"), line("b", { product: product("latte") })]), {
      type: "UPDATE_CONFIGURED_ITEM",
      lineId: "a",
      selections: [oat],
      unitPrice: 17,
      quantity: 2,
      notes: "very hot",
    });
    expect(next.items).toHaveLength(2);
    expect(next.items[0]).toMatchObject({ lineId: "a", selections: [oat], unitPrice: 17, quantity: 2, notes: "very hot" });
    expect(next.items[1]?.lineId).toBe("b");
  });

  it("merges into one line when the edit makes it the same as another line", () => {
    const items = [
      line("plain", { quantity: 1 }),
      line("with-oat", { quantity: 2, selections: [oat], unitPrice: 17 }),
    ];
    // Add oat milk to the plain one → same product, add-ons and note as "with-oat".
    const next = cartReducer(state(items), {
      type: "UPDATE_CONFIGURED_ITEM",
      lineId: "plain",
      selections: [oat],
      unitPrice: 17,
      quantity: 1,
      notes: undefined,
    });
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({ lineId: "plain", quantity: 3, unitPrice: 17 });
  });

  it("a different note keeps the lines apart", () => {
    const items = [line("a"), line("b", { notes: "no sugar" })];
    const next = cartReducer(state(items), {
      type: "UPDATE_CONFIGURED_ITEM",
      lineId: "a",
      selections: [],
      unitPrice: 14,
      quantity: 3,
      notes: "extra hot",
    });
    expect(next.items.map((i) => [i.lineId, i.quantity, i.notes])).toEqual([
      ["a", 3, "extra hot"],
      ["b", 1, "no sugar"],
    ]);
  });

  it("ignores a line that is no longer in the cart", () => {
    const before = state([line("a")]);
    const next = cartReducer(before, {
      type: "UPDATE_CONFIGURED_ITEM",
      lineId: "gone",
      selections: [],
      unitPrice: 14,
      quantity: 2,
      notes: undefined,
    });
    expect(next).toBe(before);
  });
});

describe("pen next to the bin", () => {
  it("checkout summary, assistant cart and cart drawer all use the shared editor", () => {
    for (const file of [
      "src/app/checkout/page.tsx",
      "src/features/assistant/assistant-parts.tsx",
      "src/features/cart/cart-panel.tsx",
    ]) {
      const src = read(file);
      expect(src, file).toMatch(/useCartLineEditor\(\)/);
      expect(src, file).toMatch(/<EditLineButton/);
    }
    // Cart drawer: pen on every line (no longer only lines with add-ons).
    expect(read("src/features/cart/cart-panel.tsx")).toMatch(/onEdit=\{edit\}/);
  });

  it("the product window has an edit mode that updates the line", () => {
    const drawer = read("src/features/catalog/product-detail-drawer.tsx");
    expect(drawer).toMatch(/editItem\?: CartItem \| null/);
    expect(drawer).toMatch(/updateConfiguredItem\(editItem\.lineId/);
    expect(drawer).toMatch(/initialSelections=\{editItem\?\.selections\}/);
    expect(drawer).toMatch(/t\("builder\.saveChanges"\)/);
  });
});

describe("catalog page", () => {
  it("status line on /catalog too; the big banner stays on the home page only", () => {
    const view = read("src/features/catalog/catalog-view.tsx");
    expect(view).toMatch(/\{isHome && <HeroBanner \/>\}/);
    // On every catalog page (home and /catalog); only the table strip takes its place.
    expect(view).toContain("{atTable ? <TableBanner /> : <AvailabilityPill />}");
    expect(view).not.toMatch(/isHome && <AvailabilityPill/);
  });
});

describe("admin QR page", () => {
  it("two cards in two columns, labels in three languages", () => {
    const grid = read("src/features/admin/qr-links-admin.tsx");
    expect(grid).toMatch(/grid max-w-4xl gap-5 md:grid-cols-2/);
    const tr = read("src/data/admin-translations.ts");
    expect(tr.match(/"admin\.qr\.menuPageName":/g)).toHaveLength(3);
    expect(tr).not.toMatch(/"admin\.qr\.orderName"/);
  });
});
