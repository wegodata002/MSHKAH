// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeIsraeliPhone } from "@/lib/customers/phone";
import { parseLocationLink } from "@/lib/fulfillment/location-link";
import { buildServerOrder, type CatalogProduct, type CreateOrderRequest } from "@/lib/orders/server-order";
import { handleCreateOrder, type CreateOrderDeps } from "@/lib/orders/create-order-handler";
import { googleMapsUrl, toCourierDelivery, wazeUrl } from "@/lib/couriers/deliveries";
import { DEFAULT_FULFILLMENT, type FulfillmentSettings } from "@/lib/fulfillment/settings";
import { localToDate } from "@/lib/fulfillment/availability";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import type { ServerOrderDraft } from "@/lib/orders/server-order";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("checkout phone", () => {
  it("9 or 10 digits starting with 0; +972 / 972 / 00972 become 0", () => {
    expect(normalizeIsraeliPhone("050-123-4567")).toBe("0501234567");
    expect(normalizeIsraeliPhone(" 052.123.4567 ")).toBe("0521234567");
    expect(normalizeIsraeliPhone("04-1234567")).toBe("041234567");
    expect(normalizeIsraeliPhone("(04) 123-4567")).toBe("041234567");
    expect(normalizeIsraeliPhone("+972 50-123-4567")).toBe("0501234567");
    expect(normalizeIsraeliPhone("+972501234567")).toBe("0501234567");
    expect(normalizeIsraeliPhone("972-50-123-4567")).toBe("0501234567");
    expect(normalizeIsraeliPhone("00972 50 1234567")).toBe("0501234567");
    expect(normalizeIsraeliPhone("+972 050-1234567")).toBe("0501234567");
  });

  it("refused: no leading 0, too short / long, other countries, letters, empty", () => {
    for (const bad of ["501234567", "05012345", "05012345678", "+1 555 1234567", "+44 20 7946 0958", "abc0501234567", "050-123-4567 ext 2", "", "   ", null, undefined]) {
      expect(normalizeIsraeliPhone(bad as string), String(bad)).toBeNull();
    }
  });
});

// ---- server: same rule, clear code, saved in one form ----
const PRODUCTS = new Map<string, CatalogProduct | undefined>([["latte", { price: 60, nameHe: "לאטה", nameEn: "Latte", available: true }]]);
const WITH_DELIVERY: FulfillmentSettings = {
  ...DEFAULT_FULFILLMENT,
  delivery: { ...DEFAULT_FULFILLMENT.delivery, enabled: true, zones: [{ id: "ein-mahel", name: { he: "עין מאהל", ar: "عين ماهل", en: "Ein Mahel" }, fee: 15, minOrder: 50 }] },
};
const NOON = localToDate({ year: 2026, month: 11, day: 24 }, 12 * 60);

function deps(saved: ServerOrderDraft[] = []): CreateOrderDeps {
  return {
    now: () => NOON,
    loadProducts: async () => PRODUCTS,
    loadContext: async () => ({ fulfillment: WITH_DELIVERY, openingHours: DEFAULT_OPENING_HOURS }),
    loadModifierConfigs: async () => new Map(),
    rateLimit: async () => true,
    saveOrder: async (draft) => {
      saved.push(draft);
      return "Order0000001";
    },
  };
}
const body = (phone: string, fulfillment: Record<string, unknown> = { type: "pickup" }) => ({
  items: [{ productId: "latte", quantity: 1 }],
  customer: { name: "דנה", phone },
  payment: "counter",
  fulfillment,
});

describe("server order phone", () => {
  it("a wrong number → INVALID_PHONE (the checkout shows a clear message)", async () => {
    expect(await handleCreateOrder(body("12345"), "1.2.3.4", deps())).toEqual({ status: 400, body: { ok: false, code: "INVALID_PHONE" } });
    expect(await handleCreateOrder(body("+1 555 1234567"), "1.2.3.4", deps())).toEqual({ status: 400, body: { ok: false, code: "INVALID_PHONE" } });
  });

  it("+972 is accepted and saved as 0…", async () => {
    const saved: ServerOrderDraft[] = [];
    const res = await handleCreateOrder(body("+972 50-123-4567"), "1.2.3.4", deps(saved));
    expect(res.status).toBe(200);
    expect(saved[0]!.customerPhone).toBe("0501234567");
  });

  it("the checkout checks the same rule and explains it", () => {
    const page = read("src/app/checkout/page.tsx");
    expect(page).toContain("normalizeIsraeliPhone(phone)");
    expect(page).toContain('if (result.code === "INVALID_PHONE") return t("checkout.phoneInvalid");');
    expect(page).toContain("phone: cleanPhone");
  });
});

