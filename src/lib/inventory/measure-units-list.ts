import type { MeasureUnitRecord } from "@/lib/inventory/measure-units";

export const MEASURE_UNITS_PREVIEW_LIMIT = 8;

export type MeasureUnitsListOptions = {
  query?: string;
  showInactive?: boolean;
  expanded?: boolean;
  limit?: number;
};

export type MeasureUnitsListView = {
  rows: MeasureUnitRecord[];
  /** Rows matching the search/inactive filter (before the preview limit). */
  matching: number;
  /** Matching rows hidden by the preview limit ("show more" count). */
  hidden: number;
  /** Disabled units hidden because showInactive is off. */
  inactiveHidden: number;
};

/**
 * Compact settings list: active units first, most-used first, then by name.
 * Search (name/abbreviation) and "show inactive" filter; the preview limit applies
 * only when not expanded and not searching.
 */
export function buildMeasureUnitsListView(
  units: MeasureUnitRecord[],
  usage: Record<string, number>,
  options: MeasureUnitsListOptions = {}
): MeasureUnitsListView {
  const query = (options.query ?? "").trim().toLowerCase();
  const limit = options.limit ?? MEASURE_UNITS_PREVIEW_LIMIT;

  const sorted = [...units].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      (usage[b.id] ?? 0) - (usage[a.id] ?? 0) ||
      a.nameHe.localeCompare(b.nameHe, "he")
  );
  const searched = query
    ? sorted.filter((unit) =>
        [unit.nameHe, unit.abbreviation, unit.id].some((text) => (text ?? "").toLowerCase().includes(query))
      )
    : sorted;
  const inactiveHidden = options.showInactive ? 0 : searched.filter((unit) => !unit.active).length;
  const matching = options.showInactive ? searched : searched.filter((unit) => unit.active);
  const rows = options.expanded || query ? matching : matching.slice(0, limit);

  return { rows, matching: matching.length, hidden: matching.length - rows.length, inactiveHidden };
}
