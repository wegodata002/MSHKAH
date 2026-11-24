import { describe, expect, it } from "vitest";
import { DEFAULT_OPENING_HOURS, type OpeningHours } from "@/lib/settings/opening-hours";
import {
  deliveryAvailability,
  formatLocalTime,
  isOpenAt,
  localToDate,
  nextOpeningAfter,
  pickupSlots,
  quoteDelivery,
  windowAt,
  windowsBetween,
} from "@/lib/fulfillment/availability";
import {
  DEFAULT_FULFILLMENT,
  MAX_TABLE_NUMBER,
  defaultCafeTables,
  fulfillmentIssues,
  makeTable,
  nextTableNumber,
  normalizeFulfillmentSettings,
  tableId,
  tableLabel,
  type FulfillmentSettings,
} from "@/lib/fulfillment/settings";

/** Pure, in-memory data — no Firebase, no network, no real clock. */

/** Israel wall-clock time → Date. */
const il = (y: number, mo: number, d: number, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return localToDate({ year: y, month: mo, day: d }, h! * 60 + m!);
};
const times = (dates: Date[]) => dates.map((d) => formatLocalTime(d));

const PICKUP = DEFAULT_FULFILLMENT.pickup; // enabled, lead 15, slot 15

function withDelivery(patch: Partial<FulfillmentSettings["delivery"]> = {}): FulfillmentSettings {
  return {
    ...DEFAULT_FULFILLMENT,
    delivery: {
      ...DEFAULT_FULFILLMENT.delivery,
      enabled: true,
      zones: [{ id: "z1", name: { he: "מרכז", ar: "المركز", en: "Center" }, fee: 15, minOrder: 60 }],
      ...patch,
    },
  };
}

// Nov 2026: Sun 22 … Thu 26, Fri 27, Sat 28 (winter time, UTC+2).
describe("opening hours at a given moment", () => {
  it("open from opening time, closed at closing time (end is exclusive)", () => {
    expect(isOpenAt(DEFAULT_OPENING_HOURS, il(2026, 11, 24, "06:59"))).toBe(false);
    expect(isOpenAt(DEFAULT_OPENING_HOURS, il(2026, 11, 24, "07:00"))).toBe(true);
    expect(isOpenAt(DEFAULT_OPENING_HOURS, il(2026, 11, 24, "21:59"))).toBe(true);
    expect(isOpenAt(DEFAULT_OPENING_HOURS, il(2026, 11, 24, "22:00"))).toBe(false);
  });

  it("Friday and Saturday closed by default; next opening is Sunday 07:00", () => {
    expect(isOpenAt(DEFAULT_OPENING_HOURS, il(2026, 11, 27, "10:00"))).toBe(false);
    expect(isOpenAt(DEFAULT_OPENING_HOURS, il(2026, 11, 28, "12:00"))).toBe(false);
    expect(nextOpeningAfter(DEFAULT_OPENING_HOURS, il(2026, 11, 27, "10:00"))).toEqual(il(2026, 11, 29, "07:00"));
    expect(nextOpeningAfter(DEFAULT_OPENING_HOURS, il(2026, 11, 26, "22:30"))).toEqual(il(2026, 11, 29, "07:00"));
  });

  it("a short Friday works", () => {
    const hours: OpeningHours = { ...DEFAULT_OPENING_HOURS, fri: { open: true, from: "08:00", to: "14:00" } };
    expect(isOpenAt(hours, il(2026, 11, 27, "13:59"))).toBe(true);
    expect(isOpenAt(hours, il(2026, 11, 27, "14:00"))).toBe(false);
    expect(isOpenAt(hours, il(2026, 11, 28, "10:00"))).toBe(false);
  });

  it("a day switched off, and a day with equal from/to, count as closed", () => {
    const hours: OpeningHours = {
      ...DEFAULT_OPENING_HOURS,
      tue: { open: false, from: "07:00", to: "22:00" },
      wed: { open: true, from: "09:00", to: "09:00" },
    };
    expect(isOpenAt(hours, il(2026, 11, 24, "12:00"))).toBe(false);
    expect(isOpenAt(hours, il(2026, 11, 25, "12:00"))).toBe(false);
    expect(nextOpeningAfter(hours, il(2026, 11, 24, "12:00"))).toEqual(il(2026, 11, 26, "07:00"));
  });

  it("never open → no next opening", () => {
    const closed = Object.fromEntries(
      Object.entries(DEFAULT_OPENING_HOURS).map(([k, v]) => [k, { ...v, open: false }])
    ) as OpeningHours;
    expect(nextOpeningAfter(closed, il(2026, 11, 24, "12:00"))).toBeNull();
    expect(pickupSlots(closed, PICKUP, il(2026, 11, 24, "12:00"))).toEqual([]);
  });
});

