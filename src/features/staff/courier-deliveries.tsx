"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Banknote, Bike, ChevronDown, CreditCard, Loader2, LogOut, MapPin, Navigation, Phone, PlayCircle, StopCircle } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { formatPrice, cn } from "@/lib/utils";
import { newCourierWork } from "@/lib/staff/alerts";
import { SoundButton } from "@/features/staff/sound-button";
import { useSeenHighlight, useWorkAlerts } from "@/features/staff/use-work-alerts";
import { googleMapsUrl, wazeUrl, type CourierDelivery, type CourierStage, type PaidWith } from "@/lib/couriers/deliveries";

/** How often the courier screen asks for updates. */
export const COURIER_POLL_MS = 10_000;

const STAGE_STYLE: Record<CourierStage, { border: string; badge: string }> = {
  cancelled: { border: "border-s-red-600 bg-red-50", badge: "bg-red-100 text-red-700" },
  pickup_now: { border: "border-s-orange-500", badge: "bg-orange-100 text-orange-800" },
  on_the_way: { border: "border-s-turquoise", badge: "bg-turquoise/10 text-turquoise" },
  in_kitchen: { border: "border-s-stone-300", badge: "bg-stone-100 text-stone-700" },
  delivered: { border: "border-s-emerald-500 opacity-60", badge: "bg-emerald-50 text-emerald-700" },
};
const SECTIONS: CourierStage[] = ["cancelled", "pickup_now", "on_the_way", "in_kitchen", "delivered"];

function timeOf(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" });
}


