"use client";

import {
  mergeDetails,
  parseSavedDetails,
  SAVED_DETAILS_KEY,
  type CheckoutDetails,
} from "@/lib/customers/checkout-details";

/** Last order's details on this device (not a club member logged in here): 180 days from the last order. */
export function readDeviceDetails(): CheckoutDetails | null {
  try {
    const raw = window.localStorage.getItem(SAVED_DETAILS_KEY);
    const parsed = parseSavedDetails(raw ? JSON.parse(raw) : null);
    if (!parsed && raw) window.localStorage.removeItem(SAVED_DETAILS_KEY); // expired or malformed
    return parsed;
  } catch {
    return null;
  }
}

/** After an order is saved: keep its details (merged with what was kept) for the next order. */
export function rememberDeviceDetails(next: CheckoutDetails, wasDelivery: boolean): void {
  try {
    const merged = mergeDetails(readDeviceDetails() ?? {}, next, wasDelivery);
    window.localStorage.setItem(SAVED_DETAILS_KEY, JSON.stringify({ ...merged, savedAt: Date.now() }));
  } catch {
    // Storage blocked: nothing is kept.
  }
}
