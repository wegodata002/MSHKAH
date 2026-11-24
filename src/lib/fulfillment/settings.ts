import {
  DEFAULT_OPENING_HOURS,
  normalizeOpeningHours,
  type OpeningHours,
} from "@/lib/settings/opening-hours";

/**
 * Order types the store can offer: pickup, delivery and dine-in.
 * Stored in `settings/app.fulfillment`. Pure data: no Firebase, no clock.
 */

export type LocalizedName = { he: string; ar: string; en: string };

export type DeliveryZone = {
  id: string;
  name: LocalizedName;
  /** Delivery fee in ILS. */
  fee: number;
  /** Minimum order subtotal in ILS (0 = no minimum). */
  minOrder: number;
};

export const TABLE_AREAS = ["outside", "inside"] as const;
export type TableArea = (typeof TABLE_AREAS)[number];
export const MAX_TABLE_NUMBER = 99;

/** A table in the cafe. `id` is always `${area}-${number}` (e.g. "inside-3"), used in table QR links. */
export type DineInTable = { id: string; area: TableArea; number: number };

const TABLE_AREA_NAMES: Record<keyof LocalizedName, Record<TableArea, string>> = {
  he: { outside: "חוץ", inside: "פנים" },
  ar: { outside: "خارج", inside: "داخل" },
  en: { outside: "Outside", inside: "Inside" },
};

export function tableId(area: TableArea, number: number): string {
  return `${area}-${number}`;
}

export function makeTable(area: TableArea, number: number): DineInTable {
  return { id: tableId(area, number), area, number };
}

/** "חוץ 1" / "خارج 1" / "Outside 1". */
export function tableLabel(table: Pick<DineInTable, "area" | "number">, locale: keyof LocalizedName): string {
  return `${(TABLE_AREA_NAMES[locale] ?? TABLE_AREA_NAMES.en)[table.area]} ${table.number}`;
}

export function tableAreaName(area: TableArea, locale: keyof LocalizedName): string {
  return (TABLE_AREA_NAMES[locale] ?? TABLE_AREA_NAMES.en)[area];
}

/** Smallest table number not yet used in that area (1, 2, … up to MAX_TABLE_NUMBER), or null when full. */
export function nextTableNumber(tables: DineInTable[], area: TableArea): number | null {
  const used = new Set(tables.filter((t) => t.area === area).map((t) => t.number));
  for (let n = 1; n <= MAX_TABLE_NUMBER; n += 1) if (!used.has(n)) return n;
  return null;
}

/** The cafe's tables: Outside 1–3 and Inside 1–5. */
export function defaultCafeTables(): DineInTable[] {
  return [
    ...[1, 2, 3].map((n) => makeTable("outside", n)),
    ...[1, 2, 3, 4, 5].map((n) => makeTable("inside", n)),
  ];
}

export type DeliveryHoursMode = "opening" | "custom";

export type FulfillmentSettings = {
  pickup: {
    enabled: boolean;
    /** Preparation time before the first pickup slot. */
    leadMinutes: number;
    /** Distance between pickup slots. */
    slotMinutes: number;
  };
  delivery: {
    enabled: boolean;
    zones: DeliveryZone[];
    /** "opening" = the store's opening hours; "custom" = `customHours`. */
    hoursMode: DeliveryHoursMode;
    customHours: OpeningHours;
    /** Delivery orders stop this many minutes before closing. */
    closeBeforeMinutes: number;
  };
  dineIn: {
    enabled: boolean;
    tables: DineInTable[];
  };
};

export const PICKUP_SLOT_CHOICES = [10, 15, 20, 30, 60] as const;
export const MAX_LEAD_MINUTES = 240;
export const MAX_CLOSE_BEFORE_MINUTES = 240;
export const MAX_MONEY = 10000;

export const DEFAULT_FULFILLMENT: FulfillmentSettings = {
  pickup: { enabled: true, leadMinutes: 15, slotMinutes: 15 },
  delivery: {
    enabled: false,
    zones: [],
    hoursMode: "opening",
    customHours: DEFAULT_OPENING_HOURS,
    closeBeforeMinutes: 30,
  },
  dineIn: { enabled: false, tables: [] },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

/** Money rounded to agorot, clamped to [0, MAX_MONEY]. */
function clampMoney(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(Math.round(n * 100) / 100, 0), MAX_MONEY);
}

