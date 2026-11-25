"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, UtensilsCrossed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/locale-provider";
import { useSettings } from "@/hooks/useSettings";
import { findTable } from "@/lib/fulfillment/availability";
import { rememberTable } from "@/lib/dine-in/scanned-table";

/**
 * Where a table's QR code leads (/t/<tableId>). A table saved in the settings, with "Dine-in active"
 * on: remember it (3 hours) and open the menu. Otherwise say why and offer the menu anyway.
 * Outside opening hours the table is still remembered; the menu says table orders are closed now.
 */
export function TableLanding({ tableId }: { tableId: string }) {
  const t = useT();
  const router = useRouter();
  const { settings, loading } = useSettings();
  const fulfillment = settings?.fulfillment ?? null;
  const table = fulfillment ? findTable(fulfillment, tableId) : null;
  const usable = Boolean(fulfillment?.dineIn.enabled && table);

  useEffect(() => {
    if (!usable || !table) return;
    rememberTable(table.id);
    router.replace("/catalog");
  }, [usable, table, router]);

  if (loading || usable) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" data-table-landing="loading">
        <Loader2 className="h-8 w-8 animate-spin text-turquoise" aria-label={t("common.loading", "Loading")} />
      </div>
    );
  }

  const reason = !fulfillment?.dineIn.enabled ? "off" : "unknown";
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center" data-table-landing={reason}>
      <UtensilsCrossed className="mx-auto h-12 w-12 text-coffee/30" strokeWidth={1.5} />
      <h1 className="mt-4 font-display text-2xl font-bold text-dark-brown">
        {t(reason === "off" ? "dineIn.landing.offTitle" : "dineIn.landing.unknownTitle")}
      </h1>
      <p className="mt-2 text-sm text-coffee/60">{t(reason === "off" ? "dineIn.landing.offHint" : "dineIn.landing.unknownHint")}</p>
      <Button asChild variant="turquoise" size="lg" className="mt-6">
        <Link href="/catalog">{t("dineIn.landing.toMenu")}</Link>
      </Button>
    </div>
  );
}
