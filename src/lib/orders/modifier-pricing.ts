import type { Locale } from "@/lib/i18n/types";
import { applyBusinessRules, buildSelectedModifiers, validateSelections } from "@/lib/product-builder/engine";
import type { ProductBuilderConfig, SelectedModifier, SelectionState } from "@/types/modifiers";

/**
 * Add-on prices on the server: from the product's add-on groups (the same engine as the menu),
 * never from the browser. Only which add-on and how many come from the request; the price, the
 * names and the kitchen note come from the catalog.
 */

/** What the server reads from a requested (or stored) add-on: which option, in which group, how many. */
export type RequestedModifier = { groupId: string; optionId: string; quantity: number };

export type ModifierRefusal =
  /** Not one of this product's add-ons (or switched off, or hidden by a rule for this choice). */
  | "unknown_option"
  /** Out of stock. */
  | "unavailable"
  /** More than the group allows (one only, or over its maximum). */
  | "too_many";

export type PricedModifiers = { ok: true; modifiers: SelectedModifier[]; extras: number } | { ok: false; reason: ModifierRefusal };

const money = (n: number) => Math.round(n * 100) / 100;

/** A product with no add-on groups: any add-on sent for it is refused. */
export function emptyBuilderConfig(productId: string): ProductBuilderConfig {
  return { productId, groups: [], rules: [], suggestions: [] };
}

export function priceLineModifiers(
  config: ProductBuilderConfig | undefined,
  requested: readonly RequestedModifier[],
  context: { productId: string; categoryId?: string },
  locale: Locale
): PricedModifiers {
  if (requested.length === 0) return { ok: true, modifiers: [], extras: 0 };
  if (!config) return { ok: false, reason: "unknown_option" };

  // The same option twice is counted once, with the quantities added.
  const state: SelectionState = {};
  for (const m of requested) {
    const quantity = Math.floor(Number(m.quantity));
    if (!Number.isFinite(quantity) || quantity < 1) return { ok: false, reason: "unknown_option" };
    const entries = (state[m.groupId] ??= []);
    const same = entries.find((e) => e.optionId === m.optionId);
    if (same) same.quantity += quantity;
    else entries.push({ optionId: m.optionId, quantity });
  }

  // Each option must belong to this product, in that group, and be shown for this choice.
  const visible = applyBusinessRules(config, state, context);
  for (const [groupId, entries] of Object.entries(state)) {
    const group = visible.groups.find((g) => g.group.id === groupId);
    for (const entry of entries) {
      const option = group?.options.find((o) => o.id === entry.optionId && !o.hidden);
      if (!option) return { ok: false, reason: "unknown_option" };
      if (!option.inStock) return { ok: false, reason: "unavailable" };
    }
  }

  // Limits of the group. A missing required choice is not refused: the assistant and the quick
  // "+" add products without opening the add-on window.
  if (validateSelections(config, state, context).some((e) => e.startsWith("single:") || e.startsWith("max:"))) {
    return { ok: false, reason: "too_many" };
  }

  const modifiers = buildSelectedModifiers(config, state, locale, context).map((m) => {
    const mod: SelectedModifier = {
      groupId: m.groupId,
      groupName: m.groupName,
      optionId: m.optionId,
      optionName: m.optionName,
      priceDelta: money(Number(m.priceDelta) || 0),
      quantity: m.quantity,
    };
    const note = m.kitchenNote?.trim();
    if (note) mod.kitchenNote = note;
    return mod;
  });
  const extras = money(modifiers.reduce((sum, m) => sum + m.priceDelta * m.quantity, 0));
  return { ok: true, modifiers, extras };
}
