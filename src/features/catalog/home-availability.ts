import {
  isOpenAt,
  nextOpeningAfter,
  type DeliveryAvailability,
  type PickupAvailability,
} from "@/lib/fulfillment/availability";
import type { OpeningHours } from "@/lib/settings/opening-hours";

/**
 * The one-line status on the home page. Pure: everything is passed in.
 * - "delivery": delivery can be ordered now.
 * - "pickup": only pickup can be ordered now (delivery off or outside its hours).
 * - "opens_today": closed now, but opens later today (pickup can already be ordered).
 * - "closed": nothing can be ordered now; `nextAt` is the next real opening (or null).
 * - null: nothing useful to say (e.g. open, but pickup switched off and no delivery).
 */
export type HomeAvailabilityStatus =
  | { kind: "delivery" }
  | { kind: "pickup" }
  | { kind: "opens_today"; at: Date }
  | { kind: "closed"; nextAt: Date | null }
  | null;

export function homeAvailabilityStatus(input: {
  pickup: PickupAvailability;
  delivery: DeliveryAvailability | null;
  openingHours: OpeningHours;
  now: Date;
}): HomeAvailabilityStatus {
  const { pickup, delivery, openingHours, now } = input;
  const openNow = isOpenAt(openingHours, now);

  if (delivery?.available) return { kind: "delivery" };
  if (pickup.available) {
    if (openNow) return { kind: "pickup" };
    const at = nextOpeningAfter(openingHours, now);
    return at ? { kind: "opens_today", at } : { kind: "pickup" };
  }
  // Nothing can be ordered right now.
  if (openNow && pickup.reason === "disabled") return null;
  const nextAt = pickup.nextAt ?? nextOpeningAfter(openingHours, now);
  return { kind: "closed", nextAt };
}
