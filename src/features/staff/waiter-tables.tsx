"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Banknote, Check, CreditCard, Loader2, Plus, Tablet } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { formatPrice, cn } from "@/lib/utils";
import { tableAreaName, tableDisplayName, tablesByArea, type DineInTable, type TableArea } from "@/lib/fulfillment/settings";
import { WaiterNewOrder } from "@/features/staff/waiter-new-order";
import { SoundButton } from "@/features/staff/sound-button";
import { useScreenWakeLock, useSeenHighlight, useWorkAlerts } from "@/features/staff/use-work-alerts";
import { newWaiterWork } from "@/lib/staff/alerts";
import { tableHasWork, summarizeTable, type PaidWith, type TableSummary, type WaiterOrder } from "@/lib/waiter/tables";

/** How often the waiter screen asks for updates (all waiters see each other's changes). */
export const WAITER_POLL_MS = 10_000;
/** Left over from "Who is working now?" (removed): cleared from the device. */
const OLD_DEVICE_WAITER_KEY = "mishkat-device-waiter";
/** "Only tables with work": kept on this device until turned off. */
const BUSY_ONLY_KEY = "mishkat-waiter-busy-only";

type Data = {
  mode: "device";
  /** This device's name ("טלפון מלצרית 1"): what the actions are recorded under. */
  device: { name: string };
  dineInEnabled: boolean;
  tables: DineInTable[];
  orders: WaiterOrder[];
};

const TILE: Record<TableSummary["state"], string> = {
  ready: "border-orange-500 bg-orange-50",
  in_kitchen: "border-turquoise",
  to_pay: "border-amber-700",
  free: "border-beige-dark/40",
};

function timeOf(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" }) : "";
}

function PaySheet({
  title,
  amount,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  amount: number;
  busy: boolean;
  onConfirm: (paidWith: PaidWith) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [paidWith, setPaidWith] = useState<PaidWith>("cash");
  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-dark-brown/40 sm:items-center" role="dialog" aria-modal="true" data-pay-sheet>
      <div className="w-full max-w-md rounded-t-3xl bg-warm-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-premium sm:rounded-3xl">
        <p className="font-display text-lg font-bold text-dark-brown">
          {title} · {formatPrice(amount)}
        </p>
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
        <button
          type="button"
          disabled={busy}
          onClick={() => onConfirm(paidWith)}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-turquoise font-bold text-warm-white disabled:opacity-50"
          data-confirm-paid
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {t(`waiter.confirmPaid.${paidWith}`)}
        </button>
        <button type="button" onClick={onCancel} className="mt-2 h-10 w-full text-sm text-coffee/60">
          {t("courier.cancel")}
        </button>
      </div>
    </div>
  );
}

