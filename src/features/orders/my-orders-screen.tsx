"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Loader2, Package, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { rememberMyOrder, useMyOrders, type MyOrderEntry } from "@/lib/orders/my-orders";
import { trackingHeadline, type OrderTrackingView } from "@/lib/orders/tracking-view";
import { formatPrice, cn } from "@/lib/utils";
import { formatTrackingDateTime, headlineTone, type HeadlineTone } from "./tracking-format";

const BADGE_TONE: Record<HeadlineTone, string> = {
  progress: "bg-amber-50 text-amber-800",
  ready: "bg-turquoise/10 text-turquoise",
  done: "bg-emerald-50 text-emerald-700",
  cancelled: "bg-red-50 text-red-700",
};

function OrderRow({ entry }: { entry: MyOrderEntry }) {
  const t = useT();
  const { locale } = useLocale();
  const [view, setView] = useState<OrderTrackingView | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orders/track?t=${encodeURIComponent(entry.token)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok?: boolean; order?: OrderTrackingView } | null) => {
        if (!cancelled && data?.ok && data.order) setView(data.order);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [entry.token]);

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
        ) : (
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

/** "Orders" in the bottom bar: orders from this device (30 days) + find an order by number and phone. */
export function MyOrdersScreen() {
  const t = useT();
  const entries = useMyOrders();

  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="font-display text-2xl font-bold text-dark-brown md:text-3xl">{t("orders.title")}</h1>
      {entries.length > 0 ? (
        <ul className="mt-4 space-y-2.5" data-my-orders>
          {entries.map((entry) => (
            <OrderRow key={entry.token} entry={entry} />
          ))}
        </ul>
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
