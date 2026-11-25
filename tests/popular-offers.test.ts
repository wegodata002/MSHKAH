// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Firestore } from "firebase-admin/firestore";
import {
  countsAsSale,
  mergePopular,
  popularIdSet,
  rankByUnits,
  unitsSold,
  POPULAR_MIN_UNITS,
  POPULAR_REFRESH_MS,
  POPULAR_WINDOW_DAYS,
} from "@/lib/catalog/popularity";
import { getPopularity } from "@/lib/catalog/admin/popularity-store";
import { moveOffer, orderOfferProducts } from "@/lib/catalog/offers";
import { topPopular, withPopularity } from "@/hooks/usePopularity";
import { applyDisplayFilters } from "@/lib/menu/category-tree";
import { processQuickAction } from "@/lib/assistant/engine";
import { buildAssistantContext } from "@/lib/assistant/build-context";
import { DEFAULT_ASSISTANT_CONFIG } from "@/lib/assistant/types";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { isCustomerOnlyPath, isOrderingPath } from "@/lib/domains/host-routing";
import type { Category, Product } from "@/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function product(id: string, patch: Partial<Product> = {}): Product {
  return {
    id, name_he: `מוצר ${id}`, name_ar: `منتج ${id}`, name_en: `Product ${id}`, description_he: "", description_ar: "", description_en: "",
    categoryId: "desserts", price: 20, cost: 0, profit: 0, businessType: "cafe", image: "", isPopular: false, isNew: false,
    available: true, active: true, sortOrder: 0, createdAt: "2026-01-01", updatedAt: "2026-01-01", ...patch,
  } as Product;
}
const order = (status: string, paymentStatus: string, items: [string, number][], extra: Record<string, unknown> = {}) => ({
  status, paymentStatus, items: items.map(([productId, quantity]) => ({ productId, quantity })), ...extra,
});

describe("what counts as a sale", () => {
  it("paid or completed; never cancelled, test, failed or refunded", () => {
    expect(countsAsSale(order("pending", "paid", []))).toBe(true);
    expect(countsAsSale(order("delivered", "pending", []))).toBe(true); // cash pickup completed, never marked paid
    expect(countsAsSale(order("completed", "pending", []))).toBe(true);
    expect(countsAsSale(order("pending", "pending", []))).toBe(false); // card not paid / still open
    expect(countsAsSale(order("cancelled", "paid", []))).toBe(false);
    expect(countsAsSale(order("delivered", "refunded", []))).toBe(false);
    expect(countsAsSale(order("delivered", "failed", []))).toBe(false);
    expect(countsAsSale(order("delivered", "paid", [], { isTestOrder: true }))).toBe(false);
  });

  it("units per product, best sellers first", () => {
    const units = unitsSold([
      order("delivered", "paid", [["latte", 2], ["crepe", 1]]),
      order("pending", "paid", [["latte", 3]]),
      order("cancelled", "paid", [["crepe", 50]]),
      order("delivered", "paid", [["", 4], ["tea", 0], ["cake", 2.7]]),
    ]);
    expect(Object.fromEntries(units)).toEqual({ latte: 5, crepe: 1, cake: 2 });
    expect(rankByUnits(units)).toEqual(["latte", "cake", "crepe"]);
    expect(rankByUnits(new Map([["b", 1], ["a", 1]]))).toEqual(["a", "b"]); // stable on ties
  });

  it("pinned by hand: after the real sellers; counted as popular", () => {
    expect(mergePopular(["latte", "cake"], ["new", "cake"])).toEqual(["latte", "cake", "new"]);
    const ranking = Array.from({ length: 15 }, (_, i) => `p${i}`);
    const set = popularIdSet(ranking, ["pin"]);
    expect(set.has("p9")).toBe(true);
    expect(set.has("p10")).toBe(false);
    expect(set.has("pin")).toBe(true);
  });
});

// ---- server: saved ranking, 30 days with all-time fallback ----
type Doc = Record<string, unknown>;
function fakeDb(orders: { createdAtMs: number; data: Doc }[], saved: Doc | null, opts: { failSave?: boolean; failRead?: boolean } = {}) {
  const calls: string[] = [];
  let stored = saved;
  const db = {
    collection: (name: string) => {
      if (name === "stats")
        return {
          doc: () => ({
            get: async () => ({ exists: !!stored, data: () => stored }),
            set: async (d: Doc) => {
              calls.push("save");
              if (opts.failSave) throw new Error("no write");
              stored = d;
            },
          }),
        };
      const run = (sinceMs: number | null) => ({
        select: () => ({
          get: async () => {
            calls.push(sinceMs === null ? "all" : "30d");
            if (opts.failRead) throw new Error("read failed");
            return { docs: orders.filter((o) => sinceMs === null || o.createdAtMs >= sinceMs).map((o) => ({ data: () => o.data })) };
          },
        }),
      });
      return {
        where: (_f: string, _op: string, ts: { toMillis: () => number }) => run(ts.toMillis()),
        select: (...fields: string[]) => run(null).select(...fields),
      };
    },
  };
  return { db: db as unknown as Firestore, calls, stored: () => stored };
}

