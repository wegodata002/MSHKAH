"use client";

import { useEffect, useState } from "react";
import { Gift } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { useCart } from "@/features/cart/cart-context";
import { hasClubHint } from "@/lib/loyalty/club-hint";
import { couponMessageKey } from "@/lib/orders/coupons";
import type { LoyaltyCouponView } from "@/lib/loyalty/coupons";
import { cn } from "@/lib/utils";

/**
 * In the cart / checkout: a logged-in club member who has a code they can use now sees
 * "You have a 10% club discount code" with a "Use it" button (nothing to type).
 */
export function ClubCouponOffer({ className }: { className?: string }) {
  const t = useT();
  const { couponCode, applyCoupon, items } = useCart();
  const [offer, setOffer] = useState<LoyaltyCouponView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hasClubHint()) return;
    let active = true;
    fetch("/api/club/coupon")
      .then((res) => res.json() as Promise<{ coupons?: LoyaltyCouponView[] }>)
      .then((data) => {
        if (active) setOffer(data.coupons?.find((c) => c.state === "active") ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!offer || items.length === 0 || couponCode === offer.code) return null;

  async function use() {
    if (!offer) return;
    setBusy(true);
    const check = await applyCoupon(offer.code);
    setBusy(false);
    if (check === "ok") setError(null);
    else {
      setError(t(couponMessageKey(check)));
      setOffer(null);
    }
  }

  return (
    <div className={cn("space-y-1", className)} data-club-offer>
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-turquoise/50 bg-turquoise/5 px-3 py-2 text-xs">
        <Gift className="h-4 w-4 shrink-0 text-turquoise" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 font-semibold text-dark-brown">
          {t("cart.clubOffer").replace("{percent}", String(offer.percent))}
        </span>
        <button
          type="button"
          onClick={() => void use()}
          disabled={busy}
          className="min-h-9 shrink-0 rounded-lg bg-turquoise px-3 font-semibold text-warm-white disabled:opacity-60"
          data-club-offer-use
        >
          {t("cart.clubOfferUse")}
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