describe("past midnight", () => {
  // Thursday 18:00 → Friday 02:00, Friday itself closed.
  const late: OpeningHours = { ...DEFAULT_OPENING_HOURS, thu: { open: true, from: "18:00", to: "02:00" } };

  it("Thursday's night window stays open into (closed) Friday", () => {
    expect(isOpenAt(late, il(2026, 11, 26, "23:59"))).toBe(true);
    expect(isOpenAt(late, il(2026, 11, 27, "00:00"))).toBe(true);
    expect(isOpenAt(late, il(2026, 11, 27, "01:59"))).toBe(true);
    expect(isOpenAt(late, il(2026, 11, 27, "02:00"))).toBe(false);
    expect(windowAt(late, il(2026, 11, 27, "01:00"))).toEqual({
      start: il(2026, 11, 26, "18:00"),
      end: il(2026, 11, 27, "02:00"),
    });
  });

  it("closing exactly at midnight (to 00:00)", () => {
    const hours: OpeningHours = { ...DEFAULT_OPENING_HOURS, tue: { open: true, from: "07:00", to: "00:00" } };
    expect(isOpenAt(hours, il(2026, 11, 24, "23:59"))).toBe(true);
    expect(isOpenAt(hours, il(2026, 11, 25, "00:00"))).toBe(false);
  });

  it("pickup slots after midnight continue last night's window and stop at closing", () => {
    expect(times(pickupSlots(late, PICKUP, il(2026, 11, 27, "01:10")))).toEqual(["01:30", "01:45"]);
  });

  it("pickup slots late in the evening run past midnight until closing", () => {
    expect(times(pickupSlots(late, PICKUP, il(2026, 11, 26, "23:20")))).toEqual([
      "23:45", "00:00", "00:15", "00:30", "00:45", "01:00", "01:15", "01:30", "01:45",
    ]);
  });
});

describe("pickup slots", () => {
  it("lead time then rounded up to the 15-minute grid, last slot before closing", () => {
    const slots = times(pickupSlots(DEFAULT_OPENING_HOURS, PICKUP, il(2026, 11, 24, "21:07")));
    expect(slots).toEqual(["21:30", "21:45"]);
  });

  it("an exact grid time is not skipped", () => {
    expect(times(pickupSlots(DEFAULT_OPENING_HOURS, PICKUP, il(2026, 11, 24, "21:15")))).toEqual(["21:30", "21:45"]);
  });

  it("before opening: first slot is opening + preparation time", () => {
    const slots = pickupSlots(DEFAULT_OPENING_HOURS, PICKUP, il(2026, 11, 24, "05:00"));
    expect(formatLocalTime(slots[0]!)).toBe("07:15");
    expect(formatLocalTime(slots.at(-1)!)).toBe("21:45");
  });

  it("after closing, on a closed day, or with pickup switched off: no slots (no pre-orders for tomorrow)", () => {
    expect(pickupSlots(DEFAULT_OPENING_HOURS, PICKUP, il(2026, 11, 24, "21:50"))).toEqual([]);
    expect(pickupSlots(DEFAULT_OPENING_HOURS, PICKUP, il(2026, 11, 27, "10:00"))).toEqual([]);
    expect(pickupSlots(DEFAULT_OPENING_HOURS, { ...PICKUP, enabled: false }, il(2026, 11, 24, "12:00"))).toEqual([]);
  });

  it("other slot sizes and lead times", () => {
    const slots = pickupSlots(DEFAULT_OPENING_HOURS, { enabled: true, leadMinutes: 30, slotMinutes: 20 }, il(2026, 11, 24, "20:55"));
    expect(times(slots)).toEqual(["21:40"]);
  });
});