describe("popularity on the server", () => {
  const NOW = Date.UTC(2026, 10, 25, 12);
  const DAY = 24 * 3600_000;
  const many = (id: string, qty: number, daysAgo: number) => ({ createdAtMs: NOW - daysAgo * DAY, data: order("delivered", "paid", [[id, qty]]) });

  it("last 30 days when there were enough sales; saved", async () => {
    const { db, calls, stored } = fakeDb([many("latte", 15, 2), many("crepe", 10, 5), many("old", 100, 40)], null);
    const result = await getPopularity(db, NOW);
    expect(result).toEqual({ ranking: ["latte", "crepe"], period: "30d", computedAtMs: NOW });
    expect(calls).toEqual(["30d", "save"]);
    expect(stored()).toEqual(result);
    expect(POPULAR_WINDOW_DAYS).toBe(30);
    expect(POPULAR_MIN_UNITS).toBe(20);
  });

  it("fewer than 20 units in 30 days → all time", async () => {
    const { db, calls } = fakeDb([many("latte", 3, 2), many("old", 100, 40)], null);
    const result = await getPopularity(db, NOW);
    expect(result.period).toBe("all");
    expect(result.ranking).toEqual(["old", "latte"]);
    expect(calls).toEqual(["30d", "all", "save"]);
  });

  it("a saved ranking younger than 6 hours is used as is (no order reads)", async () => {
    const saved = { ranking: ["x"], period: "30d", computedAtMs: NOW - POPULAR_REFRESH_MS + 60_000 };
    const { db, calls } = fakeDb([many("latte", 50, 1)], saved);
    expect(await getPopularity(db, NOW)).toEqual(saved);
    expect(calls).toEqual([]);
  });

  it("older than 6 hours → recomputed; a failed save never fails the answer", async () => {
    const saved = { ranking: ["x"], period: "30d", computedAtMs: NOW - POPULAR_REFRESH_MS - 1 };
    const { db } = fakeDb([many("latte", 50, 1)], saved, { failSave: true });
    expect((await getPopularity(db, NOW)).ranking).toEqual(["latte"]);
  });

  it("reading the orders fails → the last saved ranking", async () => {
    const saved = { ranking: ["x"], period: "30d", computedAtMs: 1 };
    const { db } = fakeDb([], saved, { failRead: true });
    expect((await getPopularity(db, NOW)).ranking).toEqual(["x"]);
  });

  it("the public answer has the order only, never quantities", () => {
    const route = read("src/app/api/catalog/popular/route.ts");
    // The only fields answered: the ids in order, and which period they cover.
    expect(route).toContain("{ ok: true, productIds: ranking, period }");
    expect(route).toContain("const { ranking, period } = await getPopularity(");
  });
});

describe("popular in the menu and on the home page", () => {
  const products = [
    product("latte", { sortOrder: 3 }),
    product("crepe", { sortOrder: 1 }),
    product("cake", { sortOrder: 2, isPopular: true }), // pinned by hand
    product("tea", { sortOrder: 4, available: false }),
    product("secret", { sortOrder: 5, hidden: true }),
  ];
  const ranked = withPopularity(products, ["tea", "latte", "secret"]);
  const by = (id: string) => ranked.find((p) => p.id === id)!;

  it("badge for top sellers and pins; rank: sellers first, then pins", () => {
    expect(by("latte")).toMatchObject({ isPopular: true, popularRank: 1 });
    expect(by("cake")).toMatchObject({ isPopular: true, popularRank: 3 });
    expect(by("crepe")).toMatchObject({ isPopular: false, popularRank: undefined });
  });

  it("home row: orderable, public products only, in rank order", () => {
    expect(topPopular(ranked).map((p) => p.id)).toEqual(["latte", "cake"]);
  });

  it("'popular' sort follows real sales; the 'popular' filter shows sellers and pins", () => {
    expect(applyDisplayFilters(ranked, { sortBy: "popular" }, "he").map((p) => p.id)).toEqual(["tea", "latte", "secret", "cake", "crepe"]);
    expect(applyDisplayFilters(ranked, { isPopular: true, sortBy: "popular" }, "he").map((p) => p.id)).toEqual(["tea", "latte", "secret", "cake"]);
  });

  it("wired into the catalog, home page and favourites", () => {
    const view = read("src/features/catalog/catalog-view.tsx");
    expect(view).toContain("usePopularProducts(rawProducts)");
    expect(view).toContain('isHome && popularRow.length > 0');
    expect(read("src/features/favorites/favorites-screen.tsx")).toContain("usePopularProducts(raw)");
  });
});

