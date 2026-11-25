"use client";

import { UtensilsCrossed, X } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { useSettings } from "@/hooks/useSettings";
import { useFulfillmentAvailability } from "@/features/checkout/use-fulfillment-availability";
import { describeNext } from "@/features/checkout/describe-next";
import { tableDisplayName } from "@/lib/fulfillment/settings";
import { forgetTable, scannedTableIn, useScannedTable } from "@/lib/dine-in/scanned-table";
import { cn } from "@/lib/utils";

/** The table this browser is ordering to, when its strip is shown (else null). */
export function useTableBannerTable() {
  const { settings } = useSettings();
  const scanned = useScannedTable();
  const availability = useFulfillmentAvailability();
  const fulfillment = settings?.fulfillment ?? null;
  const table = scannedTableIn(fulfillment, scanned);
  return table && fulfillment?.dineIn.enabled && availability.dineIn ? table : null;
}

/**
 * Top of the menu after scanning a table QR: "Ordering to Table 4 · Inside" (or closed right now),
 * with ✕ "Not at the table" to forget the table in this browser.
 */
export function TableBanner() {
  const t = useT();
  const { locale } = useLocale();
  const availability = useFulfillmentAvailability();
  const table = useTableBannerTable();
  if (!table || !availability.dineIn) return null;

  const open = availability.dineIn.available;
  const next = !availability.dineIn.available ? availability.dineIn.nextAt : null;
  return (
    <div
      className={cn(
        "mb-3 flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm",
        open ? "bg-turquoise text-warm-white" : "bg-amber-50 text-amber-900"
      )}
      data-table-banner={open ? "open" : "closed"}
    >
      <span className="inline-flex items-center gap-2">
        <UtensilsCrossed className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        {open
          ? t("dineIn.banner.ordering")
          : next
            ? t("dineIn.banner.closedUntil").replace("{when}", describeNext(t, locale, next, availability.now, "at"))
            : t("dineIn.banner.closed")}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <strong>{tableDisplayName(table, locale)}</strong>
        <button
          type="button"
          onClick={() => forgetTable()}
          aria-label={t("dineIn.banner.notAtTable")}
          title={t("dineIn.banner.notAtTable")}
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold",
            open ? "bg-warm-white/15 hover:bg-warm-white/25" : "bg-amber-100 hover:bg-amber-200"
          )}
          data-table-banner-leave
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
          <span className="hidden min-[400px]:inline">{t("dineIn.banner.notAtTable")}</span>
        </button>
      </span>
    </div>
  );
}