describe("summer / winter time (Asia/Jerusalem)", () => {
  // 2026: summer time from Fri 27 Mar 02:00, back to winter time Sun 25 Oct 02:00.
  it("07:00 local is 05:00 UTC in winter and 04:00 UTC in summer", () => {
    expect(il(2026, 11, 24, "07:00").toISOString()).toBe("2026-11-24T05:00:00.000Z");
    expect(il(2026, 7, 14, "07:00").toISOString()).toBe("2026-07-14T04:00:00.000Z");
  });

  it("opening time is right on the first day of each clock", () => {
    // Sunday 29 Mar (first Sunday of summer time) and Sunday 25 Oct (first day of winter time).
    expect(isOpenAt(DEFAULT_OPENING_HOURS, new Date("2026-03-29T03:59:00Z"))).toBe(false);
    expect(isOpenAt(DEFAULT_OPENING_HOURS, new Date("2026-03-29T04:00:00Z"))).toBe(true);
    expect(isOpenAt(DEFAULT_OPENING_HOURS, new Date("2026-10-25T04:59:00Z"))).toBe(false);
    expect(isOpenAt(DEFAULT_OPENING_HOURS, new Date("2026-10-25T05:00:00Z"))).toBe(true);
  });

  it("a night window over the change back to winter time lasts one hour longer", () => {
    const hours: OpeningHours = { ...DEFAULT_OPENING_HOURS, sat: { open: true, from: "20:00", to: "03:00" } };
    const [window] = windowsBetween(hours, il(2026, 10, 24, "21:00"), il(2026, 10, 24, "21:01"));
    expect(window!.start.toISOString()).toBe("2026-10-24T17:00:00.000Z"); // 20:00 summer time
    expect(window!.end.toISOString()).toBe("2026-10-25T01:00:00.000Z"); // 03:00 winter time
    expect(window!.end.getTime() - window!.start.getTime()).toBe(8 * 3600_000);
  });

  it("pickup slots stay on the local clock across the change", () => {
    const hours: OpeningHours = { ...DEFAULT_OPENING_HOURS, sat: { open: true, from: "20:00", to: "03:00" } };
    const slots = times(pickupSlots(hours, { enabled: true, leadMinutes: 0, slotMinutes: 30 }, il(2026, 10, 25, "00:40")));
    // 01:00–02:00 happens twice (summer, then winter): each time is offered once, on the :00/:30 grid,
    // until 03:00; then Sunday's own window (07:00–22:00) follows.
    const night = slots.filter((s) => s < "06:00");
    expect(night).toEqual(["01:00", "01:30", "02:00", "02:30"]);
    expect(slots[night.length]).toBe("07:00");
    expect(slots.at(-1)).toBe("21:30");
  });
});

