import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { acceptedPickupTime, formatLocalTime, localToDate, pickupAvailability } from "@/lib/fulfillment/availability";
import { describeNext } from "@/features/checkout/describe-next";
import { buildReceiptModelFromOrder } from "@/lib/print-jobs/receipt-model";
import { renderNewOrderEmail } from "@/lib/email/templates";

/** Pure, in-memory data — no Firebase, no network, no real clock. */

const at = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return localToDate({ year: 2026, month: 11, day }, h! * 60 + m!);
};

// Customer strings from the seed file, so the test follows the real wording: [he, ar, en].
const seed = readFileSync(resolve(process.cwd(), "src/data/ui-translations-seed.ts"), "utf8");
function strings(locale: 0 | 1 | 2) {
  return (key: string) => {
    const all = [...seed.matchAll(new RegExp(`"${key.replace(/\./g, "\\.")}":\\s*"([^"]*)"`, "g"))].map((m) => m[1]!);
    return all[locale] ?? key;
  };
}
const he = strings(0);
const ar = strings(1);
const en = strings(2);

describe("when it opens (closed message / delivery button)", () => {
  it("today, tomorrow, or a weekday, in three languages", () => {
    const tueMorning = at(24, "05:00");
    expect(describeNext(he, "he", at(24, "07:00"), tueMorning, "at")).toBe("היום ב-07:00");
    expect(describeNext(he, "he", at(25, "07:00"), at(24, "22:30"), "at")).toBe("מחר ב-07:00");
    expect(describeNext(he, "he", at(29, "07:00"), at(27, "12:00"), "at")).toBe("ביום ראשון ב-07:00");
    expect(describeNext(he, "he", at(29, "07:00"), at(27, "12:00"), "from")).toBe("ביום ראשון מ-07:00");
    expect(describeNext(ar, "ar", at(29, "07:00"), at(27, "12:00"), "at")).toBe("يوم الأحد الساعة 07:00");
    expect(describeNext(en, "en", at(29, "07:00"), at(27, "12:00"), "at")).toBe("Sunday at 07:00");
    expect(describeNext(en, "en", at(25, "07:00"), at(24, "22:30"), "from")).toBe("tomorrow from 07:00");
  });

  it("the full sentences", () => {
    expect(he("checkout.closedNow").replace("{when}", "ביום ראשון ב-07:00")).toBe("סגור עכשיו. נפתח ביום ראשון ב-07:00.");
    expect(he("checkout.deliveryFrom").replace("{when}", "היום מ-07:00")).toBe("משלוח זמין היום מ-07:00");
  });
});

describe("pickup availability (shared by the checkout and the server)", () => {
  it("open: today's times; closed: the next opening; switched off: disabled", () => {
    const open = pickupAvailability(DEFAULT_OPENING_HOURS, DEFAULT_FULFILLMENT.pickup, at(24, "21:00"));
    expect(open.available && open.slots.map((s) => formatLocalTime(s))).toEqual(["21:15", "21:30", "21:45"]);
    expect(pickupAvailability(DEFAULT_OPENING_HOURS, DEFAULT_FULFILLMENT.pickup, at(27, "12:00"))).toEqual({
      available: false,
      reason: "closed",
      nextAt: at(29, "07:00"),
    });
    expect(pickupAvailability(DEFAULT_OPENING_HOURS, { ...DEFAULT_FULFILLMENT.pickup, enabled: false }, at(24, "12:00"))).toEqual({
      available: false,
      reason: "disabled",
      nextAt: null,
    });
  });

  it("accepted pickup time: on the list up to 10 minutes ago and not yet passed", () => {
    const p = DEFAULT_FULFILLMENT.pickup;
    // "12:15" was last on the list at 12:00 (prep 15 min); it stays accepted for 10 more minutes.
    expect(acceptedPickupTime(DEFAULT_OPENING_HOURS, p, at(24, "12:09"), "12:15")).toEqual(at(24, "12:15"));
    expect(acceptedPickupTime(DEFAULT_OPENING_HOURS, p, at(24, "12:11"), "12:15")).toBeNull();
    expect(acceptedPickupTime(DEFAULT_OPENING_HOURS, p, at(24, "12:16"), "12:15")).toBeNull();
    expect(acceptedPickupTime(DEFAULT_OPENING_HOURS, p, at(24, "12:11"), "12:30")).toEqual(at(24, "12:30"));
    expect(acceptedPickupTime(DEFAULT_OPENING_HOURS, p, at(24, "12:00"), "12:10")).toBeNull();
  });
});

describe("pickup time and area reach the kitchen and the manager", () => {
  const base = {
    orderNumber: "MC-2026-ABCDEFGH",
    customerName: "דנה",
    customerPhone: "0501234567",
    items: [{ productId: "p", productName: "לאטה", quantity: 1, price: 16 }],
    total: 16,
    locale: "he",
    createdAt: "2026-11-24T10:00:00.000Z",
  };

  it("printout: the time joins the big pickup line (no printer-agent update needed)", () => {
    const model = buildReceiptModelFromOrder({ ...base, orderType: "pickup", pickupTime: "12:30" });
    expect(model.pickupLabel).toBe("איסוף עצמי · 12:30");
    expect(model.deliveryAddress).toBeUndefined();
    expect(buildReceiptModelFromOrder({ ...base, orderType: "pickup" }).pickupLabel).toBe("איסוף עצמי");
  });

  it("printout: the area goes before the delivery address", () => {
    const model = buildReceiptModelFromOrder({
      ...base,
      orderType: "delivery",
      deliveryZoneName: "עין מאהל",
      deliveryAddress: "רחוב הזית 4",
      pickupTime: "12:30",
    });
    expect(model.deliveryAddress).toBe("עין מאהל — רחוב הזית 4");
    expect(model.pickupLabel).toBe("משלוח");
  });

  it("manager email: pickup time row, or area + address rows for delivery", () => {
    const common = {
      orderId: "x",
      orderNumber: "MC-2026-ABCDEFGH",
      createdAt: "2026-11-24T10:00:00.000Z",
      customerName: "דנה",
      items: [],
      total: 16,
      viewUrl: "https://example.com/orders/x",
    };
    const pickup = renderNewOrderEmail({ ...common, orderType: "pickup", pickupTime: "12:30" });
    expect(pickup.html).toContain("שעת איסוף:</strong> 12:30");
    const delivery = renderNewOrderEmail({
      ...common,
      orderType: "delivery",
      deliveryZoneName: "הר יונה / נוף הגליל",
      deliveryAddress: "רחוב <b>1</b>",
    });
    expect(delivery.html).toContain("אזור:</strong> הר יונה / נוף הגליל");
    expect(delivery.html).toContain("כתובת:</strong> רחוב &lt;b&gt;1&lt;/b&gt;");
    expect(delivery.html).not.toContain("שעת איסוף");
  });
});
