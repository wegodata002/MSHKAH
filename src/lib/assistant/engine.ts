import type { Locale } from "@/lib/i18n/types";
import { fuzzyScore, matchesAny, normalizeText } from "@/lib/assistant/fuzzy";
import {
  deliveryAnswer,
  hoursAnswer,
  pickupAnswer,
  whatsappUrl,
  zoneMentioned,
  type FulfillmentFacts,
} from "@/lib/assistant/fulfillment-answers";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { getCategoryMeta } from "@/lib/menu/category-meta";
import type {
  AssistantChatRequest,
  AssistantChatResponse,
  AssistantContext,
  AssistantProduct,
  AssistantQuickAction,
} from "@/lib/assistant/types";

const MSG: Record<
  Locale,
  {
    noResults: string;
    popularIntro: string;
    offersIntro: string;
    categoryIntro: (name: string) => string;
    categoriesIntro: string;
    searchIntro: (query: string) => string;
    priceIntro: (max: number) => string;
    cartEmpty: string;
    cartCount: (count: number) => string;
    noOffers: string;
    checkoutHint: string;
    contactIntro: string;
    address: (a: string) => string;
    phone: (p: string) => string;
    addedToCart: (name: string) => string;
    productDetail: (name: string, price: number) => string;
    mapsLink: string;
  }
> = {
  he: {
    noResults: "לא מצאתי מוצרים מתאימים. נסו לחפש שם מוצר, קטגוריה, או בחרו מהכפתורים למטה.",
    popularIntro: "הנה המוצרים הכי פופולריים:",
    offersIntro: "הנה המבצעים שלנו:",
    categoryIntro: (name) => `הנה ${name}:`,
    categoriesIntro: "הנה המשקאות שלנו:",
    searchIntro: (q) => `תוצאות עבור "${q}":`,
    priceIntro: (max) => `מוצרים עד ₪${max}:`,
    cartEmpty: "העגלה ריקה. בחרו מוצרים מהתפריט.",
    cartCount: (count) => (count === 1 ? "בעגלה פריט אחד:" : `בעגלה ${count} פריטים:`),
    noOffers: "אין מבצעים כרגע. הנה המוצרים הפופולריים שלנו:",
    checkoutHint: "לחצו 'לתשלום' להשלמת ההזמנה.",
    contactIntro: "ניתן ליצור קשר:",
    address: (a) => (a ? `כתובת:\n${a}` : "פרטי כתובת בקופה."),
    phone: (p) => (p ? `טלפון:\n${p}` : "טלפון לא הוגדר."),
    addedToCart: (name) => `✓ ${name} נוסף לעגלה`,
    productDetail: (name, price) => `${name}\nמחיר: ₪${price.toFixed(0)}`,
    mapsLink: "פתחו במפות",
  },
  ar: {
    noResults: "لم أجد منتجات مطابقة. جرّب اسم منتج أو اختر من الأزرار أدناه.",
    popularIntro: "إليك المنتجات الأكثر شعبية:",
    offersIntro: "إليك عروضنا:",
    categoryIntro: (name) => `إليك ${name}:`,
    categoriesIntro: "إليك مشروباتنا:",
    searchIntro: (q) => `نتائج "${q}":`,
    priceIntro: (max) => `منتجات حتى ₪${max}:`,
    cartEmpty: "السلة فارغة. اختر من القائمة.",
    cartCount: (count) => (count === 1 ? "في السلة منتج واحد:" : `في السلة ${count} منتجات:`),
    noOffers: "لا توجد عروض حاليًا. إليك منتجاتنا الأكثر شعبية:",
    checkoutHint: "اضغط 'الدفع' لإتمام الطلب.",
    contactIntro: "للتواصل:",
    address: (a) => (a ? `العنوان:\n${a}` : "تفاصيل العنوان عند الكاشير."),
    phone: (p) => (p ? `الهاتف:\n${p}` : "لم يُحدد رقم."),
    addedToCart: (name) => `✓ تمت إضافة ${name} إلى السلة`,
    productDetail: (name, price) => `${name}\nالسعر: ₪${price.toFixed(0)}`,
    mapsLink: "افتح في الخرائط",
  },
  en: {
    noResults: "No matching products. Try a product name or use the buttons below.",
    popularIntro: "Our most popular items:",
    offersIntro: "Current offers:",
    categoryIntro: (name) => `${name}:`,
    categoriesIntro: "Our beverages:",
    searchIntro: (q) => `Results for "${q}":`,
    priceIntro: (max) => `Items up to ₪${max}:`,
    cartEmpty: "Your cart is empty. Browse the menu to add items.",
    cartCount: (count) => (count === 1 ? "1 item in your cart:" : `${count} items in your cart:`),
    noOffers: "No offers right now. Here are our most popular items:",
    checkoutHint: "Tap checkout to complete your order.",
    contactIntro: "Contact us:",
    address: (a) => (a ? `Address:\n${a}` : "Address at the counter."),
    phone: (p) => (p ? `Phone:\n${p}` : "No phone configured."),
    addedToCart: (name) => `✓ ${name} added to cart`,
    productDetail: (name, price) => `${name}\nPrice: ₪${price.toFixed(0)}`,
    mapsLink: "Open in Maps",
  },
};

