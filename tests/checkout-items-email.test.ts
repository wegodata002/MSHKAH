import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { localToDate } from "@/lib/fulfillment/availability";
import { handleCreateOrder, type CreateOrderDeps } from "@/lib/orders/create-order-handler";
import type { CatalogProduct, ServerOrderDraft } from "@/lib/orders/server-order";
import { hashEmail } from "@/lib/loyalty/tokens";
import { loyaltyMemberIdForOrder } from "@/lib/loyalty/order-hook";
import { checkoutFingerprint } from "@/features/checkout/checkout-fingerprint";
import type { CartItem, Product } from "@/types";

/** Pure, in-memory — no Firebase, no network, no real clock. */
const TUE_NOON = localToDate({ year: 2026, month: 11, day: 24 }, 12 * 60);
const PRODUCTS = new Map<string, CatalogProduct>([["latte", { price: 16, nameHe: "לאטה", nameEn: "Latte", available: true }]]);

const REQUEST = {
  items: [{ productId: "latte", quantity: 2 }],
  customer: { name: "דנה", phone: "0501234567" },
  locale: "he" as const,
  payment: "online" as const,
  fulfillment: { type: "pickup" as const },
};

function deps(findClubMember?: CreateOrderDeps["findClubMember"]) {
  const saved: ServerOrderDraft[] = [];
  const d: CreateOrderDeps = {
    now: () => TUE_NOON,
    loadProducts: async (ids) => new Map(ids.map((id) => [id, PRODUCTS.get(id)])),
    loadModifierConfigs: async () => new Map(),
    loadContext: async () => ({ fulfillment: DEFAULT_FULFILLMENT, openingHours: DEFAULT_OPENING_HOURS }),
    rateLimit: async () => true,
    saveOrder: async (draft) => {
      saved.push(draft);
      return "order-1";
    },
    findClubMember,
  };
  return { d, saved };
}

describe("order without an email (the checkout no longer asks for one)", () => {
  it("a card order is created without any email", async () => {
    const { d, saved } = deps();
    const res = await handleCreateOrder(REQUEST, "", d);
    expect(res.status).toBe(200);
    expect(saved[0]!.paymentMethod).toBe("card");
    expect("customerEmail" in saved[0]!).toBe(false);
    expect("loyalty" in saved[0]!).toBe(false);
  });

  it("club member logged in on this device: member id on the order, their saved email for the receipt", async () => {
    const { d, saved } = deps(async () => ({ id: "member-7", email: " Dana@Example.com " }));
    await handleCreateOrder(REQUEST, "", d);
    expect(saved[0]!.loyalty).toEqual({ memberId: "member-7" });
    expect(saved[0]!.customerEmail).toBe("dana@example.com");
  });

  it("a club member without an email (future: name + phone only) still gets the member id", async () => {
    const { d, saved } = deps(async () => ({ id: "member-8", email: null }));
    await handleCreateOrder(REQUEST, "", d);
    expect(saved[0]!.loyalty).toEqual({ memberId: "member-8" });
    expect("customerEmail" in saved[0]!).toBe(false);
  });

  it("a club lookup failure never blocks the order", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, saved } = deps(async () => {
      throw new Error("firestore down");
    });
    const res = await handleCreateOrder(REQUEST, "", d);
    expect(res.status).toBe(200);
    expect("loyalty" in saved[0]!).toBe(false);
  });

  it("the member id is never taken from the request body", async () => {
    const { d, saved } = deps();
    await handleCreateOrder({ ...REQUEST, loyalty: { memberId: "someone-else" } } as unknown, "", d);
    expect("loyalty" in saved[0]!).toBe(false);
  });
});

describe("club points go to the member by id, not by email", () => {
  it("member id from the session wins; no email lookup at all", async () => {
    const lookup = vi.fn(async () => "by-email");
    expect(await loyaltyMemberIdForOrder({ loyalty: { memberId: "member-7" }, customerEmail: "x@y.com" }, lookup)).toBe("member-7");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("older orders without a member id still match by email", async () => {
    const lookup = vi.fn(async (hash: string) => (hash === hashEmail("dana@example.com") ? "member-1" : null));
    expect(await loyaltyMemberIdForOrder({ customerEmail: "dana@example.com" }, lookup)).toBe("member-1");
  });

  it("no member id and no email → nobody", async () => {
    const lookup = vi.fn(async () => "x");
    expect(await loyaltyMemberIdForOrder({}, lookup)).toBeNull();
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("a created-but-unpaid card order is forgotten when anything changes", () => {
  const product = { id: "latte" } as Product;
  const line = (patch: Partial<CartItem> = {}): CartItem => ({
    lineId: "l1",
    product,
    quantity: 2,
    unitPrice: 16,
    selections: [],
    ...patch,
  });
  const base = { items: [line()], couponCode: "", orderType: "pickup", zoneId: "", address: "", pickupTime: "12:15", payment: "card" };
  const fp = checkoutFingerprint(base);

  it("same input → same fingerprint", () => {
    expect(checkoutFingerprint({ ...base, items: [line()] })).toBe(fp);
  });

  it("removing an item, changing quantity / add-ons / notes, coupon, type, area, address, time or payment → different", () => {
    const changed = [
      { ...base, items: [] },
      { ...base, items: [line({ quantity: 1 })] },
      { ...base, items: [line({ selections: [{ groupId: "g", groupName: "g", optionId: "o", optionName: "o", priceDelta: 3, quantity: 1 }] })] },
      { ...base, items: [line({ notes: "חם" })] },
      { ...base, couponCode: "MISHKAT10" },
      { ...base, orderType: "delivery" },
      { ...base, zoneId: "ein" },
      { ...base, address: "רחוב 1" },
      { ...base, pickupTime: "12:30" },
      { ...base, payment: "cash" },
    ];
    for (const input of changed) expect(checkoutFingerprint(input)).not.toBe(fp);
  });
});

describe("checkout page", () => {
  const checkout = readFileSync(resolve(process.cwd(), "src/app/checkout/page.tsx"), "utf8");

  it("has no email field and no 'email required for card' rule", () => {
    expect(checkout).not.toMatch(/type="email"/);
    expect(checkout).not.toMatch(/checkout\.email/);
    expect(checkout).not.toMatch(/validation\.email/);
    expect(checkout).not.toMatch(/customerEmail:/);
  });

  it("each summary line has a remove button wired to the cart's removeItem", () => {
    expect(checkout).toMatch(/onRemove=\{\(\) => removeItem\(item\.lineId\)\}/);
    expect(checkout).toMatch(/data-remove-line/);
  });

  it("clears the pending order when the fingerprint changes", () => {
    expect(checkout).toMatch(/setPendingOrderId\(null\);\s*\}, \[orderFingerprint\]\)/);
  });
});
