import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_OPENING_HOURS, type OpeningHours } from "@/lib/settings/opening-hours";
import { DEFAULT_FULFILLMENT, type FulfillmentSettings } from "@/lib/fulfillment/settings";
import { deliveryAvailability, localToDate, pickupAvailability } from "@/lib/fulfillment/availability";
import { homeAvailabilityStatus } from "@/features/catalog/home-availability";
import { describeNext } from "@/features/checkout/describe-next";

/** Pure — no React, no Firebase, no real clock. November 2026, Israel time. */
const at = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return localToDate({ year: 2026, month: 11, day }, h! * 60 + m!);
};

const DELIVERY_ON: FulfillmentSettings = {
  ...DEFAULT_FULFILLMENT,
  delivery: {
    ...DEFAULT_FULFILLMENT.delivery,
    enabled: true,
    zones: [{ id: "z", name: { he: "עין מאהל", ar: "عين ماهل", en: "Ein Mahel" }, fee: 15, minOrder: 50 }],
  },
};

/** Same inputs the home page gets from useFulfillmentAvailability. */
function status(now: Date, settings: FulfillmentSettings = DELIVERY_ON, hours: OpeningHours = DEFAULT_OPENING_HOURS) {
  const d = deliveryAvailability(settings, hours, now);
  const delivery = !d.available && (d.reason === "disabled" || d.reason === "no_zones") ? null : d;
  return homeAvailabilityStatus({ pickup: pickupAvailability(hours, settings.pickup, now), delivery, openingHours: hours, now });
}

describe("home page status", () => {
  it("delivery available now", () => {
    expect(status(at(24, "12:00"))).toEqual({ kind: "delivery" });
  });

  it("delivery switched off → pickup only", () => {
    expect(status(at(24, "12:00"), DEFAULT_FULFILLMENT)).toEqual({ kind: "pickup" });
  });

  it("after the last delivery order (21:30) while a pickup time is still left → pickup only", () => {
    expect(status(at(24, "21:30"))).toEqual({ kind: "pickup" });
  });

  it("no pickup times left today → closed, opens tomorrow 07:00", () => {
    expect(status(at(24, "21:40"))).toEqual({ kind: "closed", nextAt: at(25, "07:00") });
  });

  it("before opening the same day → opens today at 07:00", () => {
    expect(status(at(24, "06:30"))).toEqual({ kind: "opens_today", at: at(24, "07:00") });
  });

  it("the real next opening day: Friday → Sunday, Monday night → tomorrow", () => {
    expect(status(at(27, "12:00"))).toEqual({ kind: "closed", nextAt: at(29, "07:00") });
    expect(status(at(23, "23:00"))).toEqual({ kind: "closed", nextAt: at(24, "07:00") });
  });

  it("a day closed in the settings is skipped", () => {
    const hours: OpeningHours = { ...DEFAULT_OPENING_HOURS, sun: { open: false, from: "07:00", to: "22:00" } };
    expect(status(at(27, "12:00"), DELIVERY_ON, hours)).toEqual({ kind: "closed", nextAt: at(30, "07:00") });
  });

  it("pickup switched off: delivery still shows; with no delivery while open → nothing shown", () => {
    const pickupOff = { ...DELIVERY_ON, pickup: { ...DELIVERY_ON.pickup, enabled: false } };
    expect(status(at(24, "12:00"), pickupOff)).toEqual({ kind: "delivery" });
    expect(status(at(24, "12:00"), { ...DEFAULT_FULFILLMENT, pickup: { ...DEFAULT_FULFILLMENT.pickup, enabled: false } })).toBeNull();
  });

  it("never open → closed with no next time", () => {
    const closed = Object.fromEntries(
      Object.entries(DEFAULT_OPENING_HOURS).map(([k, v]) => [k, { ...v, open: false }])
    ) as OpeningHours;
    expect(status(at(24, "12:00"), DELIVERY_ON, closed)).toEqual({ kind: "closed", nextAt: null });
  });
});

describe("home page status text", () => {
  const seed = readFileSync(resolve(process.cwd(), "src/data/ui-translations-seed.ts"), "utf8");
  const t = (li: number) => (key: string) =>
    [...seed.matchAll(new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*"([^"]*)"`, "g"))].map((m) => m[1]!)[li] ?? key;

  it("one short line, in three languages", () => {
    const he = t(0);
    expect(he("home.status.delivery")).toBe("משלוח זמין עכשיו");
    expect(he("home.status.pickup")).toBe("איסוף עצמי בלבד כרגע");
    expect(he("home.status.closedUntil").replace("{when}", describeNext(he, "he", at(29, "07:00"), at(27, "12:00"), "at"))).toBe(
      "סגור · נפתח ביום ראשון ב-07:00"
    );
    expect(he("home.status.closedUntil").replace("{when}", describeNext(he, "he", at(24, "07:00"), at(23, "23:00"), "at"))).toBe(
      "סגור · נפתח מחר ב-07:00"
    );
    expect(he("home.status.opens").replace("{when}", describeNext(he, "he", at(24, "07:00"), at(24, "06:30"), "at"))).toBe(
      "נפתח היום ב-07:00"
    );
    const ar = t(1);
    expect(ar("home.status.closedUntil").replace("{when}", describeNext(ar, "ar", at(29, "07:00"), at(27, "12:00"), "at"))).toBe(
      "مغلق · يفتح يوم الأحد الساعة 07:00"
    );
    const en = t(2);
    expect(en("home.status.closedUntil").replace("{when}", describeNext(en, "en", at(29, "07:00"), at(27, "12:00"), "at"))).toBe(
      "Closed · opens Sunday at 07:00"
    );
  });
});
