// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFakeFirestore } from "./helpers/fake-firestore";
import { DEFAULT_OPENING_HOURS } from "@/lib/settings/opening-hours";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { localToDate } from "@/lib/fulfillment/availability";
import type { CatalogProduct, CreateOrderRequest } from "@/lib/orders/server-order";
import {
  couponState,
  holdIsReleased,
  isPersonalCouponCode,
  personalCodeFromIndexes,
  restoredExpiry,
  type LoyaltyCoupon,
} from "@/lib/loyalty/coupons";
import { hasClubHint } from "@/lib/loyalty/club-hint";
import { signClubSession } from "@/lib/loyalty/session";
import { hashEmail } from "@/lib/loyalty/tokens";

/**
 * Club 2: the personal 10% welcome code, club emails in the customer's language, the signed
 * card link and the header button. Real routes / server functions over a strict in-memory
 * Firestore; no network, no real database.
 */

const fake = createFakeFirestore();
const sentEmails: Array<{ to: string; subject: string; html: string; text: string; kind: string }> = [];
const cookieJar = new Map<string, string>();
const cancelledEmails: string[] = [];

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fake.db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (c: { name: string; value: string; maxAge?: number }) => {
      if (c.maxAge === 0) cookieJar.delete(c.name);
      else cookieJar.set(c.name, c.value);
    },
  }),
}));
vi.mock("@/lib/email/send", () => ({
  sendMishkahEmail: async (input: { to: string; subject: string; html: string; text: string; kind: string }) => {
    sentEmails.push(input);
    return { ok: true };
  },
  sendOrderCancelledNotificationEmail: async (payload: { orderNumber?: string }) => {
    cancelledEmails.push(String(payload.orderNumber ?? ""));
    return { ok: true, messageId: "m1" };
  },
}));
vi.mock("@/lib/email/notification-state", () => ({
  claimNotification: async () => ({ ok: true }),
  markNotificationSent: async () => undefined,
  markNotificationFailed: async () => undefined,
}));

const { POST: start } = await import("@/app/api/club/enroll/start/route");
const { POST: verify } = await import("@/app/api/club/enroll/verify/route");
const { GET: me } = await import("@/app/api/club/me/route");
const { GET: listCoupons, POST: checkCouponRoute } = await import("@/app/api/club/coupon/route");
const { POST: logout } = await import("@/app/api/club/session/route");
const coupons = await import("@/lib/loyalty/admin/coupons");
const { handleCreateOrder } = await import("@/lib/orders/create-order-handler");
const { notifyOrderCancelled } = await import("@/lib/email/notifications/order-cancelled");
const { readMemberCard, signMemberCard } = await import("@/lib/loyalty/card-link");

// ── Helpers ───────────────────────────────────────────────────────────
const NOW = localToDate({ year: 2026, month: 11, day: 24 }, 12 * 60); // Tuesday noon, Israel
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

type Json = Record<string, unknown> & { ok?: boolean; reason?: string };
const post = async (handler: (req: never) => Promise<Response>, body: unknown, cookieHeader = "") => {
  const cookies = new Map(cookieHeader.split(";").filter(Boolean).map((p) => p.trim().split("=") as [string, string]));
  const req = {
    json: async () => body,
    headers: new Headers({ "x-forwarded-for": "10.0.0.9" }),
    cookies: { get: (n: string) => (cookies.has(n) ? { name: n, value: cookies.get(n)! } : undefined) },
  };
  const res = await handler(req as never);
  return { status: res.status, body: (await res.json()) as Json };
};
const flush = () => new Promise((r) => setTimeout(r, 0));
const codeFromLastEmail = () => sentEmails.filter((m) => m.kind === "loyalty_verification").at(-1)!.text.match(/\b(\d{6})\b/)![1]!;

async function join(email: string, name: string, locale: "he" | "ar" | "en" = "he") {
  await post(start, { email, locale });
  const res = await post(verify, { email, code: codeFromLastEmail(), displayName: name, locale });
  await flush();
  await flush();
  return res;
}