describe("delivery location link", () => {
  it("Waze and Google Maps only; a link shared with text around it is found", () => {
    expect(parseLocationLink("https://waze.com/ul/hsv8wxyz12")).toEqual({ url: "https://waze.com/ul/hsv8wxyz12", kind: "waze" });
    expect(parseLocationLink("Meet me https://ul.waze.com/ul?ll=32.7%2C35.3&navigate=yes")?.kind).toBe("waze");
    expect(parseLocationLink("https://maps.app.goo.gl/AbCdEf123")?.kind).toBe("google");
    expect(parseLocationLink("https://www.google.com/maps/place/32.7,35.3")?.kind).toBe("google");
    expect(parseLocationLink("https://google.co.il/maps?q=32.7,35.3")?.kind).toBe("google");
    expect(parseLocationLink("maps.app.goo.gl/AbC")?.url).toBe("https://maps.app.goo.gl/AbC");
    expect(parseLocationLink("http://waze.com/ul/x")?.url).toBe("https://waze.com/ul/x");
  });

  it("anything else is refused (look-alike hosts included)", () => {
    for (const bad of [
      "https://www.google.com/search?q=x",
      "https://evil.com/waze.com/ul",
      "https://waze.com.evil.com/ul",
      "https://google.evil/maps",
      "https://google.com.evil.io/maps",
      "https://user:pw@waze.com/ul",
      "https://waze.com:8443/ul",
      "javascript:alert(1)",
      "ftp://waze.com/ul",
      "",
    ]) {
      expect(parseLocationLink(bad), bad).toBeNull();
    }
  });

  const deliveryReq = (locationUrl?: string) =>
    ({
      items: [{ productId: "latte", quantity: 1 }],
      customer: { name: "דנה", phone: "0501234567" },
      payment: "courier",
      fulfillment: { type: "delivery", zoneId: "ein-mahel", address: "הזיתים 12", locationUrl },
    }) as CreateOrderRequest;
  const build = (req: CreateOrderRequest) =>
    buildServerOrder(req, { products: PRODUCTS, modifierConfigs: new Map(), fulfillment: WITH_DELIVERY, openingHours: DEFAULT_OPENING_HOURS, now: NOON, orderNumber: "MC-2026-LOC00001" });

  it("saved (cleaned) on the order; optional; a bad link is refused", () => {
    const ok = build(deliveryReq("Here: https://waze.com/ul/hsv8wxyz12"));
    expect(ok.ok && ok.order.deliveryLocationUrl).toBe("https://waze.com/ul/hsv8wxyz12");
    const none = build(deliveryReq());
    expect(none.ok && none.order).not.toHaveProperty("deliveryLocationUrl");
    expect(build(deliveryReq("https://evil.com/x"))).toEqual({ ok: false, error: { code: "INVALID_LOCATION_LINK" } });
  });

  it("courier: the matching button opens the customer's link; the other one the written address", () => {
    const base = { id: "D1", orderType: "delivery", status: "ready", deliveryAddress: "הזיתים 12", deliveryZoneName: "עין מאהל" };
    const waze = toCourierDelivery({ ...base, deliveryLocationUrl: "https://waze.com/ul/hsv8wxyz12" });
    expect(waze.locationUrl).toBe("https://waze.com/ul/hsv8wxyz12");
    expect(wazeUrl(waze)).toBe("https://waze.com/ul/hsv8wxyz12");
    expect(googleMapsUrl(waze)).toContain("google.com/maps/dir/?api=1&destination=");
    const google = toCourierDelivery({ ...base, deliveryLocationUrl: "https://maps.app.goo.gl/AbC" });
    expect(googleMapsUrl(google)).toBe("https://maps.app.goo.gl/AbC");
    expect(wazeUrl(google)).toContain("waze.com/ul?q=");
    // A bad link stored somehow is never shown to the courier.
    const bad = toCourierDelivery({ ...base, deliveryLocationUrl: "https://evil.com/x" });
    expect(bad.locationUrl).toBeNull();
    expect(wazeUrl(bad)).toContain("waze.com/ul?q=");
  });

  it("checkout field and admin link", () => {
    const field = read("src/features/checkout/checkout-fulfillment.tsx");
    expect(field).toContain("data-location-link");
    expect(field).toContain('t("checkout.locationLinkHint")');
    const page = read("src/app/checkout/page.tsx");
    expect(page).toContain("locationUrl: location?.url");
    expect(page).toContain('if (result.code === "INVALID_LOCATION_LINK")');
    expect(read("src/features/admin/orders/order-card.tsx")).toContain("parseLocationLink(order.deliveryLocationUrl)");
  });
});