function text(value: unknown, max = 80): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeZone(raw: unknown, index: number): DeliveryZone | null {
  if (!isRecord(raw)) return null;
  const name = isRecord(raw.name) ? raw.name : {};
  const zone: DeliveryZone = {
    id: text(raw.id, 64) || `zone-${index + 1}`,
    name: { he: text(name.he), ar: text(name.ar), en: text(name.en) },
    fee: clampMoney(raw.fee),
    minOrder: clampMoney(raw.minOrder),
  };
  return zone;
}

/** Only tables with a known area and a whole number 1–99 are kept (anything else is dropped). */
function normalizeTable(raw: unknown): DineInTable | null {
  if (!isRecord(raw)) return null;
  const area = TABLE_AREAS.find((a) => a === raw.area);
  const n = typeof raw.number === "number" ? raw.number : typeof raw.number === "string" ? Number(raw.number) : NaN;
  if (!area || !Number.isInteger(n) || n < 1 || n > MAX_TABLE_NUMBER) return null;
  return makeTable(area, n);
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
}

/** Parses the stored value. Anything missing or invalid falls back to the defaults. */
export function normalizeFulfillmentSettings(raw: unknown): FulfillmentSettings {
  const source = isRecord(raw) ? raw : {};
  const pickup = isRecord(source.pickup) ? source.pickup : {};
  const delivery = isRecord(source.delivery) ? source.delivery : {};
  const dineIn = isRecord(source.dineIn) ? source.dineIn : {};
  const d = DEFAULT_FULFILLMENT;

  const slot = clampInt(pickup.slotMinutes, 5, 120, d.pickup.slotMinutes);

  return {
    pickup: {
      enabled: typeof pickup.enabled === "boolean" ? pickup.enabled : d.pickup.enabled,
      leadMinutes: clampInt(pickup.leadMinutes, 0, MAX_LEAD_MINUTES, d.pickup.leadMinutes),
      slotMinutes: slot,
    },
    delivery: {
      enabled: delivery.enabled === true,
      zones: uniqueById(
        (Array.isArray(delivery.zones) ? delivery.zones : [])
          .map(normalizeZone)
          .filter((zone): zone is DeliveryZone => zone !== null)
      ),
      hoursMode: delivery.hoursMode === "custom" ? "custom" : "opening",
      customHours: normalizeOpeningHours(delivery.customHours) ?? d.delivery.customHours,
      closeBeforeMinutes: clampInt(
        delivery.closeBeforeMinutes,
        0,
        MAX_CLOSE_BEFORE_MINUTES,
        d.delivery.closeBeforeMinutes
      ),
    },
    dineIn: {
      enabled: dineIn.enabled === true,
      tables: uniqueById(
        (Array.isArray(dineIn.tables) ? dineIn.tables : [])
          .map(normalizeTable)
          .filter((table): table is DineInTable => table !== null)
      ),
    },
  };
}

export type FulfillmentIssue =
  | { code: "zone_name_missing"; zoneId: string }
  /** Same area and number more than once; every copy after the first is reported. */
  | { code: "table_number_duplicate"; tableId: string };

/** Problems that block saving. Delivery/dine-in switched on with an empty list is allowed (warning only). */
export function fulfillmentIssues(settings: FulfillmentSettings): FulfillmentIssue[] {
  const issues: FulfillmentIssue[] = [];
  for (const zone of settings.delivery.zones) {
    if (!zone.name.he.trim() || !zone.name.ar.trim() || !zone.name.en.trim()) {
      issues.push({ code: "zone_name_missing", zoneId: zone.id });
    }
  }
  const seen = new Set<string>();
  for (const table of settings.dineIn.tables) {
    const id = tableId(table.area, table.number);
    if (seen.has(id)) issues.push({ code: "table_number_duplicate", tableId: id });
    else seen.add(id);
  }
  return issues;
}

/** The zone's name in the given language, falling back to the other languages. */
export function zoneName(zone: DeliveryZone, locale: keyof LocalizedName): string {
  return zone.name[locale] || zone.name.he || zone.name.ar || zone.name.en;
}

export function newFulfillmentId(prefix: "zone"): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