function member(email: string) {
  return [...fake.col("loyaltyMembers").values()].find((m) => m.email === email.toLowerCase()) as Record<string, unknown> & {
    id: string;
  };
}

/** An active member who joined before codes existed (no welcomeCouponCode). */
function oldMember(id: string, email: string) {
  fake.put("loyaltyMembers", id, {
    id,
    memberNumber: `M-${id}`,
    email,
    emailHash: hashEmail(email),
    displayName: "ותיק",
    status: "active",
    balancePoints: 0,
    joinFeePaidMinor: 0,
    consentTerms: true,
    consentMarketing: false,
    createdAt: iso(NOW.getTime() - 20 * DAY),
    updatedAt: iso(NOW.getTime() - 20 * DAY),
    activatedAt: iso(NOW.getTime() - 20 * DAY),
  });
  return `mkh_club=${signClubSession({ emailHash: hashEmail(email) }).value}`;
}

function welcomeCoupon(memberId: string, patch: Partial<LoyaltyCoupon> = {}): LoyaltyCoupon {
  const coupon: LoyaltyCoupon = {
    id: "MK-AAAA-BBBB",
    code: "MK-AAAA-BBBB",
    memberId,
    kind: "welcome",
    percent: 10,
    status: "active",
    firstPurchaseOnly: true,
    expiresAt: iso(NOW.getTime() + 30 * DAY),
    createdAt: iso(NOW.getTime()),
    createdBy: "system",
    ...patch,
  };
  fake.put("loyaltyCoupons", coupon.code, coupon as unknown as Record<string, unknown>);
  return coupon;
}

beforeEach(() => {
  fake.reset();
  sentEmails.length = 0;
  cancelledEmails.length = 0;
  cookieJar.clear();
  fake.put("loyaltySettings", "app", { enrollmentEnabled: true, earnEnabled: true, welcomeCouponEnabled: true });
});

