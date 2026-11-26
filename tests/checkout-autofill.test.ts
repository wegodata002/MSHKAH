import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { localToDate } from "@/lib/fulfillment/availability";
import { handleCreateOrder, type CreateOrderDeps } from "@/lib/orders/create-order-handler";
import type { CatalogProduct, ServerOrderDraft } from "@/lib/orders/server-order";
import {
  cleanDetails,
  detailsFromOrder,
  fillableFields,
  mergeDetails,
  parseSavedDetails,
  SAVED_DETAILS_TTL_MS,
  valuesToFill,
  type FillField,
} from "@/lib/customers/checkout-details";
import { memberCheckoutDetails, memberCheckoutUpdate } from "@/lib/loyalty/admin/checkout-details";

const WAZE = "https://waze.com/ul?ll=32.9,35.3";
const EMPTY = { name: "", phone: "", zoneId: "", address: "", locationUrl: "" };
const SAVED = { name: "דנה", phone: "0501234567", zoneId: "z1", address: "הרצל 5", locationUrl: WAZE };

describe("checkout details: what an order leaves behind", () => {
  it("phone is kept clean (0501234567), from +972 too", () => {
    expect(detailsFromOrder({ name: "דנה", phone: "+972 50-123-4567", orderType: "pickup" })).toEqual({
      name: "דנה",
      phone: "0501234567",
    });
  });

  it("address, area and link only from a delivery order", () => {
    const pickup = detailsFromOrder({ name: "דנה", phone: "0501234567", orderType: "pickup", zoneId: "z1", address: "x" });
    expect(pickup).toEqual({ name: "דנה", phone: "0501234567" });
    const delivery = detailsFromOrder({ ...SAVED, orderType: "delivery" });
    expect(delivery).toEqual(SAVED);
  });

  it("a pickup order keeps the last address; a delivery without a link drops the old link", () => {
    const pickup = detailsFromOrder({ name: "דנה", phone: "0521111111", orderType: "pickup" });
    expect(mergeDetails(SAVED, pickup, false)).toEqual({ ...SAVED, phone: "0521111111" });
    const noLink = detailsFromOrder({ name: "דנה", phone: "0501234567", orderType: "delivery", zoneId: "z2", address: "בן גוריון 1" });
    const merged = mergeDetails(SAVED, noLink, true);
    expect(merged.address).toBe("בן גוריון 1");
    expect(merged.zoneId).toBe("z2");
    expect(merged.locationUrl).toBeUndefined();
  });

  it("malformed values are dropped, never trusted", () => {
    expect(cleanDetails({ name: 5, phone: "abc", locationUrl: "https://evil.example/x", address: "" })).toEqual({});
  });
});

describe("checkout details on this device: 180 days", () => {
  const now = Date.UTC(2026, 10, 26);
  it("kept 180 days after the last order, then gone", () => {
    expect(parseSavedDetails({ ...SAVED, savedAt: now - (SAVED_DETAILS_TTL_MS - 1000) }, now)).toEqual(SAVED);
    expect(parseSavedDetails({ ...SAVED, savedAt: now - SAVED_DETAILS_TTL_MS }, now)).toBeNull();
    expect(parseSavedDetails({ ...SAVED }, now)).toBeNull();
    expect(parseSavedDetails("junk", now)).toBeNull();
  });
});

describe("filling the checkout", () => {
  const none = new Set<FillField>();
  it("order type decides the fields: table = name only, pickup = name + phone, delivery = all", () => {
    expect(fillableFields("dine_in")).toEqual(["name"]);
    expect(fillableFields("pickup")).toEqual(["name", "phone"]);
    expect(fillableFields("delivery")).toEqual(["name", "phone", "zoneId", "address", "locationUrl"]);
    expect(valuesToFill(SAVED, EMPTY, "dine_in", ["z1"], none).fill).toEqual({ name: "דנה" });
    expect(valuesToFill(SAVED, EMPTY, "pickup", ["z1"], none).fill).toEqual({ name: "דנה", phone: "0501234567" });
    expect(valuesToFill(SAVED, EMPTY, "delivery", ["z1"], none).fill).toEqual(SAVED);
  });

  it("only empty fields are filled", () => {
    const { fill } = valuesToFill(SAVED, { ...EMPTY, name: "רנא", address: "אחר" }, "delivery", ["z1"], none);
    expect(fill).toEqual({ phone: "0501234567", zoneId: "z1", locationUrl: WAZE });
  });

  it("an area deleted from the settings: the address only", () => {
    const { fill } = valuesToFill(SAVED, EMPTY, "delivery", ["z9"], none);
    expect(fill.zoneId).toBeUndefined();
    expect(fill.address).toBe("הרצל 5");
  });

  it("each field once: a field the customer emptied is not filled again", () => {
    const done = new Set<FillField>(["name", "phone"]);
    const { fill, considered } = valuesToFill(SAVED, EMPTY, "delivery", ["z1"], done);
    expect(fill.name).toBeUndefined();
    expect(considered).toEqual(["zoneId", "address", "locationUrl"]);
  });
});

