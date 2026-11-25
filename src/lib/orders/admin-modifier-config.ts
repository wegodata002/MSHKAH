import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  mapBusinessRule,
  mapInventoryLink,
  mapModifierGroup,
  mapModifierOption,
  mapProductModifierGroup,
  mapProductModifierOption,
} from "@/lib/mappers/modifier-mappers";
import { buildProductBuilderConfig } from "@/lib/product-builder/engine";
import type { ProductBuilderConfig } from "@/types/modifiers";
import type {
  FirestoreBusinessRule,
  FirestoreInventoryLink,
  FirestoreModifierGroup,
  FirestoreModifierOption,
  FirestoreProductModifierGroup,
  FirestoreProductModifierOption,
} from "@/types/modifier-firestore";

/** Firestore allows up to 30 values in one `in` filter. */
const IN_LIMIT = 30;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_LIMIT) out.push(items.slice(i, i + IN_LIMIT));
  return out;
}

async function whereIn<T>(db: Firestore, collection: string, field: string, values: string[]): Promise<(T & { id: string })[]> {
  const unique = [...new Set(values.filter(Boolean))];
  const snaps = await Promise.all(chunks(unique).map((part) => db.collection(collection).where(field, "in", part).get()));
  return snaps.flatMap((s) => s.docs.map((d) => ({ ...(d.data() as T), id: d.id })));
}

/**
 * The add-on groups of the given products, read on the server (Admin SDK), built with the same
 * engine as the menu. Every product id gets a config (with no groups when it has none).
 */
export async function loadModifierConfigs(db: Firestore, productIds: string[]): Promise<Map<string, ProductBuilderConfig>> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const result = new Map<string, ProductBuilderConfig>();
  if (ids.length === 0) return result;

  const links = (await whereIn<FirestoreProductModifierGroup>(db, COLLECTIONS.productModifierGroups, "productId", ids)).map(mapProductModifierGroup);
  const groupIds = [...new Set(links.filter((l) => l.active).map((l) => l.groupId))];

  const [groupSnaps, optionDocs, productOptionDocs, ruleSnap] =
    groupIds.length === 0
      ? [[], [], [], null]
      : await Promise.all([
          db.getAll(...groupIds.map((id) => db.collection(COLLECTIONS.modifierGroups).doc(id))),
          whereIn<FirestoreModifierOption>(db, COLLECTIONS.modifierOptions, "groupId", groupIds),
          whereIn<FirestoreProductModifierOption>(db, COLLECTIONS.productModifierOptions, "productId", ids),
          db.collection(COLLECTIONS.businessRules).get(),
        ]);

  const groups = groupSnaps.filter((s) => s.exists).map((s) => mapModifierGroup({ ...(s.data() as FirestoreModifierGroup), id: s.id }));
  const options = optionDocs.map(mapModifierOption);
  const productOptions = productOptionDocs.map(mapProductModifierOption);
  const rules = ruleSnap ? ruleSnap.docs.map((d) => mapBusinessRule({ ...(d.data() as FirestoreBusinessRule), id: d.id })) : [];
  const inventory =
    options.length === 0
      ? []
      : (await whereIn<FirestoreInventoryLink>(db, COLLECTIONS.inventoryLinks, "optionId", options.map((o) => o.id))).map(mapInventoryLink);

  for (const productId of ids) {
    result.set(
      productId,
      buildProductBuilderConfig({
        productId,
        groups,
        options,
        productGroups: links.filter((l) => l.productId === productId),
        productOptions: productOptions.filter((po) => po.productId === productId),
        rules,
        suggestions: [],
        inventory,
      })
    );
  }
  return result;
}