function OrderCard({
  order,
  busy,
  flash = false,
  onServed,
  onPay,
}: {
  order: WaiterOrder;
  busy: boolean;
  /** New or just ready: highlighted for a few seconds. */
  flash?: boolean;
  onServed: () => void;
  onPay: () => void;
}) {
  const t = useT();
  if (order.stage === "cancelled") {
    return (
      <li className="rounded-2xl border-s-4 border-s-red-600 bg-red-50 p-4" data-waiter-order={order.orderNumber} data-stage="cancelled">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-dark-brown">{order.customerName || "—"}</p>
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">{t("waiter.stage.cancelled")}</span>
        </div>
        <p className="mt-1 text-sm font-semibold text-red-700">{t("waiter.cancelledHint")}</p>
        <p className="mt-1 text-xs text-coffee/60">{order.items.map((i) => `${i.quantity}× ${i.name}`).join(" · ")}</p>
      </li>
    );
  }
  const canServe = order.stage === "in_kitchen" || order.stage === "ready";
  const canPay = !order.paid;
  return (
    <li
      data-flash={flash ? "yes" : undefined}
      className={cn("rounded-2xl border-s-4 bg-warm-white p-4 shadow-soft", flash && "ring-4 ring-amber-400/70", order.stage === "ready" ? "border-s-orange-500" : order.stage === "served" ? "border-s-emerald-500" : "border-s-turquoise")}
      data-waiter-order={order.orderNumber}
      data-stage={order.stage}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-dark-brown">{order.customerName || "—"}</p>
          <p className="text-xs text-coffee/50" dir="ltr">
            #{order.orderNumber} · {timeOf(order.createdAt)}
          </p>
          {order.createdBy && (
            <p className="text-xs text-sky-800" data-order-created-by>
              {t("waiter.createdBy").replace("{name}", order.createdBy)}
            </p>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            order.stage === "ready" ? "bg-orange-100 text-orange-800" : order.stage === "served" ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-700"
          )}
        >
          {order.stage === "served" ? t("waiter.servedBy").replace("{time}", timeOf(order.servedAt)).replace("{name}", order.servedBy ?? "") : t(`waiter.stage.${order.stage}`)}
        </span>
      </div>
      <ul className="mt-2 space-y-0.5 text-sm text-dark-brown">
        {order.items.map((item, i) => (
          <li key={i}>
            {item.quantity}× {item.name}
            {item.extras.length ? <span className="text-xs text-coffee/50"> (+ {item.extras.join(", ")})</span> : null}
          </li>
        ))}
      </ul>
      {order.notes && <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">{order.notes}</p>}
      <p className={cn("mt-2 text-sm font-bold", order.paid ? "text-emerald-700" : "text-dark-brown")}>
        {order.paid
          ? t(`waiter.paid.${order.paidWith ?? "cash"}`).replace("{name}", order.paidBy ?? "")
          : t("waiter.toPay").replace("{amount}", formatPrice(order.total))}
      </p>
      {(canServe || canPay) && (
        <div className={cn("mt-3 grid gap-2", canServe && canPay ? "grid-cols-2" : "grid-cols-1")}>
          {canServe && (
            <button type="button" disabled={busy} onClick={onServed} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-turquoise font-bold text-warm-white disabled:opacity-50" data-action="served">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t("waiter.served")}
            </button>
          )}
          {canPay && (
            <button type="button" disabled={busy} onClick={onPay} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-turquoise/50 font-bold text-turquoise disabled:opacity-50" data-action="pay">
              <Banknote className="h-4 w-4" />
              {t("waiter.pay")}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** The waiter screen: tables by area, a table's open orders, "Served", "Paid", pay for the whole table. */
export function WaiterTables({ onSignedOut }: { onSignedOut: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const [data, setData] = useState<Data | null>(null);
  const [offline, setOffline] = useState(false);
  const [area, setArea] = useState<TableArea | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pay, setPay] = useState<{ orderIds: string[]; amount: number; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** "New order" open for this table. */
  const [ordering, setOrdering] = useState<string | null>(null);
  /** "Sent to the kitchen · #MC-…" after a new order. */
  const [sentNotice, setSentNotice] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.removeItem(OLD_DEVICE_WAITER_KEY);
    } catch {
      // nothing kept
    }
  }, []);

  // New work: a new order at a table, or a dish that became ready. Sound, vibration, tab title,
  // the table tile highlighted until it is opened, and the order card for 6 seconds once seen.
  const alerts = useWorkAlerts();
  const { notify } = alerts;
  const { keys: flashOrders, add: flashOrder } = useSeenHighlight(alerts.visible, 6000);
  const [attention, setAttention] = useState<Set<string>>(new Set());
  const lastStages = useRef<Map<string, string> | null>(null);
  /** Orders this screen sent itself: no alert for them. */
  const sentHere = useRef<Set<string>>(new Set());
  const openTable = useRef<string | null>(null);
  openTable.current = tableId;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/staff/tables", { cache: "no-store" });
      if (res.status === 401) return onSignedOut();
      const json = (await res.json()) as { ok?: boolean } & Data;
      if (!res.ok || !json.ok) throw new Error("load");
      const { newOrders, nowReady } = newWaiterWork(lastStages.current, json.orders, sentHere.current);
      lastStages.current = new Map(json.orders.map((o) => [o.id, o.stage]));
      const fresh = [...newOrders, ...nowReady];
      if (fresh.length) {
        notify(fresh.length);
        flashOrder(fresh.map((o) => o.id));
        const tables = fresh.map((o) => o.tableId).filter((id) => id !== openTable.current);
        if (tables.length) setAttention((prev) => new Set([...prev, ...tables]));
      }
      setData(json);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [flashOrder, notify, onSignedOut]);

  useEffect(() => {
    void load();
    // Also in the background, so new work still alerts (the browser may slow this to about once a minute).
    const timer = window.setInterval(() => void load(), WAITER_POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const groups = useMemo(() => tablesByArea(data?.tables ?? []), [data?.tables]);
  const summaries = useMemo(() => {
    const map = new Map<string, TableSummary>();
    for (const table of data?.tables ?? []) map.set(table.id, summarizeTable(table, data?.orders ?? []));
    return map;
  }, [data]);
  const shownArea = area ?? groups[0]?.area ?? "inside";
  const [busyOnly, setBusyOnly] = useState(false);
  useEffect(() => {
    try {
      setBusyOnly(window.localStorage.getItem(BUSY_ONLY_KEY) === "1");
    } catch {
      // not kept on this device
    }
  }, []);
  const toggleBusyOnly = () => {
    const next = !busyOnly;
    setBusyOnly(next);
    try {
      if (next) window.localStorage.setItem(BUSY_ONLY_KEY, "1");
      else window.localStorage.removeItem(BUSY_ONLY_KEY);
    } catch {
      // kept for this visit only
    }
  };
  const busyIn = (tables: DineInTable[]) => tables.filter((tb) => tableHasWork(summaries.get(tb.id)!));
  const areaTables = groups.find((g) => g.area === shownArea)?.tables ?? [];
  const shownTables = busyOnly ? busyIn(areaTables) : areaTables;

  // The screen stays on while the waiter screen is open.
  useScreenWakeLock(Boolean(data));

  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/staff/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) return onSignedOut();
      const json = (await res.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
      if (!res.ok || !json?.ok) {
        const code = json?.code ?? "";
        setError(t(code === "CANCELLED" ? "waiter.error.cancelled" : code === "ALREADY_PAID" || code === "ALREADY_SERVED" ? "waiter.error.alreadyDone" : "courier.error.generic"));
      }
      setPay(null);
      await load();
    } catch {
      setError(t("courier.error.generic"));
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <div className="flex w-full justify-center py-16">
        <Loader2 className="h-7 w-7 animate-spin text-turquoise" aria-label={t("staff.checking")} />
      </div>
    );
  }

  const selected = tableId ? summaries.get(tableId) ?? null : null;
  const unpaid = selected ? selected.openOrders.filter((o) => !o.paid) : [];

  return (
    <div className="w-full max-w-3xl self-stretch pb-24" data-waiter-screen={data.mode}>
      {/* Header: this device's name (the actions are recorded under it). */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-xl font-bold text-dark-brown" data-device-name>
            <Tablet className="h-5 w-5 text-turquoise" />
            {data.device.name}
          </h1>
          <p className="flex items-center gap-1.5 text-xs text-coffee/55">
            <span className={cn("h-2 w-2 rounded-full", offline ? "bg-amber-500" : "animate-pulse bg-emerald-500")} />
            {offline ? t("courier.offline") : t("waiter.live")}
          </p>
        </div>
      </div>

      {!alerts.soundReady && <SoundButton onEnable={alerts.enableSound} />}

      {error && (
        <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-waiter-error>
          {error}
        </p>
      )}
      {!data.dineInEnabled && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{t("waiter.dineInOff")}</p>}

      {sentNotice && (
        <p className="mb-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800" role="status" data-order-sent>
          {sentNotice}
        </p>
      )}

      {selected && ordering === selected.table.id ? (
        <WaiterNewOrder
          table={selected.table}
          onBack={() => setOrdering(null)}
          onSignedOut={onSignedOut}
          onSent={(orderNumber) => {
            sentHere.current.add(orderNumber);
            setOrdering(null);
            setSentNotice(t("waiter.newOrder.sent").replace("{number}", orderNumber));
            void load();
          }}
        />
      ) : selected ? (
        // One table: its open orders (and today's cancelled ones).
        <div data-table-view={selected.table.id}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <button type="button" onClick={() => {
                setTableId(null);
                setSentNotice(null);
              }} className="inline-flex items-center gap-1 text-sm font-medium text-turquoise" data-back-to-tables>
              <ArrowRight className="h-4 w-4 ltr:rotate-180" />
              {t("waiter.allTables")}
            </button>
            <h2 className="font-display text-lg font-bold text-dark-brown">{tableDisplayName(selected.table, locale)}</h2>
          </div>
          <button
            type="button"
            disabled={!data.dineInEnabled}
            onClick={() => {
              setSentNotice(null);
              setError(null);
              setOrdering(selected.table.id);
            }}
            className="mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-turquoise/60 font-bold text-turquoise disabled:opacity-50"
            data-new-order-start
          >
            <Plus className="h-5 w-5" />
            {t("waiter.newOrder.start")}
          </button>
          {selected.openOrders.length === 0 && selected.cancelledOrders.length === 0 ? (
            <p className="rounded-2xl bg-warm-white p-6 text-center text-coffee/60 shadow-soft" data-table-free>
              {t("waiter.tableFree")}
            </p>
          ) : (
            <ul className="space-y-3">
              {[...selected.cancelledOrders, ...selected.openOrders].map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  busy={busy === order.id}
                  flash={flashOrders.has(order.id)}
                  onServed={() => void act(order.id, { action: "served", orderId: order.id })}
                  onPay={() => setPay({ orderIds: [order.id], amount: order.total, title: t("waiter.payOne") })}
                />
              ))}
            </ul>
          )}
          {unpaid.length > 1 && (
            <button
              type="button"
              onClick={() => setPay({ orderIds: unpaid.map((o) => o.id), amount: selected.toPay, title: t("waiter.payTable") })}
              className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-dark-brown font-bold text-warm-white disabled:opacity-50"
              data-pay-table
            >
              <Banknote className="h-5 w-5" />
              {t("waiter.payTable")} · {formatPrice(selected.toPay)}
            </button>
          )}
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={toggleBusyOnly}
            aria-pressed={busyOnly}
            className={cn(
              "mb-3 inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold",
              busyOnly ? "border-turquoise bg-turquoise text-warm-white" : "border-beige-dark/40 bg-warm-white text-coffee/70"
            )}
            data-busy-only={busyOnly ? "on" : "off"}
          >
            <span className={cn("h-2.5 w-2.5 rounded-full", busyOnly ? "bg-warm-white" : "bg-coffee/25")} aria-hidden />
            {t("waiter.busyOnly")}
          </button>
          {groups.length > 1 && (
            <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-beige/60 p-1" role="tablist">
              {groups.map((g) => (
                <button
                  key={g.area}
                  type="button"
                  role="tab"
                  aria-selected={shownArea === g.area}
                  onClick={() => setArea(g.area)}
                  data-area-tab={g.area}
                  className={cn("h-11 rounded-lg font-semibold", shownArea === g.area ? "bg-warm-white text-turquoise shadow-soft" : "text-coffee/65")}
                >
                  {tableAreaName(g.area, locale)}
                  {busyOnly && <span className="ms-1.5 text-xs opacity-70">{busyIn(g.tables).length}</span>}
                </button>
              ))}
            </div>
          )}
          {busyOnly && shownTables.length === 0 && (
            <p className="rounded-2xl bg-warm-white p-6 text-center text-coffee/60 shadow-soft" data-no-work>
              {t("waiter.noWork")}
            </p>
          )}
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5" data-table-grid>
            {shownTables.map((table) => {
              const s = summaries.get(table.id)!;
              return (
                <li key={table.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setTableId(table.id);
                      setSentNotice(null);
                      setAttention((prev) => {
                        const next = new Set(prev);
                        next.delete(table.id);
                        return next;
                      });
                    }}
                    data-table-tile={table.id}
                    data-attention={attention.has(table.id) ? "yes" : undefined}
                    data-state={s.state}
                    className={cn("relative flex h-24 w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 bg-warm-white shadow-soft", TILE[s.state], attention.has(table.id) && "animate-pulse ring-4 ring-amber-400")}
                  >
                    <span className="text-2xl font-bold text-dark-brown">{table.number}</span>
                    <span className="text-[11px] text-coffee/65">
                      {s.state === "to_pay" ? t("waiter.tile.to_pay").replace("{amount}", formatPrice(s.toPay)) : t(`waiter.tile.${s.state}`)}
                    </span>
                    {s.readyCount > 0 && (
                      <span className="absolute end-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-600 px-1 text-[11px] font-bold text-white">{s.readyCount}</span>
                    )}
                    {s.cancelledOrders.length > 0 && <span className="absolute start-2 top-2 h-2.5 w-2.5 rounded-full bg-red-600" aria-label={t("waiter.stage.cancelled")} />}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-coffee/55">{t("waiter.legend")}</p>
        </>
      )}

      {pay && (
        <PaySheet
          title={pay.title}
          amount={pay.amount}
          busy={busy === "pay"}
          onCancel={() => setPay(null)}
          onConfirm={(paidWith) => void act("pay", { action: "paid", orderIds: pay.orderIds, paidWith })}
        />
      )}
    </div>
  );
}
