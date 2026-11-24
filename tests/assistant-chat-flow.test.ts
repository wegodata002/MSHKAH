import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cartReply, processMessage, processQuickAction } from "@/lib/assistant/engine";
import { buildAssistantContext } from "@/lib/assistant/build-context";
import { DEFAULT_ASSISTANT_CONFIG, type AssistantChatRequest, type AssistantConfig } from "@/lib/assistant/types";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import type { Locale } from "@/lib/i18n/types";
import type { Category, Product } from "@/types";

/** Pure — no Firebase, no network. The browser fallback builds this same context and runs this same engine. */

function product(id: string, patch: Partial<Product> = {}): Product {
  return {
    id,
    name_he: `מוצר ${id}`,
    name_ar: `منتج ${id}`,
    name_en: `Product ${id}`,
    description_he: "",
    description_ar: "",
    description_en: "",
    categoryId: "desserts",
    price: 20,
    cost: 0,
    profit: 0,
    businessType: "cafe",
    image: "",
    isPopular: false,
    isNew: false,
    available: true,
    active: true,
    sortOrder: 0,
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    ...patch,
  } as Product;
}

const CATEGORIES = [
  { id: "desserts", name_he: "קינוחים", name_ar: "حلويات", name_en: "Desserts", active: true },
] as unknown as Category[];

function ctx(locale: Locale, products: Product[], config: AssistantConfig = DEFAULT_ASSISTANT_CONFIG) {
  return buildAssistantContext({
    locale,
    products,
    categories: CATEGORIES,
    config,
    banners: [],
    store: {
      phone: "0587887090",
      address: "",
      hoursText: "",
      whatsapp: "",
      mapsUrl: "",
      fulfillment: DEFAULT_FULFILLMENT,
      openingHours: DEFAULT_OPENING_HOURS,
    },
  });
}

const req = (locale: Locale, patch: Partial<AssistantChatRequest> = {}): AssistantChatRequest => ({
  message: "",
  locale,
  cartProductIds: [],
  cartItems: [],
  ...patch,
});

const LIVE_ACTIONS: AssistantConfig["quickActions"] = [
  { id: "popular", icon: "popular", label: { he: "הכי פופולרי", ar: "الأكثر شعبية", en: "Most popular" }, action: "popular", enabled: true, sortOrder: 0 },
  { id: "offers", icon: "offers", label: { he: "מבצעים", ar: "عروض", en: "Offers" }, action: "offers", enabled: true, sortOrder: 1 },
  { id: "cart", icon: "cart", label: { he: "העגלה שלי", ar: "سلتي", en: "My cart" }, action: "cart", enabled: true, sortOrder: 2 },
  { id: "checkout", icon: "checkout", label: { he: "ההזמנה שלי", ar: "طلبي", en: "My order" }, action: "checkout", enabled: true, sortOrder: 3 },
  { id: "contact", icon: "contact", label: { he: "צור קשר", ar: "اتصل بنا", en: "Contact us" }, action: "contact", enabled: true, sortOrder: 4 },
] as AssistantConfig["quickActions"];
const LIVE_CONFIG: AssistantConfig = { ...DEFAULT_ASSISTANT_CONFIG, quickActions: LIVE_ACTIONS, featuredProductIds: [] };

describe("cart in the conversation", () => {
  it("a count line and the cart card (showCart), with no duplicate product cards", () => {
    const r = cartReply(ctx("ar", [product("a")]), req("ar", { cartItems: [{ productId: "a", quantity: 3 }] }));
    expect(r.message).toBe("في السلة 3 منتجات:");
    expect(r.showCart).toBe(true);
    expect(r.products).toEqual([]);
    expect(r.clientAction).toBeUndefined();
  });

  it("one item / Hebrew / English wording", () => {
    expect(cartReply(ctx("he", []), req("he", { cartItems: [{ productId: "a", quantity: 1 }] })).message).toBe("בעגלה פריט אחד:");
    expect(cartReply(ctx("en", []), req("en", { cartItems: [{ productId: "a", quantity: 2 }] })).message).toBe("2 items in your cart:");
  });

  it("an empty cart is just the text, no card", () => {
    const r = cartReply(ctx("he", []), req("he"));
    expect(r.message).toBe("העגלה ריקה. בחרו מוצרים מהתפריט.");
    expect(r.showCart).toBeFalsy();
  });

  it('typing "سلتي" gives the same cart reply as the button', () => {
    const c = ctx("ar", [product("a")]);
    const typed = processMessage(req("ar", { message: "عرض السلة", cartItems: [{ productId: "a", quantity: 1 }] }), c);
    expect(typed.showCart).toBe(true);
  });
});

