import { OPENING_DAY_KEYS, type OpeningHours } from "@/lib/settings/opening-hours";
import { BUSINESS_TIMEZONE } from "@/lib/orders/status";
import type { DeliveryZone, FulfillmentSettings } from "./settings";

/**
 * When pickup and delivery are available, from the weekly schedule.
 * Pure functions: the time is always passed in, and all local times are in the
 * business timezone (Asia/Jerusalem), so summer/winter time is handled by Intl.
 */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type LocalDate = { year: number; month: number; day: number };

/** An open period in absolute time. `end` is exclusive. */
export type TimeWindow = { start: Date; end: Date };

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of `at` in the given timezone. */
export function localParts(at: Date, timeZone = BUSINESS_TIMEZONE) {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(at)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year!,
    month: parts.month!,
    day: parts.day!,
    hour: parts.hour! % 24,
    minute: parts.minute!,
    second: parts.second!,
  };
}

/** Offset of the timezone from UTC at `at`, in ms (Israel: +2h winter, +3h summer). */
function offsetAt(at: Date, timeZone: string): number {
  const p = localParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Absolute time of a local date + minutes after local midnight. */
export function localToDate(date: LocalDate, minutes: number, timeZone = BUSINESS_TIMEZONE): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day) + minutes * MINUTE;
  const first = guess - offsetAt(new Date(guess), timeZone);
  const second = guess - offsetAt(new Date(first), timeZone);
  return new Date(second);
}

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function dayKeyOf(date: LocalDate) {
  return OPENING_DAY_KEYS[new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay()]!;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function localDateOf(at: Date, timeZone = BUSINESS_TIMEZONE): LocalDate {
  const p = localParts(at, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** "HH:MM" of `at` in the business timezone. */
export function formatLocalTime(at: Date, timeZone = BUSINESS_TIMEZONE): string {
  const p = localParts(at, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/**
 * The open window that starts on a local day, or null when closed that day.
 * `to` earlier than `from` runs past midnight; `from` equal to `to` counts as closed.
 * `closeBeforeMinutes` cuts the end of the window (e.g. last delivery order).
 */
function windowForDay(
  hours: OpeningHours,
  date: LocalDate,
  closeBeforeMinutes: number,
  timeZone: string
): TimeWindow | null {
  const day = hours[dayKeyOf(date)];
  if (!day?.open || day.from === day.to) return null;
  const from = toMinutes(day.from);
  const to = toMinutes(day.to);
  const start = localToDate(date, from, timeZone);
  const end = to > from ? localToDate(date, to, timeZone) : localToDate(addLocalDays(date, 1), to, timeZone);
  const cutEnd = new Date(end.getTime() - closeBeforeMinutes * MINUTE);
  return cutEnd > start ? { start, end: cutEnd } : null;
}

/** Open windows overlapping [from, to), oldest first. Includes the window from the night before. */
export function windowsBetween(
  hours: OpeningHours,
  from: Date,
  to: Date,
  options: { closeBeforeMinutes?: number; timeZone?: string } = {}
): TimeWindow[] {
  const timeZone = options.timeZone ?? BUSINESS_TIMEZONE;
  const cut = options.closeBeforeMinutes ?? 0;
  const result: TimeWindow[] = [];
  const first = addLocalDays(localDateOf(from, timeZone), -1);
  const days = Math.ceil((to.getTime() - from.getTime()) / DAY) + 2;
  for (let i = 0; i <= days; i += 1) {
    const window = windowForDay(hours, addLocalDays(first, i), cut, timeZone);
    if (window && window.end > from && window.start < to) result.push(window);
  }
  return result;
}

/** The window containing `at`, or null when closed at that moment. */
export function windowAt(
  hours: OpeningHours,
  at: Date,
  options: { closeBeforeMinutes?: number; timeZone?: string } = {}
): TimeWindow | null {
  const next = new Date(at.getTime() + 1);
  return windowsBetween(hours, at, next, options).find((w) => w.start <= at && at < w.end) ?? null;
}

export function isOpenAt(hours: OpeningHours, at: Date, timeZone = BUSINESS_TIMEZONE): boolean {
  return windowAt(hours, at, { timeZone }) !== null;
}

/** Start of the next open window after `at` (within 8 days), or null when never open. */
export function nextOpeningAfter(
  hours: OpeningHours,
  at: Date,
  options: { closeBeforeMinutes?: number; timeZone?: string } = {}
): Date | null {
  const windows = windowsBetween(hours, at, new Date(at.getTime() + 8 * DAY), options);
  return windows.find((w) => w.start > at)?.start ?? null;
}

/**
 * Pickup times offered at `at`: every `slotMinutes` on the local clock, starting no earlier than
 * `leadMinutes` from now and from opening, and before closing. Only windows that start on
 * today's local date (or the one still open from last night) are used; no pre-orders for tomorrow.
 */
export function pickupSlots(
  hours: OpeningHours,
  pickup: FulfillmentSettings["pickup"],
  at: Date,
  timeZone = BUSINESS_TIMEZONE
): Date[] {
  if (!pickup.enabled) return [];
  const today = localDateOf(at, timeZone);
  const endOfToday = localToDate(addLocalDays(today, 1), 0, timeZone);
  const slot = Math.max(pickup.slotMinutes, 1);
  const lead = Math.max(pickup.leadMinutes, 0) * MINUTE;
  const slots: Date[] = [];
  // When clocks go back, 01:00–02:00 happens twice: offer each wall-clock time once.
  const seen = new Set<string>();

  for (const window of windowsBetween(hours, at, endOfToday, { timeZone })) {
    if (window.start >= endOfToday) continue;
    const earliest = Math.max(at.getTime(), window.start.getTime()) + lead;
    // Round up to the slot grid of the local clock (e.g. :00, :15, :30, :45).
    const local = localParts(new Date(earliest), timeZone);
    const minutesOfDay = local.hour * 60 + local.minute + (local.second > 0 || earliest % MINUTE > 0 ? 1 : 0);
    const rounded = Math.ceil(minutesOfDay / slot) * slot;
    let t = localToDate(localDateOf(new Date(earliest), timeZone), rounded, timeZone).getTime();
    while (t < window.end.getTime()) {
      const label = formatLocalTime(new Date(t), timeZone);
      if (!seen.has(label)) {
        seen.add(label);
        slots.push(new Date(t));
      }
      t += slot * MINUTE;
    }
  }
  return slots;
}

/** Weekly schedule deliveries follow (before the "close before" cut). */
export function deliveryHours(settings: FulfillmentSettings, openingHours: OpeningHours): OpeningHours {
  return settings.delivery.hoursMode === "custom" ? settings.delivery.customHours : openingHours;
}

export type DeliveryAvailability =
  | { available: true; until: Date }
  | { available: false; reason: "disabled" | "no_zones" | "closed"; nextAt: Date | null };

/** Whether a delivery order can be placed at `at`. */
export function deliveryAvailability(
  settings: FulfillmentSettings,
  openingHours: OpeningHours,
  at: Date,
  timeZone = BUSINESS_TIMEZONE
): DeliveryAvailability {
  if (!settings.delivery.enabled) return { available: false, reason: "disabled", nextAt: null };
  if (settings.delivery.zones.length === 0) return { available: false, reason: "no_zones", nextAt: null };
  const hours = deliveryHours(settings, openingHours);
  const options = { closeBeforeMinutes: settings.delivery.closeBeforeMinutes, timeZone };
  const window = windowAt(hours, at, options);
  if (window) return { available: true, until: window.end };
  return { available: false, reason: "closed", nextAt: nextOpeningAfter(hours, at, options) };
}

export type DeliveryQuote =
  | { ok: true; zone: DeliveryZone; fee: number }
  | { ok: false; reason: "unknown_zone" }
  | { ok: false; reason: "below_minimum"; zone: DeliveryZone; minOrder: number };

/** Delivery fee for a zone and order subtotal (before the fee). */
export function quoteDelivery(
  settings: FulfillmentSettings,
  zoneId: string,
  subtotal: number
): DeliveryQuote {
  const zone = settings.delivery.zones.find((z) => z.id === zoneId);
  if (!zone) return { ok: false, reason: "unknown_zone" };
  if (zone.minOrder > 0 && subtotal < zone.minOrder) {
    return { ok: false, reason: "below_minimum", zone, minOrder: zone.minOrder };
  }
  return { ok: true, zone, fee: zone.fee };
}
