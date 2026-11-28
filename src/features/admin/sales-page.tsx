"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/providers/locale-provider";
import { SalesAdmin } from "@/features/admin/sales-admin";
import { BundlesAdmin } from "@/features/admin/bundles-admin";
import { cn } from "@/lib/utils";

type Tab = "sales" | "bundles";

/** Admin → Sales: two tabs, "Sales" (discounts on products) and "Bundles" (several products, one price). */
export function SalesPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>("sales");
  // ?tab=bundles opens the bundles (a link from elsewhere in the admin).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "bundles") setTab("bundles");
  }, []);
  const choose = (next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === "bundles") url.searchParams.set("tab", "bundles");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url.toString());
  };
  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist" aria-label={t("admin.sales.title")}>
        {(["sales", "bundles"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => choose(id)}
            className={cn("h-10 rounded-full border px-4 text-sm font-semibold", tab === id ? "border-turquoise bg-turquoise text-warm-white" : "border-beige-dark/40 bg-warm-white text-coffee/70 dark:bg-white/5")}
            data-sales-tab={id}
          >
            {t(id === "sales" ? "admin.sales.tab.sales" : "admin.sales.tab.bundles")}
          </button>
        ))}
      </div>
      {tab === "sales" ? <SalesAdmin /> : <BundlesAdmin />}
    </div>
  );
}
