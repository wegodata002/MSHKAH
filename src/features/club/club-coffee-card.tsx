"use client";

import { Coffee, Gift } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { ClubCard } from "@/features/club/club-ui";
import { COFFEE_CUPS_FOR_GIFT, coffeeCardView } from "@/lib/loyalty/coffee";
import { cn } from "@/lib/utils";

/** 5 cups + the free 6th. Staff add the cups at the counter; the customer only sees them. */
export function CoffeeStamps({ cups, size = "md" }: { cups: number; size?: "md" | "lg" }) {
  const view = coffeeCardView(cups);
  const box = size === "lg" ? "h-12 w-12" : "h-10 w-10";
  return (
    <div className="flex flex-wrap items-center gap-2" data-coffee-stamps={view.filled}>
      {Array.from({ length: COFFEE_CUPS_FOR_GIFT }, (_, i) => (
        <span
          key={i}
          className={cn(
            "flex items-center justify-center rounded-full border-2",
            box,
            i < view.filled ? "border-turquoise bg-turquoise text-warm-white" : "border-dashed border-beige-dark/50 text-coffee/25"
          )}
          data-coffee-cup={i < view.filled ? "full" : "empty"}
        >
          <Coffee className="h-5 w-5" strokeWidth={1.75} />
        </span>
      ))}
      <span
        className={cn(
          "flex items-center justify-center rounded-full border-2",
          box,
          view.giftReady
            ? "animate-pulse border-[#E9C46A] bg-[#E9C46A] text-dark-brown shadow-[0_0_0_4px_rgba(233,196,106,0.35)]"
            : "border-dashed border-[#E9C46A]/70 text-[#C9A24A]"
        )}
        data-coffee-gift={view.giftReady ? "ready" : "waiting"}
      >
        <Gift className="h-5 w-5" strokeWidth={1.75} />
      </span>
    </div>
  );
}

export function ClubCoffeeCard({ cups }: { cups: number }) {
  const t = useT();
  const view = coffeeCardView(cups);
  return (
    <ClubCard>
      <h2 className="flex items-center gap-2 font-display text-lg font-bold text-dark-brown">
        <Coffee className="h-5 w-5 text-turquoise" strokeWidth={1.75} />
        {t("club3.coffee.title")}
      </h2>
      <div className="mt-4">
        <CoffeeStamps cups={cups} />
      </div>
      <p className={cn("mt-3 text-sm font-semibold", view.giftReady ? "text-[#9A7320]" : "text-coffee/75")} data-coffee-status>
        {view.giftReady
          ? t("club3.coffee.giftReady")
          : view.toGift === 1
            ? t("club3.coffee.toGiftOne")
            : t("club3.coffee.toGift").replace("{n}", String(view.toGift))}
      </p>
      <p className="mt-1 text-xs text-coffee/55">{t("club3.coffee.hint")}</p>
    </ClubCard>
  );
}
