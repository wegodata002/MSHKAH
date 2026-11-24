"use client";

import { useLocale, useT } from "@/components/providers/locale-provider";
import { describeNext, useFulfillmentAvailability } from "./use-fulfillment-availability";

/** Cart line saying what can be ordered right now (replaces the old fixed "pickup only" note). */
export function FulfillmentNote() {
  const t = useT();
  const { locale } = useLocale();
  const { loading, pickup, delivery, now } = useFulfillmentAvailability();
  if (loading) return null;

  const pickupOk = pickup.available;
  const deliveryOk = delivery?.available === true;
  let text: string;
  if (pickupOk && deliveryOk) text = t("cart.availableBoth");
  else if (pickupOk) text = t("cart.availablePickup");
  else if (deliveryOk) text = t("cart.availableDelivery");
  else if (pickup.nextAt) text = t("checkout.closedNow").replace("{when}", describeNext(t, locale, pickup.nextAt, now, "at"));
  else text = t("checkout.pickupUnavailable");

  return (
    <p className="text-xs text-coffee/50" data-fulfillment-note>
      {text}
    </p>
  );
}
