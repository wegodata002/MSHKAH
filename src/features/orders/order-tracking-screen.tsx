"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Bike, Check, ChefHat, CircleCheckBig, Clock, MapPin, PackageCheck, Phone, Receipt, UtensilsCrossed, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { useSettings } from "@/hooks/useSettings";
import { rememberMyOrder } from "@/lib/orders/my-orders";
import {
  awaitingCardPayment,
  isTrackingActive,
  trackingHeadline,
  trackingSteps,
  type OrderTrackingView,
  type TrackingHeadline,
  type TrackingStep,
} from "@/lib/orders/tracking-view";
import { tableAreaName } from "@/lib/fulfillment/settings";
import { formatPrice, cn } from "@/lib/utils";
import { formatTrackingTime, headlineTone, parseTableId, type HeadlineTone } from "./tracking-format";

/** How often the open page asks for updates (like the club card). */
export const TRACKING_POLL_MS = 10_000;

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "ready"; view: OrderTrackingView; offline: boolean };

const HERO_TONE: Record<HeadlineTone, string> = {
  progress: "from-turquoise to-[#0a5f63]",
  ready: "from-[#0a6f75] to-[#084a4e]",
  done: "from-emerald-700 to-emerald-900",
  cancelled: "from-red-700 to-red-900",
};

const HERO_ICON: Record<TrackingHeadline, typeof Check> = {
  received: Receipt,
  preparing: ChefHat,
  ready_pickup: PackageCheck,
  ready_delivery: PackageCheck,
  ready_table: UtensilsCrossed,
  out_for_delivery: Bike,
  picked_up: CircleCheckBig,
  delivered: CircleCheckBig,
  served: CircleCheckBig,
  cancelled: XCircle,
};

function stepLabelKey(step: TrackingStep, view: OrderTrackingView): string {
  if (step.key === "ready" || step.key === "delivered") return `tracking.step.${step.key}.${view.orderType}`;
  return `tracking.step.${step.key}`;
}