describe('"My order" (طلبي)', () => {
  it("empty cart → says so, does not open an empty checkout", () => {
    const r = processQuickAction("checkout", ctx("ar", [], LIVE_CONFIG), req("ar", { quickActionId: "checkout" }));
    expect(r.message).toBe("السلة فارغة. اختر من القائمة.");
    expect(r.clientAction).toBeUndefined();
  });

  it("with items → goes to the checkout", () => {
    const r = processQuickAction("checkout", ctx("ar", [product("a")], LIVE_CONFIG), req("ar", { quickActionId: "checkout", cartItems: [{ productId: "a", quantity: 1 }] }));
    expect(r.clientAction).toEqual({ type: "checkout" });
  });
});

describe("offers and popular: products or a clear message, never the button label", () => {
  it("offers: products marked in the admin", () => {
    const c = ctx("he", [product("a"), product("b")], { ...LIVE_CONFIG, featuredProductIds: ["b"] });
    const r = processQuickAction("offers", c, req("he", { quickActionId: "offers" }));
    expect(r.message).toBe("הנה המבצעים שלנו:");
    expect(r.products.map((p) => p.id)).toEqual(["b"]);
  });

  it("offers: nothing marked → popular / new products", () => {
    const c = ctx("ar", [product("a", { isPopular: true }), product("b")], LIVE_CONFIG);
    const r = processQuickAction("offers", c, req("ar", { quickActionId: "offers" }));
    expect(r.message).toBe("إليك عروضنا:");
    expect(r.products.map((p) => p.id)).toEqual(["a"]);
  });

  it('offers: nothing at all → "no offers right now" + popular products, in 3 languages', () => {
    const products = [product("a"), product("b")];
    expect(processQuickAction("offers", ctx("he", products, LIVE_CONFIG), req("he", { quickActionId: "offers" })).message).toBe(
      "אין מבצעים כרגע. הנה המוצרים הפופולריים שלנו:"
    );
    const ar = processQuickAction("offers", ctx("ar", products, LIVE_CONFIG), req("ar", { quickActionId: "offers" }));
    expect(ar.message).toBe("لا توجد عروض حاليًا. إليك منتجاتنا الأكثر شعبية:");
    expect(ar.products.length).toBe(2);
    expect(processQuickAction("offers", ctx("en", products, LIVE_CONFIG), req("en", { quickActionId: "offers" })).message).toBe(
      "No offers right now. Here are our most popular items:"
    );
  });

  it("popular: popular products, or the first available ones", () => {
    const withPopular = processQuickAction("popular", ctx("ar", [product("a", { isPopular: true }), product("b")], LIVE_CONFIG), req("ar", { quickActionId: "popular" }));
    expect(withPopular.products.map((p) => p.id)).toEqual(["a"]);
    const none = processQuickAction("popular", ctx("ar", [product("a"), product("b")], LIVE_CONFIG), req("ar", { quickActionId: "popular" }));
    expect(none.products.length).toBe(2);
  });

  it("no quick action answers with its own label, in 3 languages (with and without products)", () => {
    for (const locale of ["he", "ar", "en"] as const) {
      for (const products of [[], [product("a", { isPopular: true })]]) {
        for (const action of LIVE_ACTIONS) {
          const r = processQuickAction(action.id, ctx(locale, products, LIVE_CONFIG), req(locale, { quickActionId: action.id }));
          expect(r.message.trim(), `${locale} ${action.id}`).not.toBe(action.label[locale]);
        }
      }
    }
  });
});

describe("browser fallback = the server engine", () => {
  const provider = readFileSync(resolve(process.cwd(), "src/features/assistant/assistant-context.tsx"), "utf8");
  const drawer = readFileSync(resolve(process.cwd(), "src/features/assistant/assistant-drawer.tsx"), "utf8");

  it("the fallback runs processQuickAction / processMessage on buildAssistantContext", () => {
    expect(provider).toMatch(/actionId \? processQuickAction\(actionId, ctx, req\) : processMessage\(req, ctx\)/);
    expect(provider).toMatch(/return buildAssistantContext\(/);
    // No hand-written fallback answers left (they used to echo the button label).
    expect(provider).not.toMatch(/return respond\(action\.label\[loc\]/);
  });

  it("one cart card, under the latest cart message; no card pinned under the conversation", () => {
    expect(drawer).toMatch(/index === cartMessageIndex && itemCount > 0/);
    expect(drawer).not.toMatch(/messages\.some\(\(m\) => m\.showCart\)/);
  });

  it('the "My cart" quick action is not shown (the header icon is the only way in)', () => {
    expect(drawer).toMatch(/a\.enabled && a\.action !== "cart"/);
  });

  it("suggestions always come from the settings", () => {
    expect(provider).toMatch(/config\.suggestedQuestions\.map\(\(q\) => q\[locale\]\)/);
    expect(drawer).toMatch(/const showSuggestions = suggestions\.length > 0 && !selectedProduct;/);
  });
});