describe("delivery availability", () => {
  it("off by default", () => {
    const result = deliveryAvailability(DEFAULT_FULFILLMENT, DEFAULT_OPENING_HOURS, il(2026, 11, 24, "12:00"));
    expect(result).toEqual({ available: false, reason: "disabled", nextAt: null });
  });

  it("switched on without zones is still unavailable", () => {
    const result = deliveryAvailability(withDelivery({ zones: [] }), DEFAULT_OPENING_HOURS, il(2026, 11, 24, "12:00"));
    expect(result).toEqual({ available: false, reason: "no_zones", nextAt: null });
  });

  it("follows opening hours and stops 30 minutes before closing", () => {
    const s = withDelivery();
    expect(deliveryAvailability(s, DEFAULT_OPENING_HOURS, il(2026, 11, 24, "21:29"))).toEqual({
      available: true,
      until: il(2026, 11, 24, "21:30"),
    });
    expect(deliveryAvailability(s, DEFAULT_OPENING_HOURS, il(2026, 11, 24, "21:30"))).toEqual({
      available: false,
      reason: "closed",
      nextAt: il(2026, 11, 25, "07:00"),
    });
  });

  it("Friday and Saturday closed → next delivery Sunday", () => {
    const result = deliveryAvailability(withDelivery(), DEFAULT_OPENING_HOURS, il(2026, 11, 27, "12:00"));
    expect(result).toEqual({ available: false, reason: "closed", nextAt: il(2026, 11, 29, "07:00") });
  });

  it("custom delivery hours, and the cut across midnight", () => {
    const custom: OpeningHours = {
      ...DEFAULT_OPENING_HOURS,
      thu: { open: true, from: "18:00", to: "00:15" },
    };
    const s = withDelivery({ hoursMode: "custom", customHours: custom });
    expect(deliveryAvailability(s, DEFAULT_OPENING_HOURS, il(2026, 11, 26, "23:44")).available).toBe(true);
    expect(deliveryAvailability(s, DEFAULT_OPENING_HOURS, il(2026, 11, 26, "23:45")).available).toBe(false);
  });

  it("a cut longer than the window leaves no delivery that day", () => {
    const hours: OpeningHours = { ...DEFAULT_OPENING_HOURS, tue: { open: true, from: "07:00", to: "07:20" } };
    const s = withDelivery({ closeBeforeMinutes: 30 });
    expect(deliveryAvailability(s, hours, il(2026, 11, 24, "07:10")).available).toBe(false);
  });
});

describe("delivery quote", () => {
  it("fee of the chosen zone; minimum order enforced; unknown zone rejected", () => {
    const s = withDelivery();
    expect(quoteDelivery(s, "z1", 80)).toMatchObject({ ok: true, fee: 15 });
    expect(quoteDelivery(s, "z1", 60)).toMatchObject({ ok: true, fee: 15 });
    expect(quoteDelivery(s, "z1", 59.9)).toMatchObject({ ok: false, reason: "below_minimum", minOrder: 60 });
    expect(quoteDelivery(s, "nope", 100)).toEqual({ ok: false, reason: "unknown_zone" });
  });
});

