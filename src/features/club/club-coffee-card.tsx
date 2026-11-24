"use client";

import { Coffee, Gift } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { ClubCard } from "@/features/club/club-ui";
import { COFFEE_CUPS_FOR_GIFT, coffeeCardView } from "@/lib/loyalty/coffee";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: { box: "h-8 w-8", icon: "h-4 w-4" },
  md: { box: "h-10 w-10", icon: "h-5 w-5" },
  lg: { box: "h-12 w-12", icon: "h-5 w-5" },
} as const;

/**
 * 5 cups + the free 6th. Staff add the cups at the counter; the customer only sees them.
 * `glowFrom`: cups from this index on were just added (they glow for a moment).
 */
export function CoffeeStamps({
  cups,
  size = "md",
  glowFrom,
}: {
  cups: number;
  size?: keyof typeof SIZES;
  glowFrom?: number | null;
}) {
  const view = coffeeCardView(cups);
  const { box, icon } = SIZES[size];
  const glowing = (i: number) => glowFrom !== null && glowFrom !== undefined && i >= glowFrom && i < view.filled;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-coffee-stamps={view.filled}>
      {Array.from({ length: COFFEE_CUPS_FOR_GIFT }, (_, i) => (
        <span
          key={i}
          className={cn(
            "flex items-center justify-center rounded-full border-2 transition-shadow duration-500",
            box,
            i < view.filled ? "border-turquoise bg-turquoise text-warm-white" : "border-dashed border-beige-dark/50 text-coffee/25",
            glowing(i) && "animate-pulse shadow-[0_0_0_5px_rgba(233,196,106,0.55)]"
          )}
          data-coffee-cup={i < view.filled ? "full" : "empty"}
          data-coffee-glow={glowing(i) ? "1" : undefined}
        >
          <Coffee className={icon} strokeWidth={1.75} />
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
        <Gift className={icon} strokeWidth={1.75} />
      </span>
    </div>
  );
}

/** The member page's coffee card (compact). */
export function ClubCoffeeCard({ cups, glowFrom }: { cups: number; glowFrom?: number | null }) {
  const t = useT();
  const view = coffeeCardView(cups);
  return (
    <ClubCard compact>
      <h2 className="flex items-center gap-1.5 font-display text-base font-bold text-dark-brown">
        <Coffee className="h-4 w-4 text-turquoise" strokeWidth={1.75} />
        {t("club3.coffee.title")}
      </h2>
      <div className="mt-3">
        <CoffeeStamps cups={cups} size="sm" glowFrom={glowFrom} />
      </div>
      <p className={cn("mt-2 text-sm font-semibold", view.giftReady ? "text-[#9A7320]" : "text-coffee/75")} data-coffee-status>
        {view.giftReady
          ? t("club3.coffee.giftReady")
          : view.toGift === 1
            ? t("club3.coffee.toGiftOne")
            : t("club3.coffee.toGift").replace("{n}", String(view.toGift))}
      </p>
      <p className="mt-0.5 text-xs text-coffee/55">{t("club3.coffee.hint")}</p>
    </ClubCard>
  );
}
