import { describe, expect, it } from "vitest";
import { buildMeasureUnitsListView } from "@/lib/inventory/measure-units-list";
import type { MeasureUnitRecord } from "@/lib/inventory/measure-units";

function unit(id: string, nameHe: string, active = true, abbreviation = id): MeasureUnitRecord {
  return {
    id,
    nameHe,
    abbreviation,
    kind: "other",
    baseUnitId: null,
    factorToBase: null,
    active,
    builtin: false,
    nameNormalized: nameHe,
    createdAt: "",
    updatedAt: "",
  };
}

const units = [
  unit("g", "גרם"),
  unit("kg", "קילוגרם"),
  unit("ml", "מיליליטר"),
  unit("l", "ליטר"),
  unit("box", "קופסה", false),
  unit("unit", "יחידה"),
];
const usage = { unit: 9, g: 4, l: 1 };
const ids = (rows: MeasureUnitRecord[]) => rows.map((u) => u.id);

describe("buildMeasureUnitsListView", () => {
  it("shows the most used active units first and limits the preview", () => {
    const view = buildMeasureUnitsListView(units, usage, { limit: 3 });
    expect(ids(view.rows)).toEqual(["unit", "g", "l"]);
    expect(view).toMatchObject({ matching: 5, hidden: 2, inactiveHidden: 1 });
  });

  it("expands to every active unit and can include disabled ones at the end", () => {
    expect(ids(buildMeasureUnitsListView(units, usage, { limit: 3, expanded: true }).rows)).toEqual([
      "unit", "g", "l", "ml", "kg",
    ]);
    const all = buildMeasureUnitsListView(units, usage, { limit: 3, expanded: true, showInactive: true });
    expect(ids(all.rows).at(-1)).toBe("box");
    expect(all.inactiveHidden).toBe(0);
  });

  it("search matches name or abbreviation and ignores the preview limit", () => {
    expect(ids(buildMeasureUnitsListView(units, usage, { limit: 1, query: "ליטר" }).rows)).toEqual(["l", "ml"]);
    expect(ids(buildMeasureUnitsListView(units, usage, { limit: 1, query: "KG" }).rows)).toEqual(["kg"]);
    const box = buildMeasureUnitsListView(units, usage, { query: "קופסה" });
    expect(box.rows).toEqual([]);
    expect(box.inactiveHidden).toBe(1);
  });
});
