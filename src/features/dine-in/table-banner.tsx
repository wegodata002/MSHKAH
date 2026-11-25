"use client";

import { UtensilsCrossed } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { useSettings } from "@/hooks/useSettings";
import { useFulfillmentAvailability } from "@/features/checkout/use-fulfillment-availability";
import { describeNext } from "@/features/checkout/describe-next";
import { tableDisplayName } from "@/lib/fulfillment/settings";
import { scannedTableIn, useScannedTable } from "@/lib/dine-in/scanned-table";
import { cn } from "@/lib/utils";

/** Top of the menu after scanning a table QR: "Ordering to Table 4 · Inside" (or closed right now). */
export function TableBanner() {
  const t = useT();
  const { locale } = useLocale();
  const { settings } = useSettings();
  const scanned = useScannedTable();
  const availability = useFulfillmentAvailability();
  const fulfillment = settings?.fulfillment ?? null;
  const table = scannedTableIn(fulfillment, scanned);
  if (!table || !fulfillment?.dineIn.enabled || !availability.dineIn) return null;

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
      <strong className="shrink-0">{tableDisplayName(table, locale)}</strong>
    </div>
  );
}
