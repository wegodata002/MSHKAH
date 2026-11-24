"use client";

import { useState } from "react";
import { Check, Copy, Gift } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { ClubCard } from "@/features/club/club-ui";
import type { LoyaltyCouponView } from "@/lib/loyalty/coupons";
import { cn } from "@/lib/utils";

const DATE_LOCALES = { he: "he-IL", ar: "ar-u-nu-latn", en: "en-GB" } as const;

/**
 * "My perks" on the member page: the welcome code (later also coupons from the manager),
 * with its code, percent, expiry and how to use it; used / expired ones are shown greyed.
 */
export function ClubCoupons({ coupons }: { coupons: LoyaltyCouponView[] }) {
  const t = useT();
  return (
    <ClubCard>
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-dark-brown">
        <Gift className="h-5 w-5 text-turquoise" strokeWidth={1.75} />
        {t("club2.coupon.sectionTitle")}
      </h2>
      <div className="mt-3 space-y-3">
        {coupons.map((coupon) => (
          <CouponTicket key={coupon.code} coupon={coupon} />
        ))}
      </div>
    </ClubCard>
  );
}

function CouponTicket({ coupon }: { coupon: LoyaltyCouponView }) {
  const t = useT();
  const { locale } = useLocale();
  const [copied, setCopied] = useState(false);
  const active = coupon.state === "active";
  const until = new Date(coupon.expiresAt).toLocaleDateString(DATE_LOCALES[locale] ?? "he-IL", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the code is still visible to copy by hand.
    }
  }

  return (
    <div
      className={cn(
        "rounded-2xl border-2 border-dashed p-4",
        active ? "border-turquoise/50 bg-turquoise/5" : "border-beige-dark/30 bg-beige/30 opacity-75"
      )}
      data-coupon={coupon.state}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-lg font-extrabold text-dark-brown">
            {t("club2.coupon.percentOff").replace("{percent}", String(coupon.percent))}
          </p>
          {coupon.firstPurchaseOnly ? <p className="text-sm text-coffee/70">{t("club2.coupon.firstPurchase")}</p> : null}
        </div>
        {!active ? (
          <span className="rounded-full bg-coffee/10 px-2.5 py-1 text-xs font-bold text-coffee/70" data-coupon-badge>
            {t(coupon.state === "used" ? "club2.coupon.used" : "club2.coupon.expired")}
          </span>
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span
          dir="ltr"
          className={cn(
            "rounded-xl bg-white px-3 py-2 font-mono text-lg font-bold tracking-wider text-dark-brown shadow-sm",
            !active && "line-through decoration-coffee/40"
          )}
          data-coupon-code
        >
          {coupon.code}
        </span>
        {active ? (
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex min-h-10 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-turquoise hover:bg-turquoise/10"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {t(copied ? "club2.coupon.copied" : "club2.coupon.copy")}
          </button>
        ) : null}
      </div>
      {active ? (
        <>
          <p className="mt-2 text-xs font-semibold text-coffee/70" data-coupon-until>
            {t("club2.coupon.validUntil").replace("{date}", until)}
          </p>
          <ul className="mt-2 space-y-0.5 text-xs text-coffee/70">
            <li>• {t("club2.coupon.howSite")}</li>
            <li>• {t("club2.coupon.howCounter")}</li>
          </ul>
        </>
      ) : null}
    </div>
  );
}
