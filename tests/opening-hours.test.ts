import { describe, expect, it } from "vitest";
import {
  DEFAULT_OPENING_HOURS,
  formatOpeningHours,
  legacyHoursText,
  normalizeOpeningHours,
  openingHoursText,
  resolveOpeningHours,
  type OpeningHours,
} from "@/lib/settings/opening-hours";

/** Pure, in-memory data — no Firebase, no network. */
describe("opening hours", () => {
  it("default: Sun–Thu 07:00–22:00, Fri and Sat closed, in all three languages", () => {
    expect(formatOpeningHours(DEFAULT_OPENING_HOURS, "he")).toBe("ראשון–חמישי: 07:00–22:00\nשישי–שבת: סגור");
    expect(formatOpeningHours(DEFAULT_OPENING_HOURS, "ar")).toBe("الأحد–الخميس: 07:00–22:00\nالجمعة–السبت: مغلق");
    expect(formatOpeningHours(DEFAULT_OPENING_HOURS, "en")).toBe("Sun–Thu: 07:00–22:00\nFri–Sat: Closed");
    expect(legacyHoursText(DEFAULT_OPENING_HOURS)).toBe("Sun–Thu: 07:00–22:00\nFri–Sat: Closed");
  });

  it("groups only consecutive days with identical hours", () => {
    const hours: OpeningHours = {
      ...DEFAULT_OPENING_HOURS,
      tue: { open: true, from: "08:00", to: "20:00" },
      fri: { open: true, from: "07:00", to: "14:00" },
    };
    expect(formatOpeningHours(hours, "en")).toBe(
      ["Sun–Mon: 07:00–22:00", "Tue: 08:00–20:00", "Wed–Thu: 07:00–22:00", "Fri: 07:00–14:00", "Sat: Closed"].join("\n")
    );
  });

  it("closed days with different stored times still group together", () => {
    const hours: OpeningHours = { ...DEFAULT_OPENING_HOURS, sat: { open: false, from: "09:00", to: "11:00" } };
    expect(formatOpeningHours(hours, "en").split("\n").at(-1)).toBe("Fri–Sat: Closed");
  });

  it("normalizes stored data: pads times, rejects bad ones, missing days are closed", () => {
    expect(normalizeOpeningHours(undefined)).toBeNull();
    expect(normalizeOpeningHours("Sun–Thu")).toBeNull();
    expect(normalizeOpeningHours({ foo: 1 })).toBeNull();
    const parsed = normalizeOpeningHours({ sun: { open: true, from: "7:30", to: "25:00" } });
    expect(parsed?.sun).toEqual({ open: true, from: "07:30", to: "22:00" });
    expect(parsed?.mon).toEqual({ open: false, from: "07:00", to: "22:00" });
  });

  it("stays compatible with the legacy free-text hours field", () => {
    const stored = { ...DEFAULT_OPENING_HOURS, sat: { open: true, from: "19:00", to: "23:00" } };
    // A stored schedule always wins.
    expect(resolveOpeningHours({ openingHours: stored, hours: "anything" })).toEqual(stored);
    // No schedule yet + empty or old default text → the new default.
    expect(resolveOpeningHours(undefined)).toEqual(DEFAULT_OPENING_HOURS);
    expect(resolveOpeningHours({ hours: "" })).toEqual(DEFAULT_OPENING_HOURS);
    expect(resolveOpeningHours({ hours: "Sun–Thu 7:00–22:00" })).toEqual(DEFAULT_OPENING_HOURS);
    expect(resolveOpeningHours({ hours: "Sun-Thu 07:00 - 22:00" })).toEqual(DEFAULT_OPENING_HOURS);
    // A customised free text is kept and shown as-is.
    expect(resolveOpeningHours({ hours: "א׳–ה׳ 8:00–20:00" })).toBeNull();
    expect(openingHoursText({ openingHours: null, hours: "א׳–ה׳ 8:00–20:00" }, "en")).toBe("א׳–ה׳ 8:00–20:00");
    expect(openingHoursText({ openingHours: stored, hours: "old" }, "he").split("\n").at(-1)).toBe("שבת: 19:00–23:00");
    expect(openingHoursText(null, "he")).toBe("");
  });
});
