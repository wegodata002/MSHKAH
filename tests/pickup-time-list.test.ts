import { describe, expect, it } from "vitest";
import { PICKUP_TIMES_PAGE, initialVisibleTimes, moreVisibleTimes } from "@/features/checkout/pickup-time-list";

/** Pure — no React, no Firebase. */
describe("pickup time list: how many times to show", () => {
  it("opens with the first 6", () => {
    expect(PICKUP_TIMES_PAGE).toBe(6);
    expect(initialVisibleTimes(39, 0)).toBe(6);
    expect(initialVisibleTimes(39, -1)).toBe(6);
  });

  it("'Show more' adds 6 each time, up to the end", () => {
    expect(moreVisibleTimes(6, 39)).toBe(12);
    expect(moreVisibleTimes(12, 39)).toBe(18);
    expect(moreVisibleTimes(36, 39)).toBe(39);
    expect(moreVisibleTimes(39, 39)).toBe(39);
  });

  it("fewer than 6 times → all of them", () => {
    expect(initialVisibleTimes(3, 0)).toBe(3);
    expect(initialVisibleTimes(0, -1)).toBe(0);
  });

  it("reopening shows enough pages to include the selected time", () => {
    expect(initialVisibleTimes(39, 5)).toBe(6); // 6th time → first page
    expect(initialVisibleTimes(39, 6)).toBe(12); // 7th time → two pages
    expect(initialVisibleTimes(39, 25)).toBe(30); // 18:30 at noon → five pages
    expect(initialVisibleTimes(39, 38)).toBe(39); // last time → everything
  });
});
