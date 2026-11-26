import type { Locale } from "@/lib/i18n/types";
import { mergePopular, popularIdSet } from "@/lib/catalog/popularity";
import {
  getCategoryDisplayName,
  getLocalizedDescription,
  getProductDisplayName,
} from "@/lib/i18n/localized-content";
import { getProductImage } from "@/lib/menu/placeholders";
import type { Category, Product } from "@/types";
import type { FulfillmentSettings } from "@/lib/fulfillment/settings";
import type { OpeningHours } from "@/lib/settings/opening-hours";
import type { AssistantConfig, AssistantContext, AssistantProduct } from "@/lib/assistant/types";

/**
 * Builds the assistant context from already-loaded data. Pure (no Firebase): the server
 * (Admin SDK data) and the browser fallback (client data) use it, so both run the same
 * engine on the same context and give the same answers.
 */

export type AssistantStoreInfo = {
  phone: string;
  address: string;
  /** Opening hours as display text for this locale. */
  hoursText: string;
  /** WhatsApp number from the settings only ("" when not set). */
  whatsapp: string;
  mapsUrl: string;
  fulfillment: FulfillmentSettings;
  openingHours: OpeningHours;
};

function localizeProduct(
  p: Product,
  locale: Locale,
  categoryName: string | undefined,
  popular: { set: ReadonlySet<string>; rank: ReadonlyMap<string, number> }
): AssistantProduct {
  return {
    id: p.id,
    name: getProductDisplayName(p, locale),
    description: getLocalizedDescription(p, locale),
    price: p.price,
    ...(p.sales && p.sales.length > 0 ? { sales: p.sales } : {}),
    image: getProductImage(p.image, p.categoryId),
    categoryId: p.categoryId,
    categoryName,
    available: p.available,
    isPopular: popular.set.has(p.id),
    popularRank: popular.rank.get(p.id),
    isNew: p.isNew,
    searchText: [p.name_he, p.name_ar, p.name_en, p.description_he, p.description_ar, p.description_en]
      .filter(Boolean)
      .join(" "),
  };
}

export function buildAssistantContext(input: {
  locale: Locale;
  products: Product[];
  categories: Category[];
  config: AssistantConfig;
  store: AssistantStoreInfo;
  banners: { title: string; subtitle: string }[];
  now?: Date;
  /** Best sellers first (server ranking); manual "popular" pins follow. Omitted = manual pins only. */
  popularRanking?: string[];
}): AssistantContext {
  const { locale } = input;
  const products = input.products.filter((p) => p.active !== false);
  const categories = input.categories.filter((c) => c.active !== false);
  const categoryMap = new Map(categories.map((c) => [c.id, getCategoryDisplayName(c, locale)]));
  const pinned = products.filter((p) => p.isPopular).map((p) => p.id);
  const ranking = input.popularRanking ?? [];
  const popular = {
    set: popularIdSet(ranking, pinned),
    rank: new Map(mergePopular(ranking, pinned).map((id, i) => [id, i])),
  };

  return {
    locale,
    products: products.map((p) => localizeProduct(p, locale, categoryMap.get(p.categoryId), popular)),
    categories: categories.map((c) => ({
      id: c.id,
      name: getCategoryDisplayName(c, locale),
      searchText: [c.name_he, c.name_ar, c.name_en].filter(Boolean).join(" "),
      parentId: c.parentId ?? null,
      names: [c.name_he, c.name_ar, c.name_en].filter(Boolean),
    })),
    config: input.config,
    settings: {
      phone: input.store.phone,
      address: input.store.address,
      hours: input.store.hoursText,
      whatsapp: input.store.whatsapp,
      mapsUrl: input.store.mapsUrl,
    },
    banners: input.banners,
    fulfillment: { settings: input.store.fulfillment, openingHours: input.store.openingHours },
    ...(input.now ? { now: input.now } : {}),
  };
}
