import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { processMessage, processQuickAction } from "@/lib/assistant/engine";
import { DEFAULT_ASSISTANT_CONFIG, type AssistantContext } from "@/lib/assistant/types";
import { whatsappUrl } from "@/lib/assistant/fulfillment-answers";
import { localToDate } from "@/lib/fulfillment/availability";
import { DEFAULT_FULFILLMENT, type FulfillmentSettings } from "@/lib/fulfillment/settings";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import type { Locale } from "@/lib/i18n/types";

/** Pure, in-memory context — no Firebase, no network, no real clock. November 2026, Israel time. */
const at = (day: number, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return localToDate({ year: 2026, month: 11, day }, h! * 60 + m!);
};
const TUE_NOON = at(24, "12:00");
const TUE_0630 = at(24, "06:30");
const MON_2300 = at(23, "23:00");
const FRI_NOON = at(27, "12:00");

/** Today's live areas. */
const LIVE: FulfillmentSettings = {
  ...DEFAULT_FULFILLMENT,
  delivery: {
    ...DEFAULT_FULFILLMENT.delivery,
    enabled: true,
    zones: [
      { id: "ein", name: { he: "עין מאהל", ar: "عين ماهل", en: "Ein Mahel" }, fee: 15, minOrder: 50 },
      { id: "har", name: { he: "הר יונה / נוף הגליל", ar: "هار يونا / نوف هجليل", en: "Har Yona / Nof HaGalil" }, fee: 25, minOrder: 50 },
    ],
  },
};

function ask(message: string, locale: Locale, now: Date, settings: FulfillmentSettings = LIVE, phone = "0587887090") {
  const ctx: AssistantContext = {
    locale,
    products: [],
    categories: [],
    config: DEFAULT_ASSISTANT_CONFIG,
    settings: { phone, address: "", hours: "", whatsapp: "", mapsUrl: "" },
    banners: [],
    fulfillment: { settings, openingHours: DEFAULT_OPENING_HOURS },
    now,
  };
  return processMessage({ message, locale }, ctx);
}

describe("delivery answers (real settings, right now)", () => {
  it("Hebrew, Tuesday noon: all areas with fee and minimum, until 21:30, other area → call", () => {
    const r = ask("יש משלוחים?", "he", TUE_NOON);
    expect(r.message).toBe(
      [
        "כן, יש משלוח עכשיו 🚚",
        "• עין מאהל — דמי משלוח ₪15, מינימום הזמנה ₪50",
        "• הר יונה / נוף הגליל — דמי משלוח ₪25, מינימום הזמנה ₪50",
        "הזמנות משלוח היום עד 21:30.",
        "לאזור אחר — צרו קשר עם החנות: 0587887090",
      ].join("\n")
    );
    expect(r.showContact).toBe(true);
  });

  it("Arabic, Friday: no delivery now, available Sunday from 07:00, areas listed", () => {
    const r = ask("في توصيل؟", "ar", FRI_NOON);
    expect(r.message).toBe(
      [
        "لا يوجد توصيل الآن. التوصيل متاح يوم الأحد من الساعة 07:00.",
        "• عين ماهل — رسوم التوصيل ₪15، الحد الأدنى للطلب ₪50",
        "• هار يونا / نوف هجليل — رسوم التوصيل ₪25، الحد الأدنى للطلب ₪50",
        "لمنطقة أخرى — تواصلوا مع المحل: 0587887090",
      ].join("\n")
    );
  });

  it("English: a named area gets the answer for that area", () => {
    expect(ask("Do you deliver to Ein Mahel?", "en", TUE_NOON).message).toBe(
      "Yes — delivery to Ein Mahel: fee ₪15, minimum order ₪50. Delivery orders today until 21:30."
    );
    expect(ask("אתם מגיעים לנוף הגליל?", "he", TUE_NOON).message).toBe(
      "כן — משלוח להר יונה / נוף הגליל: דמי משלוח ₪25, מינימום הזמנה ₪50. הזמנות משלוח היום עד 21:30."
    );
  });

  it("delivery switched off → pickup suggested, with the phone", () => {
    const r = ask("יש משלוח?", "he", TUE_NOON, DEFAULT_FULFILLMENT);
    expect(r.message).toBe("כרגע אין משלוחים — אפשר להזמין לאיסוף עצמי.\nלשאלות: 0587887090");
    expect(r.showContact).toBe(true);
  });

  it('"שעות משלוח" is about delivery, not opening hours', () => {
    expect(ask("מה שעות משלוח?", "he", TUE_NOON).message.startsWith("כן, יש משלוח עכשיו")).toBe(true);
  });

  it("no WhatsApp in any delivery answer", () => {
    for (const [msg, loc] of [["יש משלוח?", "he"], ["توصيل", "ar"], ["delivery", "en"]] as const) {
      for (const now of [TUE_NOON, FRI_NOON]) {
        expect(ask(msg, loc, now).message.toLowerCase()).not.toMatch(/whats|וואטס|ווטס|واتس/);
      }
    }
  });
});