function m(ctx: AssistantContext) {
  return MSG[ctx.locale];
}

function available(ctx: AssistantContext): AssistantProduct[] {
  return ctx.products.filter((p) => p.available);
}

function top(products: AssistantProduct[], limit = 8): AssistantProduct[] {
  return [...products]
    .sort((a, b) => Number(b.isPopular) - Number(a.isPopular) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

function search(ctx: AssistantContext, query: string, limit = 8): AssistantProduct[] {
  return available(ctx)
    .map((p) => ({
      p,
      score: fuzzyScore(query, p.searchText ?? `${p.name} ${p.description}`),
    }))
    .filter(({ score }) => score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p }) => p);
}

function searchByCategoryName(ctx: AssistantContext, query: string, limit = 8): AssistantProduct[] {
  const matched = ctx.categories
    .map((c) => ({ c, score: fuzzyScore(query, c.searchText || c.name) }))
    .filter(({ score }) => score >= 0.4)
    .sort((a, b) => b.score - a.score);

  if (matched.length === 0) return [];
  const ids = new Set(matched.map(({ c }) => c.id));
  return top(
    available(ctx).filter((p) => ids.has(p.categoryId)),
    limit
  );
}

function findProduct(ctx: AssistantContext, productId: string): AssistantProduct | undefined {
  return available(ctx).find((p) => p.id === productId);
}

/** Adds every descendant (via parentId, any depth) of the given category ids. Cycle-safe. */
function withDescendants(ctx: AssistantContext, rootIds: Iterable<string>): Set<string> {
  const result = new Set(rootIds);
  let added = true;
  while (added) {
    added = false;
    for (const c of ctx.categories) {
      if (c.parentId && result.has(c.parentId) && !result.has(c.id)) {
        result.add(c.id);
        added = true;
      }
    }
  }
  return result;
}

/**
 * Resolves a quick-action category id to the set of category ids whose products
 * should be shown. Always includes the id itself (previous behaviour), plus:
 * - categories whose name (he/ar/en) equals or contains a seed name for that id
 *   (e.g. "מאפים וקינוחים" contains "קינוחים", "Our Salads" contains "Salads"),
 *   so a seed id like "desserts" still works when the real category has an
 *   auto-generated id and a longer name. Substring (not whole-word) matching is
 *   intentional: Hebrew/Arabic attach prefixes (ו/ה/و). Seed names shorter than
 *   4 characters only match exactly;
 * - all subcategories of every matched category.
 */
