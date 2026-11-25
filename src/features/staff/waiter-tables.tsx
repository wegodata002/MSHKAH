"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Banknote, Check, CreditCard, Loader2, LogOut, Plus, Tablet, UserRound } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { formatPrice, cn } from "@/lib/utils";
import { tableAreaName, tableDisplayName, tablesByArea, type DineInTable, type TableArea } from "@/lib/fulfillment/settings";
import { WaiterNewOrder } from "@/features/staff/waiter-new-order";
import { summarizeTable, type PaidWith, type TableSummary, type WaiterOrder } from "@/lib/waiter/tables";

/** How often the waiter screen asks for updates (all waiters see each other's changes). */
export const WAITER_POLL_MS = 10_000;
const DEVICE_WAITER_KEY = "mishkat-device-waiter";

type Data = {
  mode: "personal" | "device";
  me: { name: string } | null;
  device: { name: string } | null;
  waiters: { id: string; name: string }[];
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

function readDeviceWaiter(): { id: string; name: string } | null {
  try {
    const raw = window.localStorage.getItem(DEVICE_WAITER_KEY);
    const v = raw ? (JSON.parse(raw) as { id?: unknown; name?: unknown }) : null;
    return v && typeof v.id === "string" && typeof v.name === "string" ? { id: v.id, name: v.name } : null;
  } catch {
    return null;
  }
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
  locked,
  onServed,
  onPay,
}: {
  order: WaiterOrder;
  busy: boolean;
  /** Fixed tablet before choosing who is working: buttons off, no spinner. */
  locked: boolean;
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
      className={cn("rounded-2xl border-s-4 bg-warm-white p-4 shadow-soft", order.stage === "ready" ? "border-s-orange-500" : order.stage === "served" ? "border-s-emerald-500" : "border-s-turquoise")}
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
            <button type="button" disabled={busy || locked} onClick={onServed} className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-turquoise font-bold text-warm-white disabled:opacity-50" data-action="served">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t("waiter.served")}
            </button>
          )}
          {canPay && (
            <button type="button" disabled={busy || locked} onClick={onPay} className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-turquoise/50 font-bold text-turquoise disabled:opacity-50" data-action="pay">
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
  const [deviceWaiter, setDeviceWaiter] = useState<{ id: string; name: string } | null>(null);
  const [choosing, setChoosing] = useState(false);
  /** "New order" open for this table. */
  const [ordering, setOrdering] = useState<string | null>(null);
  /** "Sent to the kitchen · #MC-…" after a new order. */
  const [sentNotice, setSentNotice] = useState<string | null>(null);

  useEffect(() => setDeviceWaiter(readDeviceWaiter()), []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/staff/tables", { cache: "no-store" });
      if (res.status === 401) return onSignedOut();
      const json = (await res.json()) as { ok?: boolean } & Data;
      if (!res.ok || !json.ok) throw new Error("load");
      setData(json);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [onSignedOut]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), WAITER_POLL_MS);
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

  // Fixed tablet: "Who is working now?" (kept on the tablet until changed; must be an active waiter).
  const isDevice = data?.mode === "device";
  const chosen = isDevice && deviceWaiter && data?.waiters.some((w) => w.id === deviceWaiter.id) ? deviceWaiter : null;
  const needWho = isDevice && !chosen;

  const chooseWaiter = (w: { id: string; name: string }) => {
    setDeviceWaiter(w);
    setChoosing(false);
    try {
      window.localStorage.setItem(DEVICE_WAITER_KEY, JSON.stringify(w));
    } catch {
      // kept for this visit only
    }
  };

  const act = async (key: string, body: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/staff/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, waiterId: chosen?.id }),
      });
      if (res.status === 401) return onSignedOut();
      const json = (await res.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
      if (!res.ok || !json?.ok) {
        const code = json?.code ?? "";
        setError(t(code === "CANCELLED" ? "waiter.error.cancelled" : code === "CHOOSE_WAITER" ? "waiter.error.chooseWaiter" : code === "ALREADY_PAID" || code === "ALREADY_SERVED" ? "waiter.error.alreadyDone" : "courier.error.generic"));
      }
      setPay(null);
      await load();
    } catch {
      setError(t("courier.error.generic"));
    } finally {
      setBusy(null);
    }
  };

  const signOut = async () => {
    await fetch("/api/staff/logout", { method: "POST" }).catch(() => undefined);
    onSignedOut();
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
      {/* Header: who is using the screen. */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-display text-xl font-bold text-dark-brown">
            {isDevice ? <Tablet className="h-5 w-5 text-turquoise" /> : null}
            {isDevice ? data.device?.name : t("staff.hello").replace("{name}", data.me?.name ?? "")}
          </h1>
          <p className="flex items-center gap-1.5 text-xs text-coffee/55">
            <span className={cn("h-2 w-2 rounded-full", offline ? "bg-amber-500" : "animate-pulse bg-emerald-500")} />
            {offline ? t("courier.offline") : t("waiter.live")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isDevice && chosen && (
            <button type="button" onClick={() => setChoosing(true)} className="inline-flex items-center gap-1.5 rounded-xl border border-turquoise/40 px-3 py-2 text-sm font-semibold text-turquoise" data-who-current>
              <UserRound className="h-4 w-4" />
              {chosen.name}
            </button>
          )}
          {!isDevice && (
            <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-coffee/65 hover:bg-beige/50" data-staff-logout>
              <LogOut className="h-4 w-4" strokeWidth={1.75} />
              {t("staff.logout")}
            </button>
          )}
        </div>
      </div>

      {(needWho || choosing) && (
        <div className="mb-4 rounded-2xl bg-warm-white p-4 shadow-soft" data-who-chooser>
          <p className="font-semibold text-dark-brown">{t("waiter.whoTitle")}</p>
          <p className="mt-0.5 text-xs text-coffee/60">{t("waiter.whoHint")}</p>
          {data.waiters.length === 0 ? (
            <p className="mt-3 text-sm text-amber-800">{t("waiter.noWaiters")}</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {data.waiters.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => chooseWaiter(w)}
                  aria-pressed={chosen?.id === w.id}
                  data-who={w.name}
                  className={cn("h-11 rounded-full border-2 px-4 font-semibold", chosen?.id === w.id ? "border-turquoise bg-turquoise text-warm-white" : "border-beige-dark/40 text-dark-brown")}
                >
                  {w.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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
          waiterId={chosen?.id}
          onBack={() => setOrdering(null)}
          onSignedOut={onSignedOut}
          onSent={(orderNumber) => {
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
            disabled={needWho || !data.dineInEnabled}
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
                  locked={needWho}
                  onServed={() => void act(order.id, { action: "served", orderId: order.id })}
                  onPay={() => setPay({ orderIds: [order.id], amount: order.total, title: t("waiter.payOne") })}
                />
              ))}
            </ul>
          )}
          {unpaid.length > 1 && (
            <button
              type="button"
              disabled={needWho}
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
                </button>
              ))}
            </div>
          )}
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-5" data-table-grid>
            {(groups.find((g) => g.area === shownArea)?.tables ?? []).map((table) => {
              const s = summaries.get(table.id)!;
              return (
                <li key={table.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setTableId(table.id);
                      setSentNotice(null);
                    }}
                    data-table-tile={table.id}
                    data-state={s.state}
                    className={cn("relative flex h-24 w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 bg-warm-white shadow-soft", TILE[s.state])}
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