describe("stored settings", () => {
  it("defaults: pickup on (15/15), delivery off with no zones, opening hours, 30 min cut; dine-in off", () => {
    expect(normalizeFulfillmentSettings(undefined)).toEqual(DEFAULT_FULFILLMENT);
    expect(DEFAULT_FULFILLMENT.pickup).toEqual({ enabled: true, leadMinutes: 15, slotMinutes: 15 });
    expect(DEFAULT_FULFILLMENT.delivery).toMatchObject({ enabled: false, zones: [], hoursMode: "opening", closeBeforeMinutes: 30 });
    expect(DEFAULT_FULFILLMENT.dineIn).toEqual({ enabled: false, tables: [] });
  });

  it("cleans bad values and keeps good ones", () => {
    const result = normalizeFulfillmentSettings({
      pickup: { enabled: false, leadMinutes: -5, slotMinutes: "20" },
      delivery: {
        enabled: true,
        hoursMode: "weird",
        closeBeforeMinutes: 9999,
        zones: [
          { id: "a", name: { he: " צפון ", ar: "الشمال", en: "North" }, fee: "12.345", minOrder: -1 },
          { id: "a", name: { he: "כפול" }, fee: 1 },
          "junk",
        ],
      },
      dineIn: {
        enabled: "yes",
        tables: [
          { id: "ignored", area: "inside", number: "2" },
          { area: "outside", number: 1 },
          { id: "t1", label: " 1 " }, // old free-label shape: dropped
          { area: "roof", number: 1 },
          { area: "inside", number: 0 },
          { area: "inside", number: 100 },
          { area: "inside", number: 2.5 },
          null,
        ],
      },
    });
    expect(result.pickup).toEqual({ enabled: false, leadMinutes: 0, slotMinutes: 20 });
    expect(result.delivery.hoursMode).toBe("opening");
    expect(result.delivery.closeBeforeMinutes).toBe(240);
    expect(result.delivery.zones).toEqual([
      { id: "a", name: { he: "צפון", ar: "الشمال", en: "North" }, fee: 12.35, minOrder: 0 },
    ]);
    // id is always rebuilt from area + number; invalid tables are dropped.
    expect(result.dineIn).toEqual({
      enabled: false,
      tables: [
        { id: "inside-2", area: "inside", number: 2 },
        { id: "outside-1", area: "outside", number: 1 },
      ],
    });
  });

  it("blocks saving a zone without all three names, or the same table number twice in one area", () => {
    const s = withDelivery({
      zones: [{ id: "z2", name: { he: "דרום", ar: "", en: "South" }, fee: 10, minOrder: 0 }],
    });
    s.dineIn = {
      enabled: false,
      tables: [makeTable("inside", 1), makeTable("outside", 1), makeTable("inside", 1)],
    };
    expect(fulfillmentIssues(s)).toEqual([
      { code: "zone_name_missing", zoneId: "z2" },
      { code: "table_number_duplicate", tableId: "inside-1" },
    ]);
    expect(fulfillmentIssues(DEFAULT_FULFILLMENT)).toEqual([]);
  });
});

describe("cafe tables", () => {
  it("the cafe's tables: Outside 1–3 and Inside 1–5, with stable ids for QR links", () => {
    const tables = defaultCafeTables();
    expect(tables.map((t) => t.id)).toEqual([
      "outside-1", "outside-2", "outside-3",
      "inside-1", "inside-2", "inside-3", "inside-4", "inside-5",
    ]);
    expect(fulfillmentIssues({ ...DEFAULT_FULFILLMENT, dineIn: { enabled: true, tables } })).toEqual([]);
  });

  it("table names in three languages", () => {
    expect(tableLabel(makeTable("outside", 1), "he")).toBe("חוץ 1");
    expect(tableLabel(makeTable("inside", 3), "he")).toBe("פנים 3");
    expect(tableLabel(makeTable("outside", 2), "ar")).toBe("خارج 2");
    expect(tableLabel(makeTable("inside", 5), "ar")).toBe("داخل 5");
    expect(tableLabel(makeTable("outside", 3), "en")).toBe("Outside 3");
    expect(tableLabel(makeTable("inside", 4), "en")).toBe("Inside 4");
  });

  it("adding a table picks the smallest free number in that area only", () => {
    const tables = defaultCafeTables();
    expect(nextTableNumber(tables, "outside")).toBe(4);
    expect(nextTableNumber(tables, "inside")).toBe(6);
    const gap = tables.filter((t) => t.id !== "inside-2");
    expect(nextTableNumber(gap, "inside")).toBe(2);
    expect(nextTableNumber(gap, "outside")).toBe(4);
    expect(nextTableNumber([], "outside")).toBe(1);
    const full = Array.from({ length: MAX_TABLE_NUMBER }, (_, i) => makeTable("inside", i + 1));
    expect(nextTableNumber(full, "inside")).toBeNull();
    expect(nextTableNumber(full, "outside")).toBe(1);
  });

  it("the same number in different areas is fine", () => {
    const tables = [makeTable("outside", 1), makeTable("inside", 1)];
    expect(fulfillmentIssues({ ...DEFAULT_FULFILLMENT, dineIn: { enabled: true, tables } })).toEqual([]);
    expect(tableId("inside", 1)).not.toBe(tableId("outside", 1));
  });
});