describe("assistant", () => {
  const CATEGORIES = [{ id: "desserts", name_he: "קינוחים", name_ar: "حلويات", name_en: "Desserts", active: true }] as unknown as Category[];
  const ctx = (popularRanking: string[] | undefined, featured: string[] = []) =>
    buildAssistantContext({
      locale: "he",
      products: [product("a", { isPopular: true }), product("b"), product("c"), product("d")],
      categories: CATEGORIES,
      config: { ...DEFAULT_ASSISTANT_CONFIG, featuredProductIds: featured },
      banners: [],
      popularRanking,
      store: { phone: "", address: "", hoursText: "", whatsapp: "", mapsUrl: "", fulfillment: DEFAULT_FULFILLMENT, openingHours: DEFAULT_OPENING_HOURS },
    });
  const ids = (r: { products?: { id: string }[] }) => (r.products ?? []).map((p) => p.id);

  it("'most popular' = real sales first, then the manual pin", () => {
    const res = processQuickAction("popular", ctx(["c", "b"]), { message: "", locale: "he" });
    expect(ids(res)).toEqual(["c", "b", "a"]);
  });

  it("without sales data: the manual pins, as before", () => {
    expect(ids(processQuickAction("popular", ctx(undefined), { message: "", locale: "he" }))).toEqual(["a"]);
  });

  it("'offers' in the order set in the admin", () => {
    expect(ids(processQuickAction("offers", ctx([], ["d", "b", "c"]), { message: "", locale: "he" }))).toEqual(["d", "b", "c"]);
  });

  it("the server loads the ranking for the assistant (never failing the chat)", () => {
    const server = read("src/lib/assistant/server-data.ts");
    expect(server).toContain("await getPopularity(db)");
    expect(server).toContain(".catch(() => [] as string[])");
  });
});

describe("offers page", () => {
  const products = [product("a"), product("b", { available: false }), product("c"), product("h", { hidden: true })];

  it("in the admin's order; unavailable at the end; hidden and deleted left out", () => {
    const list = orderOfferProducts(products, [{ productId: "b" }, { productId: "gone" }, { productId: "c" }, { productId: "h" }, { productId: "a" }]);
    expect(list.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });

  it("▲▼ moves one place; not past the ends", () => {
    expect(moveOffer(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveOffer(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(moveOffer(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveOffer(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });

  it("a real page, linked from every menu; storefront-only like the menu", () => {
    expect(read("src/lib/customer-nav.ts")).toContain('OFFERS_HREF = "/offers"');
    expect(read("src/app/offers/page.tsx")).toContain("<OffersScreen />");
    expect(isCustomerOnlyPath("/offers")).toBe(true);
    expect(isOrderingPath("/offers")).toBe(true);
    const screen = read("src/features/offers/offers-screen.tsx");
    expect(screen).toContain('fetch("/api/catalog/offers")');
    expect(screen).toContain('t("offers.none")');
    expect(read("src/app/api/catalog/offers/route.ts")).toContain("featuredProductIds");
  });

  it("admin: ▲▼ order list, and every product can be chosen (no 100 limit)", () => {
    const admin = read("src/features/admin/assistant-manager-admin.tsx");
    expect(admin).toContain("moveOffer(current.featuredProductIds, id, -1)");
    expect(admin).toContain("moveOffer(current.featuredProductIds, id, 1)");
    expect(admin).not.toContain("products.slice(0, 100)");
  });

  it("texts in three languages", () => {
    const ui = read("src/data/ui-translations-seed.ts");
    for (const k of ["catalog.popularTitle", "catalog.popularSubtitle", "offers.title", "offers.none", "offers.popularInstead"]) expect(ui.split(`"${k}":`).length - 1, k).toBe(3);
    const admin = read("src/data/admin-translations.ts");
    for (const k of ["admin.assistant.offersOrder", "admin.assistant.offerMissing", "admin.assistant.moveUp", "admin.assistant.moveDown"]) expect(admin.split(`"${k}":`).length - 1, k).toBe(3);
  });
});