function DeliveryCard({
  delivery,
  highlighted,
  busy,
  onLeave,
  onDelivered,
}: {
  delivery: CourierDelivery;
  highlighted: boolean;
  busy: boolean;
  onLeave: () => void;
  onDelivered: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const style = STAGE_STYLE[delivery.stage];
  const active = delivery.stage !== "delivered" && delivery.stage !== "cancelled";
  const itemCount = delivery.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <li
      className={cn(
        "rounded-2xl border-s-4 bg-warm-white p-4 shadow-soft transition-shadow",
        style.border,
        highlighted && "ring-4 ring-amber-400/70"
      )}
      data-delivery={delivery.orderNumber}
      data-stage={delivery.stage}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-dark-brown">{delivery.customerName || "—"}</p>
          <p className="text-xs text-coffee/50" dir="ltr">
            #{delivery.orderNumber}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", style.badge)}>
          {t(`courier.stage.${delivery.stage}`).replace("{time}", timeOf(delivery.stage === "delivered" ? delivery.deliveredAt : delivery.outForDeliveryAt))}
        </span>
      </div>

      {delivery.stage === "cancelled" ? (
        <p className="mt-2 text-sm font-semibold text-red-700">{t("courier.cancelledHint")}</p>
      ) : (
        <>
          <p className="mt-2 flex items-start gap-1.5 text-sm text-dark-brown">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-turquoise" strokeWidth={1.75} />
            <span>
              {delivery.address || "—"}
              {delivery.zone ? <span className="text-coffee/55"> · {delivery.zone}</span> : null}
            </span>
          </p>
          {delivery.notes && <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">{delivery.notes}</p>}

          <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-turquoise" aria-expanded={open}>
            {t("courier.items").replace("{n}", String(itemCount))}
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <ul className="mt-1 space-y-0.5 text-xs text-coffee/75">
              {delivery.items.map((item, i) => (
                <li key={i}>
                  {item.quantity}× {item.name}
                  {item.extras.length ? <span className="text-coffee/50"> (+ {item.extras.join(", ")})</span> : null}
                </li>
              ))}
            </ul>
          )}

          <p className={cn("mt-2 text-sm font-bold", delivery.collect !== null ? "text-dark-brown" : "text-emerald-700")} data-collect={delivery.collect ?? ""}>
            {delivery.collect !== null
              ? t("courier.collect").replace("{amount}", formatPrice(delivery.collect))
              : t(`courier.paid.${delivery.paidWith ?? "online"}`)}
          </p>

          {active && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <a href={`tel:${delivery.customerPhone.replace(/[^\d+]/g, "")}`} className="flex h-10 items-center justify-center gap-1 rounded-xl border border-turquoise/40 text-xs font-semibold text-turquoise">
                <Phone className="h-4 w-4" strokeWidth={1.75} />
                {t("courier.call")}
              </a>
              <a href={wazeUrl(delivery)} target="_blank" rel="noopener noreferrer" className="flex h-10 items-center justify-center gap-1 rounded-xl border border-turquoise/40 text-xs font-semibold text-turquoise">
                <Navigation className="h-4 w-4" strokeWidth={1.75} />
                Waze
              </a>
              <a href={googleMapsUrl(delivery)} target="_blank" rel="noopener noreferrer" className="flex h-10 items-center justify-center gap-1 rounded-xl border border-turquoise/40 text-xs font-semibold text-turquoise">
                <MapPin className="h-4 w-4" strokeWidth={1.75} />
                Maps
              </a>
              {delivery.stage === "on_the_way" ? (
                <button type="button" disabled={busy} onClick={onDelivered} className="col-span-3 flex h-12 items-center justify-center gap-2 rounded-xl bg-turquoise text-base font-bold text-warm-white disabled:opacity-50" data-action="delivered">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t("courier.delivered")}
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={onLeave} className="col-span-3 flex h-12 items-center justify-center gap-2 rounded-xl bg-dark-brown text-base font-bold text-warm-white disabled:opacity-50" data-action="out">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bike className="h-5 w-5" strokeWidth={1.75} />}
                  {t("courier.leaving")}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}

/** "Delivered": confirm, and for an unpaid order choose how it was paid. */
function DeliveredSheet({
  delivery,
  busy,
  onConfirm,
  onCancel,
}: {
  delivery: CourierDelivery;
  busy: boolean;
  onConfirm: (paidWith: PaidWith | null) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [paidWith, setPaidWith] = useState<PaidWith>("cash");
  const collect = delivery.collect !== null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-dark-brown/40" role="dialog" aria-modal="true" data-delivered-sheet>
      <div className="w-full max-w-lg rounded-t-3xl bg-warm-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-premium">
        <p className="font-display text-lg font-bold text-dark-brown">
          {t("courier.deliveredTitle")} · <span dir="ltr">#{delivery.orderNumber}</span>
        </p>
        {collect ? (
          <>
            <p className="mt-1 text-sm text-coffee/65">{t("courier.howPaid").replace("{amount}", formatPrice(delivery.collect ?? 0))}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {(["cash", "card"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPaidWith(value)}
                  aria-pressed={paidWith === value}
                  data-paid-with={value}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center gap-1 rounded-2xl border-2 font-semibold",
                    paidWith === value ? "border-turquoise bg-turquoise/10 text-turquoise" : "border-beige-dark/40 text-coffee/70"
                  )}
                >
                  {value === "cash" ? <Banknote className="h-5 w-5" /> : <CreditCard className="h-5 w-5" />}
                  {t(`courier.method.${value}`)}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-coffee/65">{t(`courier.paid.${delivery.paidWith ?? "online"}`)}</p>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm(collect ? paidWith : null)}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-turquoise font-bold text-warm-white disabled:opacity-50"
          data-confirm-delivered
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {collect ? t(`courier.confirmPaid.${paidWith}`) : t("courier.confirmDelivered")}
        </button>
        <button type="button" onClick={onCancel} className="mt-2 h-10 w-full text-sm text-coffee/60">
          {t("courier.cancel")}
        </button>
      </div>
    </div>
  );
}

/** The courier's screen after signing in: today's deliveries, "I'm leaving", "Delivered". */
export function CourierDeliveries({ name, onSignedOut }: { name: string; onSignedOut: () => void }) {
  const t = useT();
  const [deliveries, setDeliveries] = useState<CourierDelivery[] | null>(null);
  const [worksToday, setWorksToday] = useState(true);
  const [offline, setOffline] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<CourierDelivery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shiftBusy, setShiftBusy] = useState(false);
  const [endAsk, setEndAsk] = useState(false);
  const known = useRef<Set<string> | null>(null);
  const alerts = useWorkAlerts();
  const { notify } = alerts;
  // New deliveries stay highlighted while the screen is in the background, then 4 seconds once seen.
  const { keys: highlighted, add: highlight } = useSeenHighlight(alerts.visible, 4000);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/staff/deliveries", { cache: "no-store" });
      if (res.status === 401) {
        onSignedOut();
        return;
      }
      const data = (await res.json()) as { ok?: boolean; deliveries?: CourierDelivery[]; worksToday?: boolean };
      if (!res.ok || !data.ok || !data.deliveries) throw new Error("load");
      const list = data.deliveries;
      // Deliveries assigned since the last check (not on the first load): sound, vibration, title, highlight.
      const fresh = newCourierWork(known.current, list);
      if (fresh.length) {
        notify(fresh.length);
        highlight(fresh);
      }
      known.current = new Set(list.map((d) => d.id));
      setDeliveries(list);
      setWorksToday(data.worksToday !== false);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [highlight, notify, onSignedOut]);

  useEffect(() => {
    void load();
    // Also in the background, so new work still alerts (the browser may slow this to about once a minute).
    const timer = window.setInterval(() => void load(), COURIER_POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const act = async (delivery: CourierDelivery, action: "out" | "delivered", paidWith: PaidWith | null = null) => {
    setBusyId(delivery.id);
    setError(null);
    try {
      const res = await fetch("/api/staff/deliveries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: delivery.id, action, paidWith }),
      });
      if (res.status === 401) return onSignedOut();
      const data = (await res.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
      if (!res.ok || !data?.ok) setError(t(data?.code === "CANCELLED" ? "courier.error.cancelled" : data?.code === "NOT_YOURS" ? "courier.error.moved" : "courier.error.generic"));
      setSheet(null);
      await load();
    } catch {
      setError(t("courier.error.generic"));
    } finally {
      setBusyId(null);
    }
  };

  /** "Started my shift" / "Finished my shift": marks the courier working today (or not). */
  const setShift = async (on: boolean) => {
    setShiftBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: on ? "start" : "end" }),
      });
      if (res.status === 401) return onSignedOut();
      const data = (await res.json().catch(() => null)) as { ok?: boolean; code?: string; open?: number } | null;
      if (res.ok && data?.ok) {
        setWorksToday(on);
        setEndAsk(false);
        await load();
      } else if (data?.code === "OPEN_DELIVERIES") {
        setEndAsk(false);
        setError(t("courier.shift.endBlocked").replace("{n}", String(data.open ?? 0)));
      } else {
        setError(t("courier.error.generic"));
      }
    } catch {
      setError(t("courier.error.generic"));
    } finally {
      setShiftBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/staff/logout", { method: "POST" }).catch(() => undefined);
    onSignedOut();
  };

  const activeCount = deliveries?.filter((d) => d.stage !== "delivered" && d.stage !== "cancelled").length ?? 0;

  return (
    // Bottom room: the last card's buttons can scroll clear of the accessibility button.
    <div className="w-full max-w-lg self-stretch pb-24" data-courier-screen>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-dark-brown">{t("staff.hello").replace("{name}", name)}</h1>
          <p className="flex items-center gap-1.5 text-xs text-coffee/55">
            <span className={cn("h-2 w-2 rounded-full", offline ? "bg-amber-500" : "animate-pulse bg-emerald-500")} />
            {offline
              ? t("courier.offline")
              : deliveries !== null && !worksToday
                ? t("courier.shift.notStarted")
                : t("courier.todayCount").replace("{n}", String(activeCount))}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {deliveries !== null && worksToday && (
            <button
              type="button"
              onClick={() => setEndAsk(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-beige-dark/40 px-3 py-2 text-sm text-coffee/75 hover:bg-beige/50"
              data-shift-end
            >
              <StopCircle className="h-4 w-4" strokeWidth={1.75} />
              {t("courier.shift.end")}
            </button>
          )}
          <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-coffee/65 hover:bg-beige/50" data-staff-logout>
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
            {t("staff.logout")}
          </button>
        </div>
      </div>

      {!alerts.soundReady && <SoundButton onEnable={alerts.enableSound} />}

      {error && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-courier-error>
          {error}
        </p>
      )}

      {deliveries === null ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-turquoise" />
        </div>
      ) : !worksToday ? (
        // Shift not started: only the button (signing in alone does not mark the courier available).
        <div className="rounded-3xl bg-warm-white p-6 text-center shadow-soft" data-shift-start-card>
          <Bike className="mx-auto h-10 w-10 text-turquoise/70" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-coffee/65">{t("courier.shift.startHint")}</p>
          <button
            type="button"
            disabled={shiftBusy}
            onClick={() => void setShift(true)}
            className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-turquoise text-lg font-bold text-warm-white disabled:opacity-50"
            data-shift-start
          >
            {shiftBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <PlayCircle className="h-6 w-6" strokeWidth={1.75} />}
            {t("courier.shift.start")}
          </button>
        </div>
      ) : deliveries.length === 0 ? (
        <div className="rounded-3xl bg-warm-white p-8 text-center shadow-soft" data-courier-empty>
          <Bike className="mx-auto h-10 w-10 text-turquoise/70" strokeWidth={1.5} />
          <p className="mt-3 font-semibold text-dark-brown">{t("courier.empty")}</p>
          <p className="mt-1 text-sm text-coffee/60">{t("courier.emptyHint")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {SECTIONS.map((stage) => {
            const items = deliveries.filter((d) => d.stage === stage);
            if (!items.length) return null;
            return (
              <section key={stage} data-section={stage}>
                <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-coffee/55">{t(`courier.section.${stage}`)}</h2>
                <ul className="space-y-3">
                  {items.map((delivery) => (
                    <DeliveryCard
                      key={delivery.id}
                      delivery={delivery}
                      highlighted={highlighted.has(delivery.id)}
                      busy={busyId === delivery.id}
                      onLeave={() => void act(delivery, "out")}
                      onDelivered={() => setSheet(delivery)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {endAsk && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-dark-brown/40" role="dialog" aria-modal="true" data-shift-end-sheet>
          <div className="w-full max-w-lg rounded-t-3xl bg-warm-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-premium">
            <p className="font-display text-lg font-bold text-dark-brown">{t("courier.shift.endTitle")}</p>
            <p className="mt-1 text-sm text-coffee/65">{t("courier.shift.endHint")}</p>
            <button
              type="button"
              disabled={shiftBusy}
              onClick={() => void setShift(false)}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-dark-brown font-bold text-warm-white disabled:opacity-50"
              data-shift-end-confirm
            >
              {shiftBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t("courier.shift.end")}
            </button>
            <button type="button" onClick={() => setEndAsk(false)} className="mt-2 h-10 w-full text-sm text-coffee/60">
              {t("courier.cancel")}
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <DeliveredSheet
          delivery={sheet}
          busy={busyId === sheet.id}
          onCancel={() => setSheet(null)}
          onConfirm={(paidWith) => void act(sheet, "delivered", paidWith)}
        />
      )}
    </div>
  );
}
