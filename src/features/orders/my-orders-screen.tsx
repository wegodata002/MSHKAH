"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2, Package, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { rememberMyOrder } from "@/lib/orders/my-orders";
import {
  countMyOrderTypes,
  filterMyOrderType,
  splitMyOrders,
  useMyOrderItems,
  type MyOrderItem,
  type MyOrderTab,
  type MyOrderType,
} from "@/lib/orders/my-order-views";
import { trackingHeadline } from "@/lib/orders/tracking-view";
import { formatPrice, cn } from "@/lib/utils";
import { formatTrackingDateTime, headlineTone, type HeadlineTone } from "./tracking-format";
import { ClubAccountLine, ClubInvite } from "@/features/club/club-account-note";

const BADGE_TONE: Record<HeadlineTone, string> = {
  progress: "bg-amber-50 text-amber-800",
  ready: "bg-turquoise/10 text-turquoise",
  done: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};

function OrderRow({ item, loaded }: { item: MyOrderItem; loaded: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const { entry, view } = item;

  const headline = view ? trackingHeadline(view) : null;
  return (
    <li>
      <Link
        href={`/orders/${encodeURIComponent(entry.token)}`}
        className="flex items-center gap-3 rounded-2xl bg-warm-white p-4 shadow-soft transition-shadow hover:shadow-md"
        data-my-order={entry.orderNumber}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span dir="ltr" className="font-semibold text-dark-brown">
              #{entry.orderNumber}
            </span>
            {view && <span className="text-xs text-coffee/55">{t(`tracking.type.${view.orderType}`)}</span>}
          </div>
          <p className="mt-0.5 text-xs text-coffee/55">
            {formatTrackingDateTime(view?.createdAt ?? new Date(entry.savedAt).toISOString(), locale)}
            {view ? ` · ${formatPrice(view.total)}` : ""}
          </p>
        </div>
        {headline ? (
          <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", BADGE_TONE[headlineTone(headline)])}>
            {t(`tracking.headline.${headline}`)}
          </span>
        ) : loaded ? null : (
          <span className="h-6 w-20 shrink-0 animate-pulse rounded-full bg-beige/60" aria-hidden />
        )}
        <ChevronLeft className="h-4 w-4 shrink-0 text-coffee/35 ltr:rotate-180" strokeWidth={1.75} />
      </Link>
    </li>
  );
}

function FindOrderForm() {
  const t = useT();
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orders/track/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNumber, phone }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; token?: string; code?: string } | null;
      if (res.ok && data?.ok && data.token) {
        rememberMyOrder({ token: data.token, orderNumber: orderNumber.trim().replace(/^#/, "").toUpperCase() });
        router.push(`/orders/${encodeURIComponent(data.token)}`);
        return;
      }
      setError(
        t(
          data?.code === "RATE_LIMITED"
            ? "myOrders.rateLimited"
            : data?.code === "INVALID"
              ? "myOrders.invalid"
              : data?.code === "NOT_FOUND"
                ? "myOrders.notFound"
                : "myOrders.error"
        )
      );
    } catch {
      setError(t("myOrders.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-3xl bg-warm-white p-5 shadow-soft" data-find-order>
      <h2 className="font-display text-lg font-bold text-dark-brown">{t("myOrders.findTitle")}</h2>
      <div className="mt-3 space-y-3">
        <div>
          <Label htmlFor="find-order-number" className="text-sm">
            {t("myOrders.orderNumber")}
          </Label>
          <Input
            id="find-order-number"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder={t("myOrders.orderNumberPlaceholder")}
            dir="ltr"
            autoCapitalize="characters"
            autoComplete="off"
            required
            className="mt-1 h-11 text-base md:text-sm"
          />
        </div>
        <div>
          <Label htmlFor="find-order-phone" className="text-sm">
            {t("myOrders.phone")}
          </Label>
          <Input
            id="find-order-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            dir="ltr"
            autoComplete="tel"
            required
            className="mt-1 h-11 text-base md:text-sm"
          />
        </div>
        {error && (
          <p className="text-sm text-red-600" role="alert" data-find-error>
            {error}
          </p>
        )}
        <Button type="submit" variant="turquoise" size="lg" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" strokeWidth={1.75} />}
          {t("myOrders.find")}
        </Button>
      </div>
    </form>
  );
}

const TYPES: Exclude<MyOrderType, "all">[] = ["pickup", "delivery", "dine_in"];

/**
 * "My orders": the orders from this device (90 days) — and, for a signed-in club member, the orders of
 * the account from every device (12 months) — in two tabs (in progress / finished) with a filter by
 * kind (pickup / delivery / table), plus finding an order by number and phone. Anyone not signed in to
 * the club is invited to join.
 */
export function MyOrdersScreen() {
  const t = useT();
  const { items, loaded, member } = useMyOrderItems();
  const [tab, setTab] = useState<MyOrderTab | null>(null);
  const [type, setType] = useState<MyOrderType>("all");

  const groups = useMemo(() => splitMyOrders(items), [items]);
  // Opens on "In progress" when there is one, otherwise on "Finished".
  const shownTab: MyOrderTab = tab ?? (loaded && groups.active.length === 0 && groups.done.length > 0 ? "done" : "active");
  const inTab = loaded ? groups[shownTab] : items;
  const typeCounts = useMemo(() => countMyOrderTypes(inTab), [inTab]);
  const shown = filterMyOrderType(inTab, type);

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="font-display text-2xl font-bold text-dark-brown md:text-3xl">{t("orders.title")}</h1>
      {member === true && <ClubAccountLine textKey="myOrders.allDevices" className="mt-1.5" />}
      {member === false && <ClubInvite className="mt-4" />}
      {items.length > 0 ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-beige/60 p-1" role="tablist" data-orders-tabs>
            {(["active", "done"] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={shownTab === key}
                onClick={() => {
                  setTab(key);
                  setType("all");
                }}
                className={cn("h-10 rounded-lg text-sm font-semibold", shownTab === key ? "bg-warm-white text-turquoise shadow-soft" : "text-coffee/65")}
                data-orders-tab={key}
              >
                {t(`myOrders.tab.${key}`)}
                {loaded ? <span className="ms-1.5 text-xs opacity-70">{groups[key].length}</span> : null}
              </button>
            ))}
          </div>
          {loaded && inTab.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2" data-orders-types>
              {(["all", ...TYPES] as const).map((key) =>
                key !== "all" && typeCounts[key] === 0 ? null : (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={type === key}
                    onClick={() => setType(key)}
                    className={cn(
                      "h-8 rounded-full border px-3 text-xs font-semibold",
                      type === key ? "border-turquoise bg-turquoise text-warm-white" : "border-beige-dark/40 bg-warm-white text-coffee/70"
                    )}
                    data-orders-type={key}
                  >
                    {key === "all" ? t("myOrders.type.all") : t(`tracking.type.${key}`)}
                    {key !== "all" ? <span className="ms-1 opacity-70">{typeCounts[key]}</span> : null}
                  </button>
                )
              )}
            </div>
          )}
          {shown.length > 0 ? (
            <ul className="mt-3 space-y-2.5" data-my-orders>
              {shown.map((item) => (
                <OrderRow key={item.entry.token} item={item} loaded={loaded} />
              ))}
            </ul>
          ) : (
            <p className="mt-4 rounded-2xl bg-warm-white p-5 text-center text-sm text-coffee/60 shadow-soft" data-orders-tab-empty>
              {t(shownTab === "active" ? "myOrders.noActive" : "myOrders.noDone")}
            </p>
          )}
          <p className="mt-3 text-center text-xs text-coffee/45">{t(member ? "myOrders.keptMonths" : "myOrders.keptDays")}</p>
        </>
      ) : (
        <div className="mt-4 rounded-3xl bg-warm-white p-6 text-center shadow-soft" data-my-orders-empty>
          <Package className="mx-auto h-10 w-10 text-turquoise/70" strokeWidth={1.5} />
          <p className="mt-3 font-semibold text-dark-brown">{t("myOrders.empty")}</p>
          <p className="mt-1 text-sm text-coffee/60">{t("myOrders.emptyHint")}</p>
        </div>
      )}
      <div className="mt-6">
        <FindOrderForm />
      </div>
    </div>
  );
}
