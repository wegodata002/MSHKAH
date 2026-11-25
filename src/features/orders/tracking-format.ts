import type { Locale } from "@/lib/i18n/types";
import type { OrderTrackingView, TrackingHeadline } from "@/lib/orders/tracking-view";

const INTL_LOCALE: Record<Locale, string> = { he: "he-IL", ar: "ar", en: "en-GB" };

/** "12:48" in the cafe's time zone. */
export function formatTrackingTime(iso: string | null, locale: Locale): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(INTL_LOCALE[locale] ?? "he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jerusalem",
    numberingSystem: "latn",
  });
}

/** "25.11 · 12:48" (date + time) for the order list. */
export function formatTrackingDateTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString(INTL_LOCALE[locale] ?? "he-IL", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Jerusalem",
    numberingSystem: "latn",
  });
  return `${day} · ${formatTrackingTime(iso, locale)}`;
}

/** "inside-3" → { area: "inside", number: 3 }. */
export function parseTableId(id: string | null): { area: "inside" | "outside"; number: number } | null {
  const match = /^(inside|outside)-(\d{1,2})$/.exec(id ?? "");
  return match ? { area: match[1] as "inside" | "outside", number: Number(match[2]) } : null;
}

export type HeadlineTone = "progress" | "ready" | "done" | "cancelled";

export function headlineTone(headline: TrackingHeadline): HeadlineTone {
  if (headline === "cancelled") return "cancelled";
  if (headline === "picked_up" || headline === "delivered" || headline === "served") return "done";
  if (headline === "received" || headline === "preparing") return "progress";
  return "ready";
}

/** Short status for the order list badges. */
export function listBadgeTone(view: OrderTrackingView): HeadlineTone {
  return headlineTone(
    view.status === "cancelled"
      ? "cancelled"
      : view.status === "delivered"
        ? "delivered"
        : view.status === "ready"
          ? "ready_pickup"
          : "received"
  );
}
