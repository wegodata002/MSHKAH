import { describe, expect, it } from "vitest";
import { cartReducer } from "@/features/cart/cart-context";
import type { CartItem, Product } from "@/types";

/** Pure reducer tests — no Firebase, no network, no React rendering. */
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
    price: 30,
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

function line(id: string, quantity = 1): CartItem {
  return { lineId: `line-${id}`, product: product(id), quantity, selections: [], unitPrice: 30 };
}

const empty: State = { items: [], isOpen: false, couponCode: "", couponDiscount: 0 };
const withCoupon = (items: CartItem[]): State => ({
  ...empty,
  items,
  couponCode: "MISHKAT10",
  couponDiscount: 0.1,
});

describe("cart coupon lifecycle (one order only)", () => {
  it("keeps the coupon when adding another product to the same order", () => {
    const next = cartReducer(withCoupon([line("latte")]), {
      type: "ADD_CONFIGURED_ITEM",
      product: product("cake"),
      selections: [],
      unitPrice: 30,
      quantity: 1,
    });
    expect(next.items).toHaveLength(2);
    expect(next.couponCode).toBe("MISHKAT10");
    expect(next.couponDiscount).toBe(0.1);
  });

  it("CLEAR_CART (cash success / HYP success page) clears the coupon", () => {
    const next = cartReducer(withCoupon([line("latte"), line("cake")]), { type: "CLEAR_CART" });
    expect(next.items).toHaveLength(0);
    expect(next.couponCode).toBe("");
    expect(next.couponDiscount).toBe(0);
  });

  it("removing the last item (or quantity 0) clears the coupon; removing one of several keeps it", () => {
    const two = withCoupon([line("latte"), line("cake")]);
    const one = cartReducer(two, { type: "REMOVE_ITEM", lineId: "line-cake" });
    expect(one.couponCode).toBe("MISHKAT10");

    const none = cartReducer(one, { type: "REMOVE_ITEM", lineId: "line-latte" });
    expect(none.items).toHaveLength(0);
    expect(none.couponCode).toBe("");
    expect(none.couponDiscount).toBe(0);

    const zero = cartReducer(withCoupon([line("latte")]), {
      type: "UPDATE_QUANTITY",
      lineId: "line-latte",
      quantity: 0,
    });
    expect(zero.items).toHaveLength(0);
    expect(zero.couponCode).toBe("");
    expect(zero.couponDiscount).toBe(0);
  });

  it("restoring an empty cart from storage does not restore its coupon", () => {
    const next = cartReducer(empty, {
      type: "HYDRATE",
      state: { items: [], couponCode: "MISHKAT10", couponDiscount: 0.1 },
    });
    expect(next.couponCode).toBe("");
    expect(next.couponDiscount).toBe(0);
  });

  it("REMOVE_COUPON clears the coupon and keeps the products", () => {
    const next = cartReducer(withCoupon([line("latte"), line("cake", 2)]), { type: "REMOVE_COUPON" });
    expect(next.couponCode).toBe("");
    expect(next.couponDiscount).toBe(0);
    expect(next.items.map((i) => [i.lineId, i.quantity])).toEqual([
      ["line-latte", 1],
      ["line-cake", 2],
    ]);
  });

  it("recomputes the rate on reload and drops forged rates / unknown codes", () => {
    const forged = cartReducer(empty, {
      type: "HYDRATE",
      state: { items: [line("latte")], couponCode: "MISHKAT10", couponDiscount: 0.99 },
    });
    expect(forged.couponCode).toBe("MISHKAT10");
    expect(forged.couponDiscount).toBe(0.1);

    const unknown = cartReducer(empty, {
      type: "HYDRATE",
      state: { items: [line("latte")], couponCode: "FREE100", couponDiscount: 1 },
    });
    expect(unknown.couponCode).toBe("");
    expect(unknown.couponDiscount).toBe(0);
  });
});
