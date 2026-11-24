import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { mapCategory, mapProduct } from "@/lib/mappers";
import {
  mapMasterMenuCategories,
  mapMasterMenuProducts,
} from "@/lib/menu/map-master-menu";
import type { Locale } from "@/lib/i18n/types";
import { getLocalizedBannerField } from "@/lib/i18n/localized-content";
import type { Category, Product } from "@/types";
import type { FirestoreSettings } from "@/types/firestore";
import { parseAssistantConfig } from "@/lib/assistant/parse-config";
import { DEFAULT_OPENING_HOURS, openingHoursText, resolveOpeningHours } from "@/lib/settings/opening-hours";
import { normalizeFulfillmentSettings } from "@/lib/fulfillment/settings";
import { ASSISTANT_DOC_ID, type AssistantContext } from "@/lib/assistant/types";
import { buildAssistantContext } from "@/lib/assistant/build-context";

export async function loadAssistantContext(locale: Locale): Promise<AssistantContext> {
  const db = getAdminDb();

  const [productsSnap, categoriesSnap, settingsSnap, assistantSnap, bannersSnap] =
    await Promise.all([
      db.collection(COLLECTIONS.products).get(),
      db.collection(COLLECTIONS.categories).get(),
      db.doc(`${COLLECTIONS.settings}/app`).get(),
      db.doc(`${COLLECTIONS.assistant}/${ASSISTANT_DOC_ID}`).get(),
      db.collection(COLLECTIONS.banners).where("active", "==", true).get(),
    ]);

  let products: Product[] = productsSnap.docs.map((d) =>
    mapProduct({ id: d.id, ...(d.data() as import("@/types/firestore").FirestoreProduct) })
  );
  let categories: Category[] = categoriesSnap.docs.map((d) =>
    mapCategory({ id: d.id, ...(d.data() as import("@/types/firestore").FirestoreCategory) })
  );

  if (products.length === 0) products = mapMasterMenuProducts();
  if (categories.length === 0) categories = mapMasterMenuCategories();

  products = products.filter((p) => p.active !== false);
  categories = categories.filter((c) => c.active !== false);

  const settingsData = settingsSnap.exists
    ? (settingsSnap.data() as FirestoreSettings)
    : undefined;

  const config = parseAssistantConfig(
    assistantSnap.exists ? (assistantSnap.data() as Record<string, unknown>) : undefined
  );

  const banners = bannersSnap.docs
    .map((d) => {
      const b = d.data() as Record<string, unknown>;
      const slide = { id: d.id, ...b } as import("@/types").BannerSlide & { id: string };
      return {
        title: getLocalizedBannerField(slide, "title", locale) || String(b.title ?? ""),
        subtitle: getLocalizedBannerField(slide, "subtitle", locale) || String(b.subtitle ?? ""),
      };
    })
    .filter((b) => b.title);

  return buildAssistantContext({
    locale,
    products,
    categories,
    config,
    banners,
    store: {
      phone: settingsData?.phone ?? "",
      address: settingsData?.address ?? "",
      hoursText: openingHoursText(
        { openingHours: resolveOpeningHours(settingsData), hours: settingsData?.hours ?? "" },
        locale
      ),
      // Only a WhatsApp number entered in the settings; never the phone as a stand-in.
      whatsapp: settingsData?.social?.whatsapp?.trim() ?? "",
      mapsUrl: settingsData?.mapsUrl ?? "",
      fulfillment: normalizeFulfillmentSettings(settingsData?.fulfillment),
      openingHours: resolveOpeningHours(settingsData) ?? DEFAULT_OPENING_HOURS,
    },
  });
}
