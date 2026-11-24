import type { Locale } from "@/lib/i18n/types";
import {
  deliveryAvailability,
  formatLocalTime,
  isOpenAt,
  nextOpeningAfter,
  pickupAvailability,
  windowAt,
} from "@/lib/fulfillment/availability";
import { zoneName, type DeliveryZone, type FulfillmentSettings } from "@/lib/fulfillment/settings";
import { formatOpeningHours, type OpeningHours } from "@/lib/settings/opening-hours";
import { describeNext } from "@/features/checkout/describe-next";
import { normalizeText } from "@/lib/assistant/fuzzy";

/**
 * Assistant answers about delivery, pickup and opening hours, from the real settings at `now`.
 * Pure: shared by the server engine and the browser fallback. No WhatsApp anywhere.
 */

export type FulfillmentFacts = {
  fulfillment: FulfillmentSettings;
  openingHours: OpeningHours;
  now: Date;
  /** Store phone from the settings ("" when not set). */
  phone: string;
};

export type FulfillmentAnswer = { text: string; showContact: boolean };

const WHEN: Record<Locale, Record<string, string>> = {
  he: {
    "checkout.when.today.at": "היום ב-{time}",
    "checkout.when.tomorrow.at": "מחר ב-{time}",
    "checkout.when.day.at": "ביום {day} ב-{time}",
    "checkout.when.today.from": "היום מ-{time}",
    "checkout.when.tomorrow.from": "מחר מ-{time}",
    "checkout.when.day.from": "ביום {day} מ-{time}",
  },
  ar: {
    "checkout.when.today.at": "اليوم الساعة {time}",
    "checkout.when.tomorrow.at": "غدًا الساعة {time}",
    "checkout.when.day.at": "يوم {day} الساعة {time}",
    "checkout.when.today.from": "اليوم من الساعة {time}",
    "checkout.when.tomorrow.from": "غدًا من الساعة {time}",
    "checkout.when.day.from": "يوم {day} من الساعة {time}",
  },
  en: {
    "checkout.when.today.at": "today at {time}",
    "checkout.when.tomorrow.at": "tomorrow at {time}",
    "checkout.when.day.at": "{day} at {time}",
    "checkout.when.today.from": "today from {time}",
    "checkout.when.tomorrow.from": "tomorrow from {time}",
    "checkout.when.day.from": "{day} from {time}",
  },
};

function when(locale: Locale, next: Date, now: Date, style: "at" | "from"): string {
  const dict = WHEN[locale] ?? WHEN.en;
  return describeNext((key) => dict[key] ?? key, locale, next, now, style);
}

const money = (n: number) => `₪${Number.isInteger(n) ? n : n.toFixed(2)}`;