export function resolveCategoryIds(ctx: AssistantContext, categoryId: string): Set<string> {
  const roots = new Set<string>([categoryId]);
  const meta = getCategoryMeta(categoryId);
  if (meta) {
    const wanted = new Set(
      [meta.nameHe, meta.nameAr, meta.nameEn].map(normalizeText).filter(Boolean)
    );
    for (const c of ctx.categories) {
      const names = (c.names?.length ? c.names : [c.name]).map(normalizeText);
      const matches = names.some((n) =>
        [...wanted].some((w) => n === w || (w.length >= 4 && n.includes(w)))
      );
      if (matches) roots.add(c.id);
    }
  }
  return withDescendants(ctx, roots);
}

function byCategory(ctx: AssistantContext, categoryId: string, limit = 8): AssistantProduct[] {
  const ids = resolveCategoryIds(ctx, categoryId);
  return top(
    available(ctx).filter((p) => ids.has(p.categoryId)),
    limit
  );
}

function byCategories(ctx: AssistantContext, categoryIds: string[], limit = 8): AssistantProduct[] {
  const set = new Set<string>();
  for (const id of categoryIds) {
    for (const resolved of resolveCategoryIds(ctx, id)) set.add(resolved);
  }
  return top(
    available(ctx).filter((p) => set.has(p.categoryId)),
    limit
  );
}

function byMaxPrice(ctx: AssistantContext, maxPrice: number, limit = 8): AssistantProduct[] {
  return top(
    available(ctx).filter((p) => p.price <= maxPrice),
    limit
  );
}

function parseMaxPrice(text: string): number | null {
  const cleaned = text.replace(/[^\d.,]/g, " ").trim();
  const match = cleaned.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;
  const value = parseFloat(match[1]!.replace(",", "."));
  return Number.isFinite(value) && value > 0 && value < 10000 ? value : null;
}

function suggestions(ctx: AssistantContext): string[] {
  return ctx.config.suggestedQuestions.map((q) => q[ctx.locale]).slice(0, 6);
}

function respond(
  ctx: AssistantContext,
  message: string,
  products: AssistantProduct[] = [],
  extra: Partial<AssistantChatResponse> = {}
): AssistantChatResponse {
  return {
    message,
    products,
    suggestions: extra.suggestions ?? suggestions(ctx),
    showContact: extra.showContact,
    showCart: extra.showCart,
    clientAction: extra.clientAction,
  };
}

/** Plain substring match on normalized text (no fuzzy), for the added keywords. */
function containsAny(text: string, keywords: string[]): boolean {
  const norm = normalizeText(text);
  return keywords.some((kw) => norm.includes(normalizeText(kw)));
}

const DELIVERY_WORDS = ["משלוח", "delivery", "توصيل"];
const DELIVERY_EXTRA = ["משלוחים", "שליח", "דליברי", "מגיעים", "deliver", "ديليفري", "دليفري", "توصل"];
const PICKUP_WORDS = ["איסוף", "pickup", "استلام"];
const PICKUP_EXTRA = ["לאסוף", "אסוף", "pick up", "collect", "takeaway", "استلم"];
const HOURS_WORDS = ["שעות", "hours", "פתוח", "open", "ساعات"];
const HOURS_EXTRA = ["פתוחים", "נפתח", "פותחים", "סגור", "סגורים", "مفتوح", "تفتح", "تفتحون", "مغلق", "closed", "close"];

function fulfillmentFacts(ctx: AssistantContext): FulfillmentFacts {
  return {
    fulfillment: ctx.fulfillment?.settings ?? DEFAULT_FULFILLMENT,
    openingHours: ctx.fulfillment?.openingHours ?? DEFAULT_OPENING_HOURS,
    now: ctx.now ?? new Date(),
    phone: ctx.settings.phone,
  };
}