export function OrderTrackingScreen({ token }: { token: string }) {
  const t = useT();
  const { locale, dir } = useLocale();
  const { settings } = useSettings();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const activeRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/track?t=${encodeURIComponent(token)}`, { cache: "no-store" });
      if (res.status === 404) {
        setState({ kind: "not_found" });
        return;
      }
      const data = (await res.json()) as { ok?: boolean; order?: OrderTrackingView };
      if (!res.ok || !data.ok || !data.order) throw new Error(`track ${res.status}`);
      activeRef.current = isTrackingActive(data.order);
      setState({ kind: "ready", view: data.order, offline: false });
    } catch {
      // Keep what is on screen and say we're offline; the next check tries again.
      setState((prev) => (prev.kind === "ready" ? { ...prev, offline: true } : prev.kind === "loading" ? { kind: "not_found" } : prev));
    }
  }, [token]);

  // First load, then every 10 seconds while the page is visible and the order still moves.
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && activeRef.current) void load();
    }, TRACKING_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // Opened from the email or found by number: keep it in "My orders" on this device too.
  const orderNumber = state.kind === "ready" ? state.view.orderNumber : "";
  useEffect(() => {
    if (orderNumber) rememberMyOrder({ token, orderNumber });
  }, [token, orderNumber]);

  const phone = settings?.phone ?? "";
  const mapsUrl = (settings as { mapsUrl?: string } | null)?.mapsUrl ?? "";

  if (state.kind === "loading") {
    return (
      <div className="mx-auto max-w-lg px-4 py-6" aria-busy="true">
        <div className="h-36 animate-pulse rounded-3xl bg-beige/60" />
        <div className="mt-4 h-64 animate-pulse rounded-3xl bg-beige/40" />
      </div>
    );
  }

  if (state.kind === "not_found") {
    return (
      <div className="mx-auto max-w-lg px-4 py-10 text-center" data-tracking-not-found>
        <XCircle className="mx-auto h-12 w-12 text-coffee/30" strokeWidth={1.5} />
        <h1 className="mt-4 font-display text-2xl font-bold text-dark-brown">{t("tracking.notFound")}</h1>
        <p className="mt-2 text-sm text-coffee/60">{t("tracking.notFoundHint")}</p>
        <Button asChild variant="turquoise" size="lg" className="mt-6">
          <Link href="/orders">{t("myOrders.find")}</Link>
        </Button>
      </div>
    );
  }

  const { view, offline } = state;
  const headline = trackingHeadline(view);
  const tone = headlineTone(headline);
  const HeroIcon = HERO_ICON[headline];
  const steps = trackingSteps(view);
  const table = parseTableId(view.tableId);

  const contextLine =
    view.orderType === "pickup"
      ? view.pickupTime
        ? t("tracking.pickupAt").replace("{time}", view.pickupTime)
        : t("tracking.type.pickup")
      : view.orderType === "delivery"
        ? [t("tracking.type.delivery"), view.deliveryZoneName].filter(Boolean).join(" · ")
        : table
          ? t("tracking.table").replace("{table}", `${tableAreaName(table.area, locale)} ${table.number}`)
          : t("tracking.type.dine_in");

  return (
    <div className="mx-auto max-w-lg px-4 pb-6 pt-4" dir={dir} data-tracking-page data-headline={headline}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Link href="/orders" className="inline-flex items-center gap-1 text-sm font-medium text-turquoise">
          <ArrowRight className="h-4 w-4 ltr:rotate-180" strokeWidth={1.75} />
          {t("tracking.back")}
        </Link>
        {isTrackingActive(view) && (
          <span className={cn("inline-flex items-center gap-1.5 text-xs", offline ? "text-amber-700" : "text-coffee/55")}>
            <span className={cn("h-2 w-2 rounded-full", offline ? "bg-amber-500" : "animate-pulse bg-emerald-500")} />
            {offline ? t("tracking.offline") : t("tracking.live")}
          </span>
        )}
      </div>

      {/* Where the order is now. */}
      <motion.section
        key={headline}
        initial={{ opacity: 0.6, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn("rounded-3xl bg-gradient-to-br p-5 text-warm-white shadow-premium", HERO_TONE[tone])}
        aria-live="polite"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs opacity-85">
              {t("tracking.order")} <span dir="ltr" className="font-semibold">#{view.orderNumber}</span>
            </p>
            <h1 className="mt-1 font-display text-2xl font-bold leading-tight" data-tracking-headline>
              {t(`tracking.headline.${headline}`)}
            </h1>
            <p className="mt-1 text-sm opacity-90">{t(`tracking.hint.${headline}`)}</p>
          </div>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
            <HeroIcon className="h-6 w-6" strokeWidth={1.75} />
          </span>
        </div>
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
          {view.orderType === "pickup" ? <Clock className="h-3.5 w-3.5" /> : view.orderType === "delivery" ? <Bike className="h-3.5 w-3.5" /> : <UtensilsCrossed className="h-3.5 w-3.5" />}
          {contextLine}
        </p>
      </motion.section>

      {awaitingCardPayment(view) && (
        <p className="mt-3 rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800" data-awaiting-payment>
          {t("tracking.awaitingPayment")}
        </p>
      )}

      {/* Steps. */}
      {steps.length > 0 && (
        <ol className="mt-4 rounded-3xl bg-warm-white p-5 shadow-soft" data-tracking-steps>
          {steps.map((step, index) => (
            <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0" data-step={step.key} data-state={step.state}>
              {index < steps.length - 1 && (
                <span
                  aria-hidden
                  className={cn("absolute start-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5", step.state === "done" ? "bg-turquoise" : "bg-beige-dark/40")}
                />
              )}
              <span
                className={cn(
                  "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2",
                  step.state === "done" && "border-turquoise bg-turquoise text-warm-white",
                  step.state === "current" && "border-turquoise bg-warm-white ring-4 ring-turquoise/15",
                  step.state === "todo" && "border-beige-dark/50 bg-warm-white"
                )}
              >
                {step.state === "done" ? <Check className="h-4 w-4" strokeWidth={2.5} /> : step.state === "current" ? <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-turquoise" /> : null}
              </span>
              <div className="min-w-0 pt-0.5">
                <p className={cn("text-sm font-semibold", step.state === "current" ? "text-turquoise" : step.state === "todo" ? "text-coffee/45" : "text-dark-brown")}>
                  {t(stepLabelKey(step, view))}
                </p>
                {step.at && (
                  <p className="text-xs text-coffee/55" dir="ltr">
                    {formatTrackingTime(step.at, locale)}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* Contact: pickup → directions + call; others → call. Cancelled: call first. */}
      {(phone || (view.orderType === "pickup" && mapsUrl)) && (
        <div className="mt-4 flex gap-2">
          {view.orderType === "pickup" && mapsUrl && headline !== "cancelled" && (
            <Button asChild variant="outline" className="h-11 flex-1 rounded-xl">
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
                <MapPin className="h-4 w-4" strokeWidth={1.75} />
                {t("tracking.navigate")}
              </a>
            </Button>
          )}
          {phone && (
            <Button asChild variant={headline === "cancelled" ? "turquoise" : "outline"} className="h-11 flex-1 rounded-xl">
              <a href={`tel:${phone.replace(/\s/g, "")}`}>
                <Phone className="h-4 w-4" strokeWidth={1.75} />
                {t("tracking.callStore")}
              </a>
            </Button>
          )}
        </div>
      )}

      {/* What was ordered. */}
      <section className="mt-4 rounded-3xl bg-warm-white p-5 shadow-soft" data-tracking-items>
        <h2 className="text-sm font-semibold text-coffee/70">{t("tracking.items")}</h2>
        <ul className="mt-3 space-y-2.5">
          {view.items.map((item, index) => (
            <li key={`${item.name}-${index}`} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="min-w-0 text-dark-brown">
                  {item.quantity}× {item.name}
                </span>
                <span className="shrink-0 tabular-nums text-coffee/75">{formatPrice(item.total)}</span>
              </div>
              {item.extras.length > 0 && <p className="ps-4 text-xs text-coffee/50">+ {item.extras.join(", ")}</p>}
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-1 border-t border-beige-dark/20 pt-3 text-sm">
          {view.discount ? (
            <div className="flex justify-between text-emerald-700">
              <span>{t("tracking.discount")}</span>
              <span className="tabular-nums">−{formatPrice(view.discount)}</span>
            </div>
          ) : null}
          {view.delivery ? (
            <div className="flex justify-between text-coffee/70">
              <span>{t("tracking.deliveryFee")}</span>
              <span className="tabular-nums">{formatPrice(view.delivery)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-bold text-dark-brown">
            <span>{t("tracking.total")}</span>
            <span className="tabular-nums">{formatPrice(view.total)}</span>
          </div>
          <p className="flex items-center justify-between text-xs text-coffee/60">
            <span>{t(`tracking.payment.${view.payment}`)}</span>
            {view.paymentStatus === "paid" && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">{t("tracking.paid")}</span>
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
