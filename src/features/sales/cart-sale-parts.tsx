"use client";

import { X } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { useCart } from "@/features/cart/cart-context";
import { getLocalizedName } from "@/lib/i18n/localized-content";
import { formatPrice } from "@/lib/utils";

/** Cart and checkout summary: "Saved on sales ₪11.60" (nothing when no product is on sale). */
export function SaleSavingsRow() {
  const t = useT();
  const { saleSavings } = useCart();
  if (!(saleSavings > 0)) return null;
  return (
    <div className="flex justify-between text-[#9A2B1A] dark:text-[#FF8A73]" data-sale-savings>
      <span>{t("cart.saleSavings")}</span>
      <span dir="ltr" className="tabular-nums">{formatPrice(saleSavings)}</span>
    </div>
  );
}

/** "The sale on X ended — the price was updated." (or started), shown until closed. */
export function SaleNotices() {
  const t = useT();
  const { locale } = useLocale();
  const { saleNotices, dismissSaleNotices } = useCart();
  if (saleNotices.length === 0) return null;
  return (
    <div className="flex items-start justify-between gap-2 rounded-xl border border-[#E9B9A9] bg-[#FDF3EF] px-3 py-2 text-sm text-[#7A2416] dark:border-white/15 dark:bg-white/5 dark:text-warm-white" role="status" data-sale-notices>
      <ul className="space-y-0.5">
        {saleNotices.map((n) => (
          <li key={n.lineId} data-sale-notice={n.change}>
            {t(n.change === "ended" ? "cart.saleEnded" : "cart.saleStarted").replace("{name}", getLocalizedName(n.product, locale))}
          </li>
        ))}
      </ul>
      <button type="button" onClick={dismissSaleNotices} aria-label={t("common.close", "Close")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/5">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
