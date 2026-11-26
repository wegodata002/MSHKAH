// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Timestamp } from "firebase-admin/firestore";
import { createFakeFirestore } from "./helpers/fake-firestore";
import {
  applyFavoritesChange,
  cleanFavoriteIds,
  MAX_FAVORITES,
  parseFavoritesChange,
} from "@/lib/loyalty/favorites";
import { isUnpaidCardOrder, selectMemberOrders, MEMBER_ORDERS_MAX } from "@/lib/loyalty/admin/member-orders";
import { mergeAccountOrders, type MyOrderItem } from "@/lib/orders/my-order-views";
import { readTrackingToken } from "@/lib/orders/tracking-token";
import { UI_TRANSLATIONS_SEED } from "@/data/ui-translations-seed";
import type { Order } from "@/types";

const fake = createFakeFirestore();
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fake.db }));
const { listMemberOrders } = await import("@/lib/loyalty/admin/member-orders");
const { changeMemberFavorites, dropDeletedFavorites } = await import("@/lib/loyalty/admin/member-favorites");
const db = fake.db as unknown as Parameters<typeof listMemberOrders>[0];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const NOW = new Date("2026-11-26T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("favourites on the account: rules", () => {
  it("valid ids only, no duplicates, at most 200", () => {
    expect(cleanFavoriteIds(["a", "a", "", "../x", 5, "b-1", "c_2"])).toEqual(["a", "b-1", "c_2"]);
    expect(cleanFavoriteIds(Array.from({ length: 250 }, (_, i) => `p${i}`))).toHaveLength(MAX_FAVORITES);
    expect(cleanFavoriteIds("nope")).toEqual([]);
  });

  it("add / remove / merge (the device's favourites at sign-in, without duplicates)", () => {
    expect(applyFavoritesChange(["a", "b"], { action: "add", id: "c" })).toEqual(["a", "b", "c"]);
    expect(applyFavoritesChange(["a", "b"], { action: "add", id: "a" })).toEqual(["b", "a"]);
    expect(applyFavoritesChange(["a", "b"], { action: "remove", id: "a" })).toEqual(["b"]);
    expect(applyFavoritesChange(["a", "b"], { action: "merge", ids: ["b", "c", "c"] })).toEqual(["a", "b", "c"]);
  });

  it("requests are checked", () => {
    expect(parseFavoritesChange({ action: "add", id: "latte" })).toEqual({ action: "add", id: "latte" });
    expect(parseFavoritesChange({ action: "add", id: "../x" })).toBeNull();
    expect(parseFavoritesChange({ action: "merge", ids: ["a", 1, "a"] })).toEqual({ action: "merge", ids: ["a"] });
    expect(parseFavoritesChange({ action: "merge", ids: Array.from({ length: 201 }, (_, i) => `p${i}`) })).toBeNull();
    expect(parseFavoritesChange({ action: "wipe" })).toBeNull();
    expect(parseFavoritesChange(null)).toBeNull();
  });
});

describe("member orders: what is shown", () => {
  const o = (id: string, daysAgo: number, extra: Partial<Order> = {}) =>
    ({ id, orderNumber: id, createdAt: new Date(NOW.getTime() - daysAgo * DAY).toISOString(), paymentMethod: "cash", paymentStatus: "pending", ...extra }) as Order;

  it("last 12 months, newest first, at most 100; an unpaid card order is left out", () => {
    const list = [o("old", 400), o("a", 3), o("b", 1), o("card-unpaid", 0, { paymentMethod: "card", paymentStatus: "pending" }), o("card-paid", 2, { paymentMethod: "card", paymentStatus: "paid" })];
    expect(selectMemberOrders(list, NOW).map((x) => x.id)).toEqual(["b", "card-paid", "a"]);
    expect(selectMemberOrders(Array.from({ length: 150 }, (_, i) => o(`n${i}`, i % 300)), NOW)).toHaveLength(MEMBER_ORDERS_MAX);
    expect(isUnpaidCardOrder({ paymentProvider: "HYP", paymentStatus: "failed" })).toBe(true);
    expect(isUnpaidCardOrder({ paymentMethod: "cash", paymentStatus: "pending" })).toBe(false);
  });

  it("account and device lists together: one entry per order, newest first", () => {
    const view = (n: string, at: string) => ({ orderNumber: n, createdAt: at }) as MyOrderItem["view"] & object;
    const account = [{ token: "T1", orderNumber: "1", view: view("1", "2026-11-25T10:00:00Z") }];
    const device: MyOrderItem[] = [
      { entry: { token: "T1", orderNumber: "1", savedAt: 1 }, view: null },
      { entry: { token: "T2", orderNumber: "2", savedAt: Date.parse("2026-11-26T09:00:00Z") }, view: null },
    ];
    expect(mergeAccountOrders(account, device).map((i) => i.entry.token)).toEqual(["T2", "T1"]);
  });
});