describe("home banners", () => {
  it("the picture whole (contain), the same picture blurred behind it; no zoom crop", () => {
    const banner = read("src/features/catalog/banner-hero.tsx");
    expect(banner).toContain('className="object-contain"');
    expect(banner).toContain("data-banner-backdrop");
    expect(banner).toMatch(/blur-2xl/);
    expect(banner).not.toMatch(/scale\(\$\{zoom/);
  });

  it("limited height, full width: phone a quarter of the screen (150–220px), desktop up to 420px", () => {
    const banner = read("src/features/catalog/banner-hero.tsx");
    expect(banner).toContain("h-[clamp(150px,25svh,220px)] w-full");
    expect(banner).toContain("aspect-[14/5] max-h-[420px] w-full");
  });
});

describe("category image", () => {
  it("a small round picture beside the category name (no strip); hint in the admin", () => {
    const section = read("src/features/catalog/category-product-section.tsx");
    expect(section).toContain("getCategoryHeroImage(category.image, category.id)");
    expect(section).toContain("data-category-thumb");
    expect(section).toMatch(/h-10 w-10 shrink-0 overflow-hidden rounded-full/);
    expect(section).not.toContain("data-category-strip");
    expect(read("src/features/admin/categories-admin.tsx")).toContain('t("admin.categories.coverImageHint")');
    expect(read("src/data/admin-translations.ts")).toContain('"admin.categories.coverImageHint": "מוצג כתמונה קטנה ליד שם הקטגוריה ובתפריט ה-PDF."');
  });
});

describe("translations", () => {
  it("new texts and the 3 previously missing admin keys exist in all three languages", () => {
    const ui = read("src/data/ui-translations-seed.ts");
    for (const k of ["checkout.phoneInvalid", "checkout.locationLink", "checkout.locationLinkHint", "checkout.locationLinkInvalid"]) expect(ui.split(`"${k}":`).length - 1, k).toBe(3);
    const admin = read("src/data/admin-translations.ts");
    for (const k of ["admin.orders.locationLink", "admin.categories.coverImageHint", "admin.costing.unit.bucket", "admin.modifiers.manageOptions", "admin.modifiers.backToList"]) {
      expect(admin.split(`"${k}":`).length - 1, k).toBe(3);
    }
    // Every admin key is in all three languages.
    const counts = new Map<string, number>();
    for (const m of admin.matchAll(/^\s+"([^"]+)":/gm)) counts.set(m[1]!, (counts.get(m[1]!) ?? 0) + 1);
    expect([...counts].filter(([, n]) => n !== 3)).toEqual([]);
  });
});

describe("table strip and home order", () => {
  it("✕ 'Not at the table' forgets the table in this browser", () => {
    const banner = read("src/features/dine-in/table-banner.tsx");
    expect(banner).toContain("onClick={() => forgetTable()}");
    expect(banner).toContain('t("dineIn.banner.notAtTable")');
    expect(read("src/data/ui-translations-seed.ts").split('"dineIn.banner.notAtTable":').length - 1).toBe(3);
  });

  it("table strip replaces the status line (never two 'closed' messages)", () => {
    expect(read("src/features/catalog/catalog-view.tsx")).toContain("{atTable ? <TableBanner /> : <AvailabilityPill />}");
  });

  it("home order: banner → status / table → categories, search, filter → most popular → the menu", () => {
    const view = read("src/features/catalog/catalog-view.tsx");
    const at = (s: string) => view.indexOf(s);
    expect(at("{isHome && <HeroBanner />}")).toBeGreaterThan(-1);
    expect(at("{isHome && <HeroBanner />}")).toBeLessThan(at("{atTable ? <TableBanner /> : <AvailabilityPill />}"));
    expect(at("{atTable ? <TableBanner /> : <AvailabilityPill />}")).toBeLessThan(at("ref={stickyRef}"));
    expect(at("ref={stickyRef}")).toBeLessThan(at("data-popular-row"));
    // The menu sections, after the "close matches" line of the search.
    expect(view.search(/^\s*\{sectionsContent\}\r?$/m)).toBeGreaterThan(-1);
    expect(at("data-popular-row")).toBeLessThan(view.search(/^\s*\{sectionsContent\}\r?$/m));
  });
});
