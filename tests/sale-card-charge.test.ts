// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeFirestore } from "./helpers/fake-firestore";
import { buildServerOrder, type CatalogProduct, type CreateOrderRequest } from "@/lib/orders/server-order";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";

/**
 * The card charge (HYP) is worked out again on the server from the catalog. It must use the sale
 * price while a sale is on (Admin → Sales), exactly as the order route priced the order; after the
 * sale, the regular price. Before this fix it always used the regular price.
 */
const fake = createFakeFirestore();
const pages: Array<{ amount: string }> = [];
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fake.db }));
vi.mock("@/lib/payments/hyp/config", () => ({ isHypConfigured: () => true, HypConfigError: class extends Error {} }));
vi.mock("@/lib/payments/hyp/client", () => ({
  createHypPaymentPage: async (input: { amount: string }) => {
    pages.push(input);
    return "https://pay.example/redirect";
  },
  verifyHypRedirect: async () => ({ ok: false }),
}));
vi.mock("@/lib/payments/hyp/pipeline", () => ({ runPaidPostPaymentTasks: async () => {}, runFailedPostPaymentTasks: async () => {} }));
vi.mock("@/lib/orders/admin-modifier-config", () => ({ loadModifierConfigs: async () => new Map() }));
vi.mock("@/lib/orders/server-context", () => ({ loadFulfillmentContext: async () => ({ fulfillment: DEFAULT_FULFILLMENT, openingHours: DEFAULT_OPENING_HOURS }) }));

const { createHypPaymentAttempt } = await import("@/lib/payments/hyp/process");

const START = "2026-11-24T08:00:00.000Z";
const END = "2026-11-30T21:59:00.000Z";
const LATTE: CatalogProduct = { price: 18, nameHe: "לאטה", available: true, sales: [{ saleId: "SaleWeek01", kind: "percent", value: 20, startsAt: START, endsAt: END }] };
const TEA: CatalogProduct = { price: 12, nameHe: "תה", available: true };

/** The order as the order route saves it (priced on the server at `at`). */
function savedOrder(at: Date, couponCode?: string) {
  const built = buildServerOrder(
    {
      items: [{ productId: "latte", quantity: 2 }, { productId: "tea", quantity: 1 }],
      customer: { name: "דנה", phone: "0501234567" },
      locale: "he",
      payment: "online",
      fulfillment: { type: "pickup" },
      ...(couponCode ? { couponCode } : {}),
    } as CreateOrderRequest,
    { products: new Map([["latte", LATTE], ["tea", TEA]]), modifierConfigs: new Map(), fulfillment: DEFAULT_FULFILLMENT, openingHours: DEFAULT_OPENING_HOURS, now: at, orderNumber: "MC-2026-SALE0001", storeCoupon: null }
  );
  if (!built.ok) throw new Error(`order not built: ${JSON.stringify(built.error)}`);
  return built.order;
}

beforeEach(() => {
  fake.reset();
  pages.length = 0;
  fake.put("products", "latte", LATTE as Record<string, unknown>);
  fake.put("products", "tea", TEA as Record<string, unknown>);
  vi.useFakeTimers({ toFake: ["Date"] });
});

describe("card charge with a sale", () => {
  it("during the sale: the card is charged the sale price, the same as the order", async () => {
    const during = new Date("2026-11-25T10:00:00Z");
    vi.setSystemTime(during);
    const order = savedOrder(during);
    expect(order.total).toBe(40.8); // 2 × ₪14.40 + ₪12
    fake.put("orders", "Order0001", order as unknown as Record<string, unknown>);
    await createHypPaymentAttempt("Order0001");
    expect(pages[0]!.amount).toBe("40.80");
    const saved = (await fake.db.collection("orders").doc("Order0001").get()).data()!;
    expect(saved.total).toBe(40.8); // not rewritten to the regular price (₪48)
    const [payment] = (await fake.db.collection("payments").get()).docs;
    expect(payment!.data()).toMatchObject({ amount: 40.8, expectedAmount: 40.8 });
  });

  it("after the sale ended: the regular price (the charge never trusts a price written on the order)", async () => {
    const after = new Date("2026-12-01T10:00:00Z");
    vi.setSystemTime(after);
    // An order claiming the sale price after the sale is over is charged the regular price.
    const forged = { ...savedOrder(new Date("2026-11-25T10:00:00Z")) };
    fake.put("orders", "Order0002", forged as unknown as Record<string, unknown>);
    await createHypPaymentAttempt("Order0002");
    expect(pages[0]!.amount).toBe("48.00");
    expect((await fake.db.collection("orders").doc("Order0002").get()).data()!.total).toBe(48);
  });

  it("no sale on the products: as before", async () => {
    vi.setSystemTime(new Date("2026-11-25T10:00:00Z"));
    fake.put("products", "latte", { price: 18, nameHe: "לאטה", available: true });
    const order = savedOrder(new Date("2026-11-25T10:00:00Z"));
    fake.put("orders", "Order0003", { ...order, items: order.items.map((i) => ({ ...i, price: i.productId === "latte" ? 18 : i.price })), total: 48 } as unknown as Record<string, unknown>);
    await createHypPaymentAttempt("Order0003");
    expect(pages[0]!.amount).toBe("48.00");
  });
});