describe("suggestion buttons at the bottom of the assistant", () => {
  it('"איסוף עצמי" / "استلام ذاتي" / "Pickup" get the pickup answer', () => {
    expect(ask("איסוף עצמי", "he", TUE_NOON).message.startsWith("כן, אפשר להזמין לאיסוף עצמי")).toBe(true);
    expect(ask("استلام ذاتي", "ar", TUE_NOON).message.startsWith("نعم، يمكن الطلب للاستلام الذاتي")).toBe(true);
    expect(ask("Pickup", "en", TUE_NOON).message.startsWith("Yes, you can order for pickup")).toBe(true);
  });

  it('"משלוחים" / "التوصيل" / "Delivery" get the delivery answer', () => {
    expect(ask("משלוחים", "he", TUE_NOON).message.startsWith("כן, יש משלוח עכשיו")).toBe(true);
    expect(ask("التوصيل", "ar", TUE_NOON).message.startsWith("نعم، يوجد توصيل الآن")).toBe(true);
    expect(ask("Delivery", "en", TUE_NOON).message.startsWith("Yes, delivery is available now")).toBe(true);
  });
});

describe("pickup answers", () => {
  it("open now: the earliest pickup time", () => {
    expect(ask("אפשר לאסוף?", "he", TUE_NOON).message).toBe("כן, אפשר להזמין לאיסוף עצמי 🛍️\nהשעה הקרובה לאיסוף: 12:15.");
  });

  it("before opening: opens today, pickup from 07:15 (Arabic)", () => {
    expect(ask("استلام ذاتي؟", "ar", TUE_0630).message).toBe("نفتح اليوم الساعة 07:00. يمكن الطلب للاستلام من الساعة 07:15.");
  });

  it("closed: when it opens (English, Friday)", () => {
    const r = ask("Pickup?", "en", FRI_NOON);
    expect(r.message).toBe("We're closed now. We open Sunday at 07:00.");
    expect(r.showContact).toBe(true);
  });
});

describe("opening hours answers", () => {
  it("Hebrew, open now: the week + open until 22:00", () => {
    expect(ask("מתי אתם פתוחים?", "he", TUE_NOON).message).toBe(
      "שעות פתיחה:\nראשון–חמישי: 07:00–22:00\nשישי–שבת: סגור\nעכשיו: פתוח עד 22:00."
    );
  });

  it("Arabic, Friday: closed, opens Sunday", () => {
    expect(ask("متى تفتحون؟", "ar", FRI_NOON).message).toBe(
      "ساعات العمل:\nالأحد–الخميس: 07:00–22:00\nالجمعة–السبت: مغلق\nالآن: مغلق · نفتح يوم الأحد الساعة 07:00."
    );
  });

  it("English, Monday night: closed, opens tomorrow", () => {
    expect(ask("Opening hours", "en", MON_2300).message).toBe(
      "Opening hours:\nSun–Thu: 07:00–22:00\nFri–Sat: Closed\nNow: closed · we open tomorrow at 07:00."
    );
  });
});

describe("WhatsApp only when entered in the settings", () => {
  it("0587887090 opens wa.me/972587887090; other formats too; empty → none", () => {
    expect(whatsappUrl("0587887090")).toBe("https://wa.me/972587887090");
    expect(whatsappUrl("058-788-7090")).toBe("https://wa.me/972587887090");
    expect(whatsappUrl("+972 58 788 7090")).toBe("https://wa.me/972587887090");
    expect(whatsappUrl("972587887090")).toBe("https://wa.me/972587887090");
    expect(whatsappUrl("")).toBeNull();
    expect(whatsappUrl(undefined)).toBeNull();
  });

  it("the chat window and the footer never fall back to the phone", () => {
    for (const file of ["src/features/assistant/assistant-drawer.tsx", "src/components/layout/footer.tsx"]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, file).toMatch(/whatsappUrl\(settings\?\.social\?\.whatsapp\)/);
      expect(source, file).not.toMatch(/social\?\.whatsapp \?\? (settings\?\.)?phone/);
    }
  });

  it("a WhatsApp quick action without a number answers with the phone instead of wa.me/<phone>", () => {
    const ctx: AssistantContext = {
      locale: "he",
      products: [],
      categories: [],
      config: {
        ...DEFAULT_ASSISTANT_CONFIG,
        quickActions: [{ id: "wa", icon: "whatsapp", label: { he: "וואטסאפ", ar: "واتساب", en: "WhatsApp" }, action: "whatsapp", enabled: true, sortOrder: 0 }],
      },
      settings: { phone: "0587887090", address: "", hours: "", whatsapp: "", mapsUrl: "" },
      banners: [],
    };
    const r = processQuickAction("wa", ctx, { message: "", locale: "he", quickActionId: "wa" });
    expect(r.clientAction).toBeUndefined();
    expect(r.showContact).toBe(true);
    const withNumber = processQuickAction("wa", { ...ctx, settings: { ...ctx.settings, whatsapp: "0587887090" } }, { message: "", locale: "he", quickActionId: "wa" });
    expect(withNumber.clientAction).toEqual({ type: "open_url", url: "https://wa.me/972587887090" });
  });
});
