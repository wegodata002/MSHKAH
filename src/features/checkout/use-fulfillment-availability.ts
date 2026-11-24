"use client";

import { useEffect, useMemo, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import {
  deliveryAvailability,
  pickupAvailability,
  type DeliveryAvailability,
  type PickupAvailability,
} from "@/lib/fulfillment/availability";
import { DEFAULT_FULFILLMENT, type DeliveryZone } from "@/lib/fulfillment/settings";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";

/** What can be ordered right now, from the live settings. Re-checked every 30 seconds. */
export type FulfillmentNow = {
  loading: boolean;
  now: Date;
  pickup: PickupAvailability;
  /** null when delivery is switched off or has no areas: the "Delivery" button is hidden. */
  delivery: DeliveryAvailability | null;
  zones: DeliveryZone[];
  storePhone: string;
};

const REFRESH_MS = 30_000;
/** Stop waiting for the settings after this long and use the defaults. */
const SETTINGS_WAIT_MS = 8_000;

export function useFulfillmentAvailability(): FulfillmentNow {
  const { settings, loading } = useSettings();
  const [now, setNow] = useState(() => new Date());
  const [gaveUpWaiting, setGaveUpWaiting] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), REFRESH_MS);
    const wait = window.setTimeout(() => setGaveUpWaiting(true), SETTINGS_WAIT_MS);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(wait);
    };
  }, []);

  return useMemo(() => {
    // If the settings could not be read, fall back to the defaults (pickup by the default week,
    // no delivery) instead of blocking the checkout. The server checks everything again.
    const hours = settings?.openingHours ?? DEFAULT_OPENING_HOURS;
    const fulfillment = settings?.fulfillment ?? DEFAULT_FULFILLMENT;
    const pickup = pickupAvailability(hours, fulfillment.pickup, now);
    const deliveryState = settings ? deliveryAvailability(fulfillment, hours, now) : null;
    const delivery =
      deliveryState && !(!deliveryState.available && (deliveryState.reason === "disabled" || deliveryState.reason === "no_zones"))
        ? deliveryState
        : null;
    return {
      loading: loading && !settings && !gaveUpWaiting,
      now,
      pickup,
      delivery,
      zones: delivery ? fulfillment.delivery.zones : [],
      storePhone: settings?.phone?.trim() ?? "",
    };
  }, [settings, loading, now, gaveUpWaiting]);
}

export { describeNext } from "./describe-next";