describe("club member: details on the member (server)", () => {
  it("phone always; area/address/link only after a delivery; never the name", () => {
    const pickup = memberCheckoutUpdate({ orderType: "pickup", customerPhone: "0501234567" })!;
    expect(Object.keys(pickup).sort()).toEqual(["checkoutDetails.phone", "checkoutDetails.updatedAt"]);
    const delivery = memberCheckoutUpdate({
      orderType: "delivery",
      customerPhone: "0501234567",
      deliveryZoneId: "z1",
      deliveryAddress: "הרצל 5",
      deliveryLocationUrl: WAZE,
    })!;
    expect(delivery["checkoutDetails.address"]).toBe("הרצל 5");
    expect(delivery["checkoutDetails.zoneId"]).toBe("z1");
    expect(delivery["checkoutDetails.locationUrl"]).toBe(WAZE);
    expect(Object.keys(delivery).some((k) => k.includes("name"))).toBe(false);
    // Table order without a phone: nothing to keep.
    expect(memberCheckoutUpdate({ orderType: "dine_in", customerPhone: "" })).toBeNull();
  });

  it("read back: profile name, last phone (sign-up phone until a newer order), last delivery", () => {
    expect(memberCheckoutDetails({ displayName: "דנה כהן", phone: "052-1111111" })).toEqual({ name: "דנה כהן", phone: "0521111111" });
    expect(
      memberCheckoutDetails({ displayName: "דנה כהן", phone: "0521111111", checkoutDetails: { phone: "0501234567", address: "הרצל 5", zoneId: "z1" } })
    ).toEqual({ name: "דנה כהן", phone: "0501234567", address: "הרצל 5", zoneId: "z1" });
  });
});

describe("order route keeps the member's details only after the order is saved", () => {
  const TUE_NOON = localToDate({ year: 2026, month: 11, day: 24 }, 12 * 60);
  const PRODUCTS = new Map<string, CatalogProduct>([["latte", { price: 16, nameHe: "לאטה", nameEn: "Latte", available: true }]]);
  const REQUEST = {
    items: [{ productId: "latte", quantity: 1 }],
    customer: { name: "דנה", phone: "+972501234567" },
    locale: "he" as const,
    payment: "counter" as const,
    fulfillment: { type: "pickup" as const },
  };
  function deps(member: { id: string; status?: string } | null, saveFails = false) {
    const remembered: Array<{ memberId: string; order: ServerOrderDraft }> = [];
    const d: CreateOrderDeps = {
      now: () => TUE_NOON,
      loadProducts: async (ids) => new Map(ids.map((id) => [id, PRODUCTS.get(id)])),
      loadModifierConfigs: async () => new Map(),
      loadContext: async () => ({ fulfillment: DEFAULT_FULFILLMENT, openingHours: DEFAULT_OPENING_HOURS }),
      rateLimit: async () => true,
      saveOrder: async () => {
        if (saveFails) throw new Error("db down");
        return "order-1";
      },
      findClubMember: async () => member,
      rememberMemberCheckout: async (memberId, order) => {
        remembered.push({ memberId, order });
      },
    };
    return { d, remembered };
  }

  it("an active member: saved with the clean phone", async () => {
    const { d, remembered } = deps({ id: "m1", status: "active" });
    expect((await handleCreateOrder(REQUEST, "", d)).status).toBe(200);
    expect(remembered).toHaveLength(1);
    expect(remembered[0]!.memberId).toBe("m1");
    expect(remembered[0]!.order.customerPhone).toBe("0501234567");
  });

  it("no member, or a sign-up that never finished: nothing saved on the server", async () => {
    for (const member of [null, { id: "m2", status: "email_verified" }]) {
      const { d, remembered } = deps(member);
      await handleCreateOrder(REQUEST, "", d);
      expect(remembered).toHaveLength(0);
    }
  });

  it("the order was not saved: nothing kept", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { d, remembered } = deps({ id: "m1", status: "active" }, true);
    expect((await handleCreateOrder(REQUEST, "", d)).status).toBe(500);
    expect(remembered).toHaveLength(0);
  });

  it("saving the details fails: the order still succeeds", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { d } = deps({ id: "m1", status: "active" });
    d.rememberMemberCheckout = async () => {
      throw new Error("db down");
    };
    expect((await handleCreateOrder(REQUEST, "", d)).status).toBe(200);
  });
});

describe("wiring", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
  it("the details route answers only by the club cookie, never from the request", () => {
    const route = read("src/app/api/checkout/details/route.ts");
    expect(route).toContain("CLUB_COOKIE_NAME");
    expect(route).not.toMatch(/searchParams|request\.json/);
    expect(route).toContain("no-store");
  });
  it("checkout: device details only for non-members, no clear button, order type not chosen from saved details", () => {
    const page = read("src/app/checkout/page.tsx");
    expect(page).toContain("rememberDeviceDetails");
    expect(page).toContain("saved.member");
    expect(page).not.toMatch(/setOrderType\(fill|setOrderType\(saved/);
  });
});