// ── Pure rules ────────────────────────────────────────────────────────
describe("personal codes (pure)", () => {
  it("MK-XXXX-XXXX, no look-alike characters", () => {
    const code = personalCodeFromIndexes([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(code).toBe("MK-ABCD-EFGH");
    expect(isPersonalCouponCode(code)).toBe(true);
    expect(isPersonalCouponCode(" mk-abcd-efgh ")).toBe(true);
    expect(isPersonalCouponCode("MK-ABC0-EFGH")).toBe(false);
    expect(isPersonalCouponCode("MISHKAT10")).toBe(false);
    expect(isPersonalCouponCode(coupons.generatePersonalCode())).toBe(true);
  });

  it("first purchase: expired once there is a completed order other than the code's own", () => {
    const c = { status: "active" as const, expiresAt: iso(NOW.getTime() + DAY), firstPurchaseOnly: true, orderId: null };
    expect(couponState(c, { now: NOW, completedOrderIds: new Set() })).toBe("active");
    expect(couponState(c, { now: NOW, completedOrderIds: new Set(["o1"]) })).toBe("expired");
    expect(couponState({ ...c, firstPurchaseOnly: false }, { now: NOW, completedOrderIds: new Set(["o1"]) })).toBe("active");
    expect(couponState({ ...c, expiresAt: iso(NOW.getTime() - 1) }, { now: NOW, completedOrderIds: new Set() })).toBe("expired");
    // Used by o1 → "used", even though o1 is a completed order.
    expect(couponState({ ...c, status: "redeemed", orderId: "o1" }, { now: NOW, completedOrderIds: new Set(["o1"]) })).toBe("used");
  });

  it("a code given back after a cancellation: original expiry, but at least 3 days from now", () => {
    expect(restoredExpiry(iso(NOW.getTime() + 20 * DAY), NOW)).toBe(iso(NOW.getTime() + 20 * DAY));
    expect(restoredExpiry(iso(NOW.getTime() + DAY), NOW)).toBe(iso(NOW.getTime() + 3 * DAY));
    expect(restoredExpiry(iso(NOW.getTime() - 5 * DAY), NOW)).toBe(iso(NOW.getTime() + 3 * DAY));
  });

  it("an unpaid card order frees its code after 30 minutes; cash and paid orders keep it", () => {
    const card = (minutesAgo: number) => ({
      status: "pending",
      paymentStatus: "pending",
      paymentCollection: "online",
      createdAt: { toMillis: () => NOW.getTime() - minutesAgo * 60_000 },
    });
    expect(holdIsReleased(card(10), NOW)).toBe(false);
    expect(holdIsReleased(card(31), NOW)).toBe(true);
    expect(holdIsReleased({ ...card(90), paymentStatus: "paid" }, NOW)).toBe(false);
    expect(holdIsReleased({ ...card(90), paymentCollection: "counter" }, NOW)).toBe(false);
    expect(holdIsReleased({ ...card(1), status: "cancelled" }, NOW)).toBe(true);
    expect(holdIsReleased(null, NOW)).toBe(true);
  });
});

// ── Joining: code, emails, language ───────────────────────────────────
describe("joining gives a personal 10% code, emails in the customer's language", () => {
  it("Hebrew: the code email says a 10% code follows; the welcome email spells it out", async () => {
    await post(start, { email: "dana@example.com", locale: "he" });
    const codeMail = sentEmails.at(-1)!;
    expect(codeMail.html).toContain('<html lang="he" dir="rtl">');
    expect(codeMail.html).toContain("אחרי האימות תקבלו קוד הנחה 10% לקנייה הראשונה.");

    const res = await post(verify, { email: "dana@example.com", code: codeFromLastEmail(), displayName: "דנה", locale: "he" });
    expect(res.body.ok).toBe(true);
    await flush();
    await flush();
    const m = member("dana@example.com");
    const code = m.welcomeCouponCode as string;
    expect(isPersonalCouponCode(code)).toBe(true);
    const coupon = fake.get("loyaltyCoupons", code)!;
    expect(coupon).toMatchObject({ memberId: m.id, kind: "welcome", percent: 10, status: "active", firstPurchaseOnly: true });
    const days = (Date.parse(coupon.expiresAt as string) - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    const welcome = sentEmails.find((e) => e.kind === "loyalty_welcome")!;
    expect(welcome.html).toContain(code);
    expect(welcome.html).toContain("המתנה שלך: 10% הנחה");
    expect(welcome.html).toContain("לקנייה הראשונה");
    expect(welcome.html).toMatch(/בתוקף עד <span dir="ltr">\d{1,2}\.\d{1,2}\.\d{4}<\/span>/);
    expect(welcome.html).toContain("באתר: מזינים את הקוד בעגלה");
    expect(welcome.html).toContain("בקופה: מציגים את כרטיס החבר או אומרים את הקוד");
    expect(welcome.text).toContain(code);
  });

  it("Arabic emails are right-to-left, English left-to-right, in their own words", async () => {
    await join("sami@example.com", "سامي", "ar");
    const arCode = sentEmails.find((e) => e.kind === "loyalty_verification")!;
    const arWelcome = sentEmails.find((e) => e.kind === "loyalty_welcome")!;
    expect(arCode.html).toContain('<html lang="ar" dir="rtl">');
    expect(arCode.html).toContain("بعد التحقق ستحصلون على كود خصم 10% لأول عملية شراء.");
    expect(arWelcome.subject).toBe("أهلًا بكم في نادي مشكاة");
    expect(arWelcome.html).toContain('<html lang="ar" dir="rtl">');
    expect(arWelcome.html).toContain("هديتكم: خصم 10%");

    sentEmails.length = 0;
    await join("john@example.com", "John", "en");
    const enWelcome = sentEmails.find((e) => e.kind === "loyalty_welcome")!;
    expect(enWelcome.subject).toBe("Welcome to the Mishkat Club");
    expect(enWelcome.html).toContain('<html lang="en" dir="ltr">');
    expect(enWelcome.html).toContain('text-align:left');
    expect(enWelcome.html).toContain("Your gift: 10% off");
    expect(enWelcome.html).toMatch(/Valid until <span dir="ltr">\d{2}\/\d{2}\/\d{4}<\/span>/);
    expect(member("john@example.com").locale).toBe("en");
  });

  it("a member logging in is not promised a code again", async () => {
    await join("dana@example.com", "דנה");
    sentEmails.length = 0;
    await post(start, { email: "dana@example.com", locale: "he" });
    expect(sentEmails.at(-1)!.html).not.toContain("data-welcome-line");
  });

  it("one code per member (one per email), even after logging in again", async () => {
    await join("dana@example.com", "דנה");
    await post(start, { email: "dana@example.com" });
    await post(verify, { email: "dana@example.com", code: codeFromLastEmail() });
    expect(fake.col("loyaltyCoupons").size).toBe(1);
  });

  it("with the admin switch off: no code, no line in the email (and no gift in the welcome)", async () => {
    fake.put("loyaltySettings", "app", { enrollmentEnabled: true, earnEnabled: true, welcomeCouponEnabled: false });
    await join("dana@example.com", "דנה");
    expect(fake.col("loyaltyCoupons").size).toBe(0);
    expect(sentEmails.find((e) => e.kind === "loyalty_verification")!.html).not.toContain("data-welcome-line");
    expect(sentEmails.find((e) => e.kind === "loyalty_welcome")!.html).not.toContain("data-coupon");
  });
});

// ── Members who joined before Club 2 ──────────────────────────────────
describe("members who joined before codes existed", () => {
  it("get a code on their first visit to the club page (30 days from then, no email)", async () => {
    const session = oldMember("old1", "old@example.com");
    cookieJar.set("mkh_club", session.split("=")[1]!);
    const res = await me({} as never);
    const body = (await res.json()) as { coupons: Array<{ code: string; state: string; percent: number }>; member: { cardToken: string } };
    expect(body.coupons).toHaveLength(1);
    expect(body.coupons[0]).toMatchObject({ state: "active", percent: 10 });
    expect(sentEmails).toHaveLength(0);
    // Signed card link for the QR.
    expect(readMemberCard(body.member.cardToken)).toBe("old1");
    // The header marker is set with the session.
    expect(cookieJar.get("mkh_club_in")).toBe("1");
  });

  it("…but not if they already have a completed order since joining", async () => {
    const session = oldMember("old2", "old2@example.com");
    fake.put("orders", "o-paid", { loyalty: { memberId: "old2" }, status: "completed", paymentStatus: "paid" });
    cookieJar.set("mkh_club", session.split("=")[1]!);
    const body = (await (await me({} as never)).json()) as { coupons: unknown[] };
    expect(body.coupons).toHaveLength(0);
    expect(fake.get("loyaltyMembers", "old2")!.welcomeCouponSkippedAt).toBeTruthy();
    expect(fake.col("loyaltyCoupons").size).toBe(0);
  });

  it("an order linked only through points (older orders) also counts as a purchase", async () => {
    oldMember("old3", "old3@example.com");
    fake.put("loyaltyPointsLedger", "earn:o9", { memberId: "old3", kind: "earn", points: 0, orderId: "o9", source: "order", createdAt: iso(NOW.getTime()) });
    expect(await coupons.ensureWelcomeCoupon(fake.db as never, "old3", { now: NOW, requireNoPurchase: true })).toBeNull();
  });
});

// ── Using the code on an order ────────────────────────────────────────
const PRODUCTS = new Map<string, CatalogProduct | undefined>([["latte", { price: 20, nameHe: "לאטה", available: true }]]);
function orderRequest(patch: Partial<CreateOrderRequest> = {}): CreateOrderRequest {
  return {
    items: [{ productId: "latte", quantity: 3 }],
    customer: { name: "דנה", phone: "050-1234567" },
    locale: "he",
    payment: "counter",
    fulfillment: { type: "pickup" },
    couponCode: "MK-AAAA-BBBB",
    ...patch,
  };
}
function orderDeps(memberId: string | null, now = NOW) {
  return {
    now: () => now,
    loadProducts: async (ids: string[]) => new Map(ids.map((id) => [id, PRODUCTS.get(id)])),
    loadContext: async () => ({ fulfillment: DEFAULT_FULFILLMENT, openingHours: DEFAULT_OPENING_HOURS }),
    rateLimit: async () => true,
    saveOrder: async () => {
      throw new Error("a personal code must go through saveOrderWithCoupon");
    },
    findClubMember: async () => (memberId ? { id: memberId, email: null, status: "active" } : null),
    checkClubCoupon: async (code: string, m: { id: string; status?: string }) => {
      const r = await coupons.checkCouponForMember(fake.db as never, { code, member: { id: m.id, status: "active" }, now });
      return r.ok ? { ok: true as const, percent: r.percent, heldBy: r.heldBy } : r;
    },
    saveOrderWithCoupon: async (draft: Record<string, unknown>, coupon: { code: string; memberId: string; heldBy: string | null }) =>
      coupons.saveOrderWithCoupon(fake.db as never, {
        order: { ...draft, createdAt: { toMillis: () => now.getTime() } },
        coupon,
        now,
      }),
  };
}

describe("the code on a site order", () => {
  it("10% off for its owner, marked used in the same save as the order", async () => {
    oldMember("m1", "m1@example.com");
    welcomeCoupon("m1");
    const res = await handleCreateOrder(orderRequest(), "", orderDeps("m1") as never);
    expect(res.status).toBe(200);
    const id = (res.body as { id: string }).id;
    expect(fake.get("orders", id)).toMatchObject({ subtotal: 60, discount: 6, total: 54, couponCode: "MK-AAAA-BBBB" });
    expect(fake.get("loyaltyCoupons", "MK-AAAA-BBBB")).toMatchObject({ status: "redeemed", orderId: id, channel: "web" });
    // The card charge counts it only for this very order.
    expect(await coupons.personalCouponRateForOrder(fake.db as never, id, "MK-AAAA-BBBB")).toBe(0.1);
    expect(await coupons.personalCouponRateForOrder(fake.db as never, "other-order", "MK-AAAA-BBBB")).toBe(0);
  });

  it("cannot serve two orders", async () => {
    oldMember("m1", "m1@example.com");
    welcomeCoupon("m1");
    expect((await handleCreateOrder(orderRequest(), "", orderDeps("m1") as never)).status).toBe(200);
    expect(await handleCreateOrder(orderRequest(), "", orderDeps("m1") as never)).toEqual({
      status: 409,
      body: { ok: false, code: "COUPON_INVALID", reason: "used" },
    });
    expect(fake.col("orders").size).toBe(1);
  });

  it("taken between the check and the save (double click): refused, nothing saved", async () => {
    oldMember("m1", "m1@example.com");
    welcomeCoupon("m1");
    const deps = orderDeps("m1");
    const check = deps.checkClubCoupon;
    // The other order takes the code right after this order's check.
    deps.checkClubCoupon = async (code, m) => {
      const r = await check(code, m);
      fake.put("loyaltyCoupons", "MK-AAAA-BBBB", { ...fake.get("loyaltyCoupons", "MK-AAAA-BBBB")!, status: "redeemed", orderId: "other" });
      return r;
    };
    fake.put("orders", "other", { status: "pending", paymentStatus: "pending", paymentCollection: "counter" });
    const res = await handleCreateOrder(orderRequest(), "", deps as never);
    expect(res).toEqual({ status: 409, body: { ok: false, code: "COUPON_INVALID", reason: "used" } });
    expect(fake.col("orders").size).toBe(1); // only "other"
  });

  it("only its owner, and only logged in to the club", async () => {
    oldMember("m1", "m1@example.com");
    oldMember("m2", "m2@example.com");
    welcomeCoupon("m1");
    expect((await handleCreateOrder(orderRequest(), "", orderDeps(null) as never)).body).toMatchObject({ reason: "login_required" });
    expect((await handleCreateOrder(orderRequest(), "", orderDeps("m2") as never)).body).toMatchObject({ reason: "invalid" });
  });

  it("expired after 30 days, or once the member has a completed order", async () => {
    oldMember("m1", "m1@example.com");
    welcomeCoupon("m1", { expiresAt: iso(NOW.getTime() - 1) });
    expect((await handleCreateOrder(orderRequest(), "", orderDeps("m1") as never)).body).toMatchObject({ reason: "expired" });
    welcomeCoupon("m1");
    fake.put("orders", "paid-1", { loyalty: { memberId: "m1" }, status: "ready", paymentStatus: "paid" });
    expect((await handleCreateOrder(orderRequest(), "", orderDeps("m1") as never)).body).toMatchObject({ reason: "expired" });
    const views = await coupons.memberCouponViews(fake.db as never, "m1", NOW);
    expect(views[0]!.state).toBe("expired");
  });

  it("an abandoned card payment frees the code after 30 minutes", async () => {
    oldMember("m1", "m1@example.com");
    welcomeCoupon("m1");
    const first = await handleCreateOrder(orderRequest({ payment: "online" }), "", orderDeps("m1") as never);
    const firstId = (first.body as { id: string }).id;
    fake.put("orders", firstId, { ...fake.get("orders", firstId)!, paymentCollection: "online", paymentStatus: "pending" });
    // 10 minutes later: still held.
    const soon = new Date(NOW.getTime() + 10 * 60_000);
    expect((await handleCreateOrder(orderRequest(), "", orderDeps("m1", soon) as never)).body).toMatchObject({ reason: "used" });
    // 31 minutes later: free again, now used by the new order.
    const later = new Date(NOW.getTime() + 31 * 60_000);
    const second = await handleCreateOrder(orderRequest(), "", orderDeps("m1", later) as never);
    expect(second.status).toBe(200);
    expect(fake.get("loyaltyCoupons", "MK-AAAA-BBBB")!.orderId).toBe((second.body as { id: string }).id);
    // The old card order would no longer get the discount.
    expect(await coupons.personalCouponRateForOrder(fake.db as never, firstId, "MK-AAAA-BBBB")).toBe(0);
  });

  it("the cart check route: login needed; another member's code is just invalid", async () => {
    oldMember("m1", "m1@example.com");
    const other = oldMember("m2", "m2@example.com");
    welcomeCoupon("m1");
    expect((await post(checkCouponRoute, { code: "MK-AAAA-BBBB" })).body).toEqual({ ok: false, reason: "login_required" });
    expect((await post(checkCouponRoute, { code: "MK-AAAA-BBBB" }, other)).body).toEqual({ ok: false, reason: "invalid" });
    const owner = `mkh_club=${signClubSession({ emailHash: hashEmail("m1@example.com") }).value}`;
    expect((await post(checkCouponRoute, { code: "mk-aaaa-bbbb" }, owner)).body).toEqual({ ok: true, code: "MK-AAAA-BBBB", percent: 10 });
    const list = await listCoupons({ cookies: { get: () => ({ value: owner.split("=")[1] }) } } as never);
    expect(((await list.json()) as { coupons: unknown[] }).coupons).toHaveLength(1);
  });
});

// ── Cancellation ──────────────────────────────────────────────────────
describe("cancelled by the manager", () => {
  async function orderWithCode() {
    oldMember("m1", "m1@example.com");
    welcomeCoupon("m1", { expiresAt: iso(Date.now() + DAY) });
    const deps = orderDeps("m1", new Date());
    const res = await handleCreateOrder(orderRequest(), "", deps as never);
    return (res.body as { id: string }).id;
  }

  it("the code goes back to the member, valid at least 3 more days; the order no longer counts", async () => {
    const id = await orderWithCode();
    fake.put("orders", id, { ...fake.get("orders", id)!, status: "cancelled", paymentStatus: "paid" });
    await notifyOrderCancelled(id);
    const coupon = fake.get("loyaltyCoupons", "MK-AAAA-BBBB")!;
    expect(coupon).toMatchObject({ status: "active", orderId: null });
    expect(Date.parse(coupon.expiresAt as string)).toBeGreaterThanOrEqual(Date.now() + 3 * DAY - 5_000);
    const views = await coupons.memberCouponViews(fake.db as never, "m1", new Date());
    expect(views[0]!.state).toBe("active");
    // Twice is harmless.
    await notifyOrderCancelled(id);
    expect(fake.get("loyaltyCoupons", "MK-AAAA-BBBB")!.status).toBe("active");
  });

  it("security: the public hook does nothing for an order that is not cancelled", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await orderWithCode();
    fake.put("loyaltyPointsLedger", `earn:${id}`, { memberId: "m1", kind: "earn", points: 3, orderId: id, qualifyingAmountMinor: 5400, source: "order", createdAt: iso(NOW.getTime()) });
    const result = await notifyOrderCancelled(id);
    expect(result).toEqual({ status: "skipped", reason: "not_cancelled" });
    expect(fake.get("loyaltyCoupons", "MK-AAAA-BBBB")!.status).toBe("redeemed");
    expect(fake.get("loyaltyPointsLedger", `refund:${id}`)).toBeUndefined();
    expect(cancelledEmails).toHaveLength(0);
  });
});

// ── Card link, header, logout ─────────────────────────────────────────
describe("member QR = signed link; header button", () => {
  it("only the server can make a valid card link", () => {
    const token = signMemberCard("member-123");
    expect(readMemberCard(token)).toBe("member-123");
    expect(readMemberCard(`https://mishkatcafe.dev/club/card?c=${encodeURIComponent(token)}`)).toBe("member-123");
    expect(readMemberCard(token.replace("member-123", "member-124"))).toBeNull();
    expect(readMemberCard(`${token.slice(0, -1)}x`)).toBeNull();
    expect(readMemberCard("MISHKAH:MEMBER:M-1")).toBeNull();
    expect(readMemberCard("")).toBeNull();
  });

  it("the card page never uses the link's id: it only sends a logged-in visitor to their own card", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/club/card/page.tsx"), "utf8");
    expect(page).not.toMatch(/useSearchParams|searchParams|get\("c"\)/);
    expect(page).toMatch(/fetch\("\/api\/club\/me"\)/);
    expect(page).toMatch(/router\.replace\("\/club\/me"\)/);
    const mePage = readFileSync(resolve(process.cwd(), "src/app/club/me/page.tsx"), "utf8");
    expect(mePage).toMatch(/\/club\/card\?c=\$\{encodeURIComponent\(member\.cardToken\)\}/);
    expect(mePage).not.toMatch(/MISHKAH:MEMBER/);
  });

  it("header: 'My card' → /club/me for a logged-in member, 'Join the club' otherwise", () => {
    expect(hasClubHint("a=1; mkh_club_in=1; b=2")).toBe(true);
    expect(hasClubHint("mkh_club_in=")).toBe(false);
    expect(hasClubHint("")).toBe(false);
    const header = readFileSync(resolve(process.cwd(), "src/components/layout/header.tsx"), "utf8");
    expect(header).toMatch(/href=\{clubMember \? "\/club\/me" : "\/club"\}/);
    expect(header).toMatch(/t\(clubMember \? "nav\.myCard" : "nav\.joinClub"\)/);
    const seed = readFileSync(resolve(process.cwd(), "src/data/ui-translations-seed.ts"), "utf8");
    expect([...seed.matchAll(/"nav\.myCard": "([^"]+)"/g)].map((m) => m[1])).toEqual(["הכרטיס שלי", "بطاقتي", "My card"]);
  });

  it("logging out clears the marker", async () => {
    cookieJar.set("mkh_club", "x");
    cookieJar.set("mkh_club_in", "1");
    await logout();
    expect(cookieJar.has("mkh_club_in")).toBe(false);
    expect(cookieJar.has("mkh_club")).toBe(false);
  });
});

describe("WELCOME15 removed; settings", () => {
  it("WELCOME15 gives nothing; MISHKAT10 stays", async () => {
    const { couponRate } = await import("@/lib/orders/coupons");
    expect(couponRate("WELCOME15")).toBe(0);
    expect(couponRate("MISHKAT10")).toBe(0.1);
  });

  it("the welcome code switch is on by default and kept when saved", async () => {
    const { parseLoyaltySettings } = await import("@/lib/loyalty/settings");
    expect(parseLoyaltySettings({}).welcomeCouponEnabled).toBe(true);
    expect(parseLoyaltySettings({ welcomeCouponEnabled: false }).welcomeCouponEnabled).toBe(false);
  });
});