const COPY = {
  he: {
    deliveryNow: "כן, יש משלוח עכשיו 🚚",
    deliveryClosed: (w: string) => `כרגע אין משלוח. משלוח זמין ${w}.`,
    deliveryOff: "כרגע אין משלוחים — אפשר להזמין לאיסוף עצמי.",
    zoneLine: (name: string, fee: number, min: number) =>
      `• ${name} — דמי משלוח ${money(fee)}${min > 0 ? `, מינימום הזמנה ${money(min)}` : ""}`,
    untilToday: (time: string) => `הזמנות משלוח היום עד ${time}.`,
    otherArea: (phone: string) => (phone ? `לאזור אחר — צרו קשר עם החנות: ${phone}` : "לאזור אחר — צרו קשר עם החנות."),
    questions: (phone: string) => (phone ? `לשאלות: ${phone}` : ""),
    zoneNow: (name: string, fee: number, min: number, until: string) =>
      `כן — משלוח ל${name}: דמי משלוח ${money(fee)}${min > 0 ? `, מינימום הזמנה ${money(min)}` : ""}. הזמנות משלוח היום עד ${until}.`,
    zoneClosed: (name: string, fee: number, min: number, w: string) =>
      `משלוח ל${name}: דמי משלוח ${money(fee)}${min > 0 ? `, מינימום הזמנה ${money(min)}` : ""}. כרגע אין משלוח — משלוח זמין ${w}.`,
    pickupNow: (time: string) => `כן, אפשר להזמין לאיסוף עצמי 🛍️\nהשעה הקרובה לאיסוף: ${time}.`,
    pickupBeforeOpening: (w: string, first: string) => `נפתח ${w}. אפשר להזמין לאיסוף מ-${first}.`,
    pickupClosed: (w: string) => `כרגע סגור. נפתח ${w}.`,
    pickupOff: "כרגע אין איסוף עצמי.",
    closedNoNext: "כרגע סגור.",
    hoursTitle: "שעות פתיחה:",
    nowOpen: (until: string) => `עכשיו: פתוח עד ${until}.`,
    nowClosed: (w: string) => `עכשיו: סגור · נפתח ${w}.`,
    nowClosedNoNext: "עכשיו: סגור.",
  },
  ar: {
    deliveryNow: "نعم، يوجد توصيل الآن 🚚",
    deliveryClosed: (w: string) => `لا يوجد توصيل الآن. التوصيل متاح ${w}.`,
    deliveryOff: "لا يوجد توصيل حاليًا — يمكن الطلب للاستلام الذاتي.",
    zoneLine: (name: string, fee: number, min: number) =>
      `• ${name} — رسوم التوصيل ${money(fee)}${min > 0 ? `، الحد الأدنى للطلب ${money(min)}` : ""}`,
    untilToday: (time: string) => `طلبات التوصيل اليوم حتى الساعة ${time}.`,
    otherArea: (phone: string) => (phone ? `لمنطقة أخرى — تواصلوا مع المحل: ${phone}` : "لمنطقة أخرى — تواصلوا مع المحل."),
    questions: (phone: string) => (phone ? `للاستفسار: ${phone}` : ""),
    zoneNow: (name: string, fee: number, min: number, until: string) =>
      `نعم — التوصيل إلى ${name}: رسوم التوصيل ${money(fee)}${min > 0 ? `، الحد الأدنى للطلب ${money(min)}` : ""}. طلبات التوصيل اليوم حتى الساعة ${until}.`,
    zoneClosed: (name: string, fee: number, min: number, w: string) =>
      `التوصيل إلى ${name}: رسوم التوصيل ${money(fee)}${min > 0 ? `، الحد الأدنى للطلب ${money(min)}` : ""}. لا يوجد توصيل الآن — التوصيل متاح ${w}.`,
    pickupNow: (time: string) => `نعم، يمكن الطلب للاستلام الذاتي 🛍️\nأقرب وقت للاستلام: ${time}.`,
    pickupBeforeOpening: (w: string, first: string) => `نفتح ${w}. يمكن الطلب للاستلام من الساعة ${first}.`,
    pickupClosed: (w: string) => `مغلق الآن. نفتح ${w}.`,
    pickupOff: "الاستلام الذاتي غير متاح حاليًا.",
    closedNoNext: "مغلق الآن.",
    hoursTitle: "ساعات العمل:",
    nowOpen: (until: string) => `الآن: مفتوح حتى الساعة ${until}.`,
    nowClosed: (w: string) => `الآن: مغلق · نفتح ${w}.`,
    nowClosedNoNext: "الآن: مغلق.",
  },
  en: {
    deliveryNow: "Yes, delivery is available now 🚚",
    deliveryClosed: (w: string) => `No delivery right now. Delivery is available ${w}.`,
    deliveryOff: "No delivery right now — you can order for pickup.",
    zoneLine: (name: string, fee: number, min: number) =>
      `• ${name} — delivery fee ${money(fee)}${min > 0 ? `, minimum order ${money(min)}` : ""}`,
    untilToday: (time: string) => `Delivery orders today until ${time}.`,
    otherArea: (phone: string) => (phone ? `For another area — contact the store: ${phone}` : "For another area — contact the store."),
    questions: (phone: string) => (phone ? `Questions: ${phone}` : ""),
    zoneNow: (name: string, fee: number, min: number, until: string) =>
      `Yes — delivery to ${name}: fee ${money(fee)}${min > 0 ? `, minimum order ${money(min)}` : ""}. Delivery orders today until ${until}.`,
    zoneClosed: (name: string, fee: number, min: number, w: string) =>
      `Delivery to ${name}: fee ${money(fee)}${min > 0 ? `, minimum order ${money(min)}` : ""}. No delivery right now — available ${w}.`,
    pickupNow: (time: string) => `Yes, you can order for pickup 🛍️\nEarliest pickup time: ${time}.`,
    pickupBeforeOpening: (w: string, first: string) => `We open ${w}. You can order for pickup from ${first}.`,
    pickupClosed: (w: string) => `We're closed now. We open ${w}.`,
    pickupOff: "Pickup is not available right now.",
    closedNoNext: "We're closed now.",
    hoursTitle: "Opening hours:",
    nowOpen: (until: string) => `Now: open until ${until}.`,
    nowClosed: (w: string) => `Now: closed · we open ${w}.`,
    nowClosedNoNext: "Now: closed.",
  },
} as const;