describe("member orders and favourites on the server (in-memory database)", () => {
  beforeEach(() => fake.reset());

  const order = (id: string, memberId: string | null, daysAgo: number) => ({
    orderNumber: `MC-${id}`,
    customerId: "cust",
    customerName: "דנה כהן",
    customerPhone: "0501234567",
    deliveryAddress: "הרצל 5",
    courierId: "Courier00000001",
    courierName: "סמיר",
    items: [{ productId: "latte", productName: "לאטה", quantity: 1, price: 16 }],
    status: "delivered",
    subtotal: 16,
    discount: 0,
    delivery: 15,
    total: 31,
    orderType: "delivery",
    paymentMethod: "cash",
    paymentStatus: "paid",
    createdAt: Timestamp.fromDate(new Date(NOW.getTime() - daysAgo * DAY)),
    ...(memberId ? { loyalty: { memberId } } : {}),
  });

  it("only this member's orders, each with a working tracking link, and no personal or courier details", async () => {
    fake.put("orders", "OrderA000000001", order("A", "Member0001", 1));
    fake.put("orders", "OrderB000000001", order("B", "Member0002", 1)); // another member
    fake.put("orders", "OrderC000000001", order("C", null, 1)); // placed while not signed in: not linked
    fake.put("orders", "OrderD000000001", order("D", "Member0001", 500)); // older than 12 months
    const list = await listMemberOrders(db, "Member0001", NOW);
    expect(list.map((x) => x.orderNumber)).toEqual(["MC-A"]);
    expect(readTrackingToken(list[0]!.token)).toBe("OrderA000000001");
    const json = JSON.stringify(list);
    for (const secret of ["דנה", "0501234567", "הרצל", "סמיר", "Courier00000001", "cust"]) expect(json).not.toContain(secret);
  });

  it("favourites: products deleted from the menu leave the account (hidden ones stay)", async () => {
    fake.put("products", "latte", { name: "לאטה", active: true });
    fake.put("products", "hidden1", { name: "מוסתר", active: false });
    fake.put("loyaltyMembers", "Member0001", { email: "a@b.c", favoriteProductIds: ["latte", "gone1", "hidden1", "gone2"] });
    expect(await dropDeletedFavorites(db, "Member0001", ["latte", "gone1", "hidden1", "gone2"])).toEqual(["latte", "hidden1"]);
    expect(fake.get("loyaltyMembers", "Member0001")!.favoriteProductIds).toEqual(["latte", "hidden1"]);
    // Nothing deleted: nothing written.
    expect(await dropDeletedFavorites(db, "Member0001", ["latte"])).toEqual(["latte"]);
  });

  it("favourites: merge once without duplicates, then add / remove", async () => {
    fake.put("loyaltyMembers", "Member0001", { email: "a@b.c", favoriteProductIds: ["latte"] });
    expect(await changeMemberFavorites(db, "Member0001", { action: "merge", ids: ["latte", "crepe"] })).toEqual(["latte", "crepe"]);
    expect(await changeMemberFavorites(db, "Member0001", { action: "remove", id: "latte" })).toEqual(["crepe"]);
    expect(fake.get("loyaltyMembers", "Member0001")!.favoriteProductIds).toEqual(["crepe"]);
  });
});

describe("routes and screens", () => {
  it("both routes identify the member only by the signed club cookie", () => {
    for (const p of ["src/app/api/club/orders/route.ts", "src/app/api/club/favorites/route.ts"]) {
      const route = read(p);
      expect(route).toContain("request.cookies.get(CLUB_COOKIE_NAME)");
      expect(route).toContain("isClubMember(member.status)");
      expect(route).not.toMatch(/memberId\s*[:=]\s*body|searchParams/);
      expect(route).toContain("no-store, private");
    }
    expect(read("src/app/api/club/favorites/route.ts")).toContain("consumeRateLimit");
    expect(read("firestore.rules")).not.toContain("favoriteProductIds");
  });

  it("favourites: account only while signed in; device favourites merged once then removed from the device", () => {
    const hook = read("src/hooks/useFavorites.ts");
    expect(hook).toContain('postChange({ action: "merge", ids: onDevice })');
    expect(hook).toContain("window.localStorage.removeItem(STORAGE_KEY)");
    expect(hook).toContain("if (getSnapshot().account) return;");
    // Deleted or hidden products just drop out of the page (no error).
    expect(read("src/features/favorites/favorites-screen.tsx")).toContain("favorites.has(p.id) && isPublicMenuProduct(p)");
  });

  it("♡ count stays right: the server drops deleted products (read and merge); the device on the Favourites page", () => {
    const route = read("src/app/api/club/favorites/route.ts");
    expect(route).toContain("await dropDeletedFavorites(found.db, found.member.id, cleanFavoriteIds(found.member.favoriteProductIds))");
    expect(route).toContain('change.action === "merge" ? await dropDeletedFavorites(');
    const screen = read("src/features/favorites/favorites-screen.tsx");
    expect(screen).toContain("if (loading || error || usingFallback || !checked || account || raw.length === 0) return;");
    expect(screen).toContain("getDoc(doc(getDb(), COLLECTIONS.products, id))");
    expect(screen).toContain("dropDeviceFavorites(deleted)");
    // The header does not load the menu for the count.
    expect(read("src/components/layout/header.tsx")).not.toContain("useProducts");
  });

  it("sign-out forgets the account's orders kept for the tab", () => {
    expect(read("src/app/club/me/page.tsx")).toContain("forgetClubOrders();");
  });

  it("new texts in Hebrew, Arabic and English", () => {
    for (const key of ["myOrders.allDevices", "myOrders.keptMonths", "favorites.savedInAccount", "clubInvite.text", "clubInvite.join"]) {
      for (const locale of ["he", "ar", "en"] as const) expect(UI_TRANSLATIONS_SEED[locale][key], `${locale} ${key}`).toBeTruthy();
    }
    expect(UI_TRANSLATIONS_SEED.he["myOrders.allDevices"]).toBe("ההזמנות מכל המכשירים שלך");
  });
});
