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
    <ClubCard compact>
      <h2 className="flex items-center gap-1.5 font-display text-base font-bold text-dark-brown">
        <Gift className="h-4 w-4 text-turquoise" strokeWidth={1.75} />
        {t("club2.coupon.sectionTitle")}
      </h2>
      <div className="mt-2.5 space-y-2">
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
        "rounded-xl border-2 border-dashed p-3",
        active ? "border-turquoise/50 bg-turquoise/5" : "border-beige-dark/30 bg-beige/30 opacity-75"
      )}
      data-coupon={coupon.state}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-sm text-coffee/70">
          <span className="text-base font-extrabold text-dark-brown">
            {t("club2.coupon.percentOff").replace("{percent}", String(coupon.percent))}
          </span>
          {coupon.firstPurchaseOnly ? ` · ${t("club2.coupon.firstPurchase")}` : null}
        </p>
        {!active ? (
          <span className="rounded-full bg-coffee/10 px-2 py-0.5 text-[11px] font-bold text-coffee/70" data-coupon-badge>
            {t(coupon.state === "used" ? "club2.coupon.used" : "club2.coupon.expired")}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          dir="ltr"
          className={cn(
            "rounded-lg bg-white px-2.5 py-1 font-mono text-base font-bold tracking-wider text-dark-brown shadow-sm",
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
            className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-turquoise hover:bg-turquoise/10"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {t(copied ? "club2.coupon.copied" : "club2.coupon.copy")}
          </button>
        ) : null}
        {active ? (
          <span className="ms-auto text-xs font-semibold text-coffee/70" data-coupon-until>
            {t("club2.coupon.validUntil").replace("{date}", until)}
          </span>
        ) : null}
      </div>
      {active ? (
        <>
          <ul className="mt-1.5 space-y-0.5 text-[11px] leading-snug text-coffee/65">
            <li>• {t("club2.coupon.howSite")}</li>
            <li>• {t("club2.coupon.howCounter")}</li>
          </ul>
        </>
      ) : null}
    </div>
  );
}