function copy(locale: Locale) {
  return COPY[locale] ?? COPY.en;
}

/** Delivery is usable at all: switched on and has at least one area. */
function deliveryOn(f: FulfillmentSettings): boolean {
  return f.delivery.enabled && f.delivery.zones.length > 0;
}

/**
 * The delivery area named in the question, if any (any language; "הר יונה / נוף הגליל" matches
 * "הר יונה" or "נוף הגליל" too). Plain substring match on normalized text.
 */
export function zoneMentioned(text: string, zones: DeliveryZone[]): DeliveryZone | null {
  const norm = normalizeText(text);
  if (!norm) return null;
  for (const zone of zones) {
    const parts = [zone.name.he, zone.name.ar, zone.name.en]
      .flatMap((name) => [name, ...name.split("/")])
      .map((part) => normalizeText(part))
      .filter((part) => part.length >= 3);
    if (parts.some((part) => norm.includes(part))) return zone;
  }
  return null;
}

export function deliveryAnswer(facts: FulfillmentFacts, locale: Locale, zone?: DeliveryZone | null): FulfillmentAnswer {
  const c = copy(locale);
  const { fulfillment, openingHours, now, phone } = facts;
  if (!deliveryOn(fulfillment)) {
    return { text: [c.deliveryOff, c.questions(phone)].filter(Boolean).join("\n"), showContact: true };
  }
  const state = deliveryAvailability(fulfillment, openingHours, now);
  const untilText = state.available ? formatLocalTime(state.until) : "";
  const nextText = !state.available && state.nextAt ? when(locale, state.nextAt, now, "from") : "";

  if (zone) {
    const name = zoneName(zone, locale);
    const line = state.available
      ? c.zoneNow(name, zone.fee, zone.minOrder, untilText)
      : nextText
        ? c.zoneClosed(name, zone.fee, zone.minOrder, nextText)
        : c.deliveryOff;
    return { text: line, showContact: !state.available };
  }

  const head = state.available ? c.deliveryNow : nextText ? c.deliveryClosed(nextText) : c.deliveryOff;
  const zones = fulfillment.delivery.zones.map((z) => c.zoneLine(zoneName(z, locale), z.fee, z.minOrder));
  const lines = [head, ...zones];
  if (state.available) lines.push(c.untilToday(untilText));
  lines.push(c.otherArea(phone));
  return { text: lines.join("\n"), showContact: true };
}

export function pickupAnswer(facts: FulfillmentFacts, locale: Locale): FulfillmentAnswer {
  const c = copy(locale);
  const { fulfillment, openingHours, now } = facts;
  const pickup = pickupAvailability(openingHours, fulfillment.pickup, now);
  if (pickup.available) {
    const first = formatLocalTime(pickup.slots[0]!);
    if (isOpenAt(openingHours, now)) return { text: c.pickupNow(first), showContact: false };
    const opens = nextOpeningAfter(openingHours, now);
    return { text: opens ? c.pickupBeforeOpening(when(locale, opens, now, "at"), first) : c.pickupNow(first), showContact: false };
  }
  if (pickup.reason === "disabled") return { text: c.pickupOff, showContact: true };
  return {
    text: pickup.nextAt ? c.pickupClosed(when(locale, pickup.nextAt, now, "at")) : c.closedNoNext,
    showContact: true,
  };
}

export function hoursAnswer(facts: FulfillmentFacts, locale: Locale): FulfillmentAnswer {
  const c = copy(locale);
  const { openingHours, now } = facts;
  const window = windowAt(openingHours, now);
  const next = window ? null : nextOpeningAfter(openingHours, now);
  const status = window
    ? c.nowOpen(formatLocalTime(window.end))
    : next
      ? c.nowClosed(when(locale, next, now, "at"))
      : c.nowClosedNoNext;
  return { text: `${c.hoursTitle}\n${formatOpeningHours(openingHours, locale)}\n${status}`, showContact: false };
}

/** WhatsApp link for an Israeli number: "0587887090" → "https://wa.me/972587887090". Null without a number. */
export function whatsappUrl(raw: string | null | undefined): string | null {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `972${digits.slice(1)}`;
  return digits.length >= 11 ? `https://wa.me/${digits}` : null;
}