function handleFaq(ctx: AssistantContext, text: string): AssistantChatResponse | null {
  const t = m(ctx);
  const facts = fulfillmentFacts(ctx);
  // Delivery first, so "שעות משלוח" is about delivery, not opening hours.
  const zone = zoneMentioned(text, facts.fulfillment.delivery.zones);
  if (zone || matchesAny(text, DELIVERY_WORDS) || containsAny(text, DELIVERY_EXTRA)) {
    const answer = deliveryAnswer(facts, ctx.locale, zone);
    return respond(ctx, answer.text, [], { showContact: answer.showContact });
  }
  if (matchesAny(text, PICKUP_WORDS) || containsAny(text, PICKUP_EXTRA)) {
    const answer = pickupAnswer(facts, ctx.locale);
    return respond(ctx, answer.text, [], { showContact: answer.showContact });
  }
  if (matchesAny(text, HOURS_WORDS) || containsAny(text, HOURS_EXTRA)) {
    const answer = hoursAnswer(facts, ctx.locale);
    return respond(ctx, answer.text, [], { showContact: answer.showContact });
  }
  if (matchesAny(text, ["כתובת", "address", "איפה", "where", "عنوان", "מפה", "maps"])) {
    const addr = t.address(ctx.settings.address);
    return respond(ctx, addr, [], {
      showContact: Boolean(ctx.settings.mapsUrl || ctx.settings.phone),
    });
  }
  if (matchesAny(text, ["טלפון", "phone", "התקשר", "call", "هاتف", "צור קשר", "contact"])) {
    return respond(ctx, t.phone(ctx.settings.phone), [], { showContact: true });
  }
  for (const item of ctx.config.faq.filter((f) => f.enabled)) {
    if (matchesAny(text, item.keywords) || matchesAny(text, [item.question[ctx.locale]])) {
      return respond(ctx, item.answer[ctx.locale]);
    }
  }
  return null;
}

function cartCount(req: AssistantChatRequest): number {
  if (req.cartItems?.length) return req.cartItems.reduce((sum, item) => sum + item.quantity, 0);
  return req.cartProductIds?.length ?? 0;
}

/**
 * The cart in the conversation: a count line, and the live cart card right under this message
 * (showCart). An empty cart is just the text (no empty card).
 */
export function cartReply(ctx: AssistantContext, req: AssistantChatRequest): AssistantChatResponse {
  const t = m(ctx);
  const count = cartCount(req);
  if (count === 0) return respond(ctx, t.cartEmpty);
  return respond(ctx, t.cartCount(count), [], { showCart: true });
}

function handleCart(ctx: AssistantContext, req: AssistantChatRequest): AssistantChatResponse | null {
  return cartReply(ctx, req);
}

function handleProductDetail(ctx: AssistantContext, productId: string): AssistantChatResponse | null {
  const product = findProduct(ctx, productId);
  if (!product) return null;
  const t = m(ctx);
  const lines = [
    t.productDetail(product.name, product.price),
    product.description,
    product.categoryName ? product.categoryName : "",
  ].filter(Boolean);
  return respond(ctx, lines.join("\n\n"), [product]);
}

