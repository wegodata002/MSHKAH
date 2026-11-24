"use client";

import { Phone } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import { useFulfillmentAvailability } from "@/features/checkout/use-fulfillment-availability";
import { describeNext } from "@/features/checkout/describe-next";
import { homeAvailabilityStatus } from "./home-availability";

/** Home page: one short line with what can be ordered now (under the banner, above the categories). */
export function AvailabilityPill() {
  const t = useT();
  const { locale } = useLocale();
  const availability = useFulfillmentAvailability();
  if (availability.loading) return null;

  const status = homeAvailabilityStatus(availability);
  if (!status) return null;

  let text: string;
  let tone: "open" | "neutral" | "closed";
  if (status.kind === "delivery") {
    text = t("home.status.delivery");
    tone = "open";
  } else if (status.kind === "pickup") {
    text = t("home.status.pickup");
    tone = "neutral";
  } else if (status.kind === "opens_today") {
    text = t("home.status.opens").replace("{when}", describeNext(t, locale, status.at, availability.now, "at"));
    tone = "closed";
  } else {
    text = status.nextAt
      ? t("home.status.closedUntil").replace("{when}", describeNext(t, locale, status.nextAt, availability.now, "at"))
      : t("home.status.closed");
    tone = "closed";
  }
  const phone = status.kind === "closed" ? availability.storePhone : "";

  return (
    <div className="mb-2.5 flex" data-availability-pill={status.kind}>
      <div
        role="status"
        className={cn(
          "inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border py-1 ps-3 text-[13.5px] font-semibold text-dark-brown",
          phone ? "pe-1" : "pe-4",
          tone === "open" && "border-turquoise/30 bg-turquoise/[0.08]",
          tone === "neutral" && "border-beige-dark/25 bg-warm-white",
          tone === "closed" && "border-amber-600/35 bg-amber-50"
        )}
      >
        <span
          aria-hidden
          className={cn("h-2 w-2 shrink-0 rounded-full", tone === "closed" ? "bg-amber-600" : "bg-green-600")}
        />
        <span className="truncate">{text}</span>
        {phone ? (
          <a
            href={`tel:${phone.replace(/[^\d+]/g, "")}`}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-turquoise px-2.5 text-[12.5px] font-semibold text-white hover:bg-turquoise/90"
            aria-label={`${t("home.status.call")} ${phone}`}
          >
            <Phone className="h-3.5 w-3.5" strokeWidth={2.2} />
            {t("home.status.call")}
          </a>
        ) : null}
      </div>
    </div>
  );
}
