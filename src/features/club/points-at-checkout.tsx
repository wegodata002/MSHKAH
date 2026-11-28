"use client";

import { useCallback, useEffect, useState } from "react";
import { Minus, Plus, Sparkles } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { hasClubHint } from "@/lib/loyalty/club-hint";
import { maxRedeemablePoints, pointsValue, type PointsRefusal, type RedemptionSettings } from "@/lib/loyalty/redemption";
import { cn, formatPrice } from "@/lib/utils";

/**
 * Checkout: paying with club points (logged-in active member, only while the manager has switched
 * redemption on with an approved point value; never at the table). The member chooses how many;
 * the default is as many as this order can take. The server checks it all again.
 */

type Info = { ready: false } | { ready: true; balancePoints: number; settings: RedemptionSettings };

export type PointsAtCheckoutState = {
  info: Info | null;
  /** The box is shown (ready, and allowed on this order: not at the table, not an order already saved). */
  available: boolean;
  /** The most points this order can take now (0 = none). */
  max: number;
  min: number;
  use: boolean;
  points: number;
  /** What is sent with the order (0 = no points). */
  requested: number;
  /** The value of `requested` in ₪. */
  discount: number;
  setUse: (use: boolean) => void;
  setPoints: (points: number) => void;
  /** The order was refused for points: read the balance again and take the new maximum. */
  onRefused: (maxPoints: number | undefined) => void;
};

export function usePointsAtCheckout(input: { productsAfterCoupon: number; totalBeforePoints: number; allowed: boolean }): PointsAtCheckoutState {
  const [info, setInfo] = useState<Info | null>(null);
  const [use, setUse] = useState(true);
  const [chosen, setChosen] = useState<number | null>(null);
  const [capFromServer, setCapFromServer] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!hasClubHint()) {
      setInfo({ ready: false });
      return;
    }
    void fetch("/api/club/points", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: (Info & { ok?: boolean }) | null) => setInfo(data && data.ready ? data : { ready: false }))
      .catch(() => setInfo({ ready: false }));
  }, []);
  useEffect(load, [load]);

  const ready = info?.ready === true && input.allowed;
  const settings = info?.ready ? info.settings : null;
  const computedMax = ready && settings ? maxRedeemablePoints({ balancePoints: info.balancePoints, settings, productsAfterCoupon: input.productsAfterCoupon, totalBeforePoints: input.totalBeforePoints }) : 0;
  const max = capFromServer === null ? computedMax : Math.min(computedMax, capFromServer);
  const min = settings ? Math.max(1, settings.redemptionMinPoints) : 1;
  // Default: as many as possible; a chosen amount stays, kept within this order's range.
  const points = max <= 0 ? 0 : Math.min(max, Math.max(min, chosen ?? max));
  const requested = ready && use && max > 0 ? points : 0;

  return {
    info,
    available: ready,
    max,
    min,
    use,
    points,
    requested,
    discount: settings ? pointsValue(requested, settings) : 0,
    setUse,
    setPoints: (n) => setChosen(Math.floor(n)),
    onRefused: (maxPoints) => {
      setCapFromServer(typeof maxPoints === "number" ? maxPoints : null);
      setChosen(null);
      load();
    },
  };
}

export function pointsRefusalKey(reason: string | undefined): string {
  const r = reason as PointsRefusal | undefined;
  if (r === "insufficient_balance") return "checkout.points.error.balance";
  if (r === "too_many") return "checkout.points.error.tooMany";
  if (r === "below_minimum") return "checkout.points.error.minimum";
  if (r === "login_required" || r === "not_member") return "checkout.points.error.login";
  return "checkout.points.error.unavailable";
}

export function PointsAtCheckout({ state, className }: { state: PointsAtCheckoutState; className?: string }) {
  const t = useT();
  const { info } = state;
  if (!state.available || !info || !info.ready) return null;
  const value = formatPrice(pointsValue(info.balancePoints, info.settings));
  return (
    <section className={cn("rounded-2xl border border-turquoise/25 bg-turquoise/5 p-3 text-sm", className)} data-points-checkout>
      <p className="flex items-center gap-1.5 font-semibold text-dark-brown dark:text-warm-white">
        <Sparkles className="h-4 w-4 text-turquoise" strokeWidth={1.75} />
        {t("checkout.points.title")}
      </p>
      <p className="mt-0.5 text-coffee/70" data-points-balance>
        {t("checkout.points.balance").replace("{points}", String(info.balancePoints)).replace("{value}", value)}
      </p>
      {state.max <= 0 ? (
        <p className="mt-1 text-xs text-coffee/60" data-points-none>
          {t("checkout.points.notThisOrder").replace("{min}", String(state.min))}
        </p>
      ) : (
        <>
          <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2">
            <input type="checkbox" checked={state.use} onChange={(e) => state.setUse(e.target.checked)} className="h-5 w-5 accent-[#007A80]" data-points-use />
            <span>{t("checkout.points.use")}</span>
          </label>
          {state.use && (
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => state.setPoints(state.points - 1)}
                  disabled={state.points <= state.min}
                  aria-label={t("checkout.points.fewer")}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-beige-dark/40 bg-warm-white disabled:opacity-40"
                  data-points-minus
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={state.min}
                  max={state.max}
                  value={state.points}
                  onChange={(e) => state.setPoints(Number(e.target.value) || state.min)}
                  aria-label={t("checkout.points.amount")}
                  dir="ltr"
                  className="h-11 w-20 rounded-xl border border-beige-dark/40 bg-warm-white text-center text-base font-semibold"
                  data-points-input
                />
                <button
                  type="button"
                  onClick={() => state.setPoints(state.points + 1)}
                  disabled={state.points >= state.max}
                  aria-label={t("checkout.points.more")}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-beige-dark/40 bg-warm-white disabled:opacity-40"
                  data-points-plus
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <span className="font-semibold text-turquoise" dir="ltr" data-points-discount>
                −{formatPrice(state.discount)}
              </span>
              <p className="w-full text-xs text-coffee/55">
                {t("checkout.points.range").replace("{min}", String(state.min)).replace("{max}", String(state.max))}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