function runQuickAction(action: AssistantQuickAction, ctx: AssistantContext, req: AssistantChatRequest): AssistantChatResponse {
  const t = m(ctx);
  switch (action.action) {
    case "popular": {
      const items = top(available(ctx).filter((p) => p.isPopular), 8);
      return respond(ctx, t.popularIntro, items.length ? items : top(available(ctx), 8));
    }
    case "offers": {
      const items = ctx.config.featuredProductIds.length
        ? available(ctx).filter((p) => ctx.config.featuredProductIds.includes(p.id))
        : top(available(ctx).filter((p) => p.isPopular || p.isNew), 8);
      const intro =
        ctx.banners.length > 0
          ? `${t.offersIntro}\n${ctx.banners.map((b) => `• ${b.title}`).join("\n")}`
          : t.offersIntro;
      if (items.length === 0) return respond(ctx, t.noOffers, top(available(ctx), 8));
      return respond(ctx, intro, items);
    }
    case "cart":
      return cartReply(ctx, req);
    case "checkout":
      // "My order": nothing to pay for in an empty cart → say so instead of opening an empty checkout.
      if (cartCount(req) === 0) return respond(ctx, t.cartEmpty);
      return respond(ctx, t.checkoutHint, [], { clientAction: { type: "checkout" } });
    case "contact":
      return respond(ctx, `${t.contactIntro}\n${t.phone(ctx.settings.phone)}`, [], { showContact: true });
    case "product":
      if (action.productId) {
        return handleProductDetail(ctx, action.productId) ?? respond(ctx, t.noResults);
      }
      break;
    case "page":
      if (action.url) {
        return respond(ctx, action.label[ctx.locale], [], {
          clientAction: { type: "open_url", url: action.url },
        });
      }
      break;
    case "whatsapp": {
      // Only a WhatsApp number from the settings (or the action's own link); never the phone.
      const url = action.url || whatsappUrl(ctx.settings.whatsapp);
      if (!url) return respond(ctx, `${t.contactIntro}\n${t.phone(ctx.settings.phone)}`, [], { showContact: true });
      return respond(ctx, action.label[ctx.locale], [], { clientAction: { type: "open_url", url } });
    }
    case "question":
      if (action.question?.[ctx.locale]) {
        return processMessage({ ...req, message: action.question[ctx.locale] }, ctx);
      }
      break;
    case "category":
      if (action.categoryId) {
        const items = byCategory(ctx, action.categoryId, 8);
        if (items.length === 0) break; // fall through to "no results" + popular
        const ids = resolveCategoryIds(ctx, action.categoryId);
        const cat =
          ctx.categories.find((c) => c.id === action.categoryId) ??
          ctx.categories.find((c) => ids.has(c.id) && !(c.parentId && ids.has(c.parentId)));
        return respond(ctx, t.categoryIntro(cat?.name ?? action.categoryId), items);
      }
      break;
    case "categories":
      if (action.categoryIds?.length) {
        const items = byCategories(ctx, action.categoryIds, 8);
        if (items.length === 0) break; // fall through to "no results" + popular
        return respond(ctx, t.categoriesIntro, items);
      }
      break;
  }
  return respond(ctx, t.noResults, top(available(ctx), 4));
}

export function processQuickAction(
  actionId: string,
  ctx: AssistantContext,
  req: AssistantChatRequest
): AssistantChatResponse {
  const action = ctx.config.quickActions
    .filter((a) => a.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .find((a) => a.id === actionId);
  if (!action) return processMessage(req, ctx);
  return runQuickAction(action, ctx, req);
}

export function processMessage(req: AssistantChatRequest, ctx: AssistantContext): AssistantChatResponse {
  if (req.productId) {
    const detail = handleProductDetail(ctx, req.productId);
    if (detail) return detail;
  }

  const text = normalizeText(req.message);
  if (!text) {
    return respond(ctx, ctx.config.greeting[ctx.locale], [], { suggestions: suggestions(ctx) });
  }

  const faq = handleFaq(ctx, text);
  if (faq) return faq;

  if (matchesAny(text, ["עגלה", "cart", "سلة", "העגלה"])) {
    const cart = handleCart(ctx, req);
    if (cart) return cart;
  }

  if (matchesAny(text, ["תשלום", "checkout", "pay", "הזמנה", "دفع"])) {
    return respond(ctx, m(ctx).checkoutHint, [], { clientAction: { type: "checkout" } });
  }

  const maxPrice = parseMaxPrice(req.message);
  if (maxPrice !== null) {
    const items = byMaxPrice(ctx, maxPrice, 8);
    return respond(ctx, m(ctx).priceIntro(maxPrice), items);
  }

  if (matchesAny(text, ["פופולרי", "popular", "הכי", "best", "top"])) {
    return processQuickAction("popular", ctx, req);
  }

  if (matchesAny(text, ["מבצע", "offer", "promo", "deal"])) {
    return processQuickAction("offers", ctx, req);
  }

  const results = search(ctx, req.message, 8);
  if (results.length > 0) {
    return respond(ctx, m(ctx).searchIntro(req.message.trim()), results);
  }

  const categoryResults = searchByCategoryName(ctx, req.message, 8);
  if (categoryResults.length > 0) {
    return respond(ctx, m(ctx).searchIntro(req.message.trim()), categoryResults);
  }

  return respond(ctx, m(ctx).noResults, top(available(ctx), 4), { showContact: true });
}
