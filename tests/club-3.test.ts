// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join as pathJoin, resolve } from "node:path";
import { createFakeFirestore } from "./helpers/fake-firestore";
import { hashEmail } from "@/lib/loyalty/tokens";
import { canUndoCoffeeEntry, coffeeCardView, maskEmail } from "@/lib/loyalty/coffee";

/**
 * Club 3: join once per email, the coffee card at the counter (cups, free cup, 10% used, undo),
 * the staff scan lookup. Real routes / server functions over a strict in-memory Firestore.
 */

const fake = createFakeFirestore();
const sentEmails: Array<{ text: string; html: string; kind: string }> = [];
const cookieJar = new Map<string, string>();

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
  sendMishkahEmail: async (input: { text: string; html: string; kind: string }) => {
    sentEmails.push(input);
    return { ok: true };
  },
}));

const { POST: start } = await import("@/app/api/club/enroll/start/route");
const { POST: verify } = await import("@/app/api/club/enroll/verify/route");
const { upsertVerifiedMember } = await import("@/lib/loyalty/admin/members");
const coffee = await import("@/lib/loyalty/admin/coffee");
const { checkCouponForMember } = await import("@/lib/loyalty/admin/coupons");
const { signMemberCard } = await import("@/lib/loyalty/card-link");

const NOW = new Date("2026-11-24T10:00:00.000Z");
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);
const NOA = { uid: "u-noa", name: "נועה", role: "Employee" };
const RAMI = { uid: "u-rami", name: "רמי", role: "Employee" };
const BOSS = { uid: "u-boss", name: "דנה", role: "Manager" };
let seq = 0;
const rid = () => `req-${String(++seq).padStart(8, "0")}`;

type Json = Record<string, unknown> & { ok?: boolean; reason?: string };
const post = async (handler: (req: never) => Promise<Response>, body: unknown) => {
  const req = { json: async () => body, headers: new Headers({ "x-forwarded-for": "10.0.0.7" }) };
  const res = await handler(req as never);
  return { status: res.status, body: (await res.json()) as Json };
};
const codeFromLastEmail = () => sentEmails.filter((m) => m.kind === "loyalty_verification").at(-1)!.text.match(/\b(\d{6})\b/)![1]!;
const members = () => [...fake.col("loyaltyMembers").values()];
const flush = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

async function join(email: string, name: string) {
  await post(start, { email, mode: "join" });
  const res = await post(verify, { email, code: codeFromLastEmail(), displayName: name, mode: "join" });
  await flush();
  return res;
}

function member(id: string, patch: Record<string, unknown> = {}) {
  fake.put("loyaltyMembers", id, {
    id,
    memberNumber: `M-1234-${id.toUpperCase()}`,
    email: `${id}@gmail.com`,
    emailHash: hashEmail(`${id}@gmail.com`),
    displayName: "דנה כהן",
    status: "active",
    balancePoints: 7,
    joinFeePaidMinor: 0,
    consentTerms: true,
    consentMarketing: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...patch,
  });
}

function welcomeCoupon(memberId: string) {
  fake.put("loyaltyCoupons", "MK-AAAA-BBBB", {
    id: "MK-AAAA-BBBB",
    code: "MK-AAAA-BBBB",
    memberId,
    kind: "welcome",
    percent: 10,
    status: "active",
    firstPurchaseOnly: true,
    expiresAt: new Date(NOW.getTime() + 20 * 86400000).toISOString(),
    createdAt: NOW.toISOString(),
    createdBy: "system",
  });
}

const cups = (id: string) => fake.get("loyaltyMembers", id)!.coffeeCups;

beforeEach(() => {
  fake.reset();
  sentEmails.length = 0;
  cookieJar.clear();
  fake.put("loyaltySettings", "app", { enrollmentEnabled: true, earnEnabled: true, welcomeCouponEnabled: true, coffeeCardEnabled: true });
});

// ── Join once per email ───────────────────────────────────────────────
describe("joining only once per email", () => {
  it("join tab + an email already in the club: no code sent, 'already_member'", async () => {
    await join("dana@example.com", "דנה");
    sentEmails.length = 0;
    const res = await post(start, { email: "Dana@Example.com", mode: "join" });
    expect(res.body).toEqual({ ok: false, reason: "already_member" });
    expect(sentEmails).toHaveLength(0);
    // The login tab still sends a code.
    expect((await post(start, { email: "dana@example.com", mode: "login" })).body.ok).toBe(true);
    expect(sentEmails).toHaveLength(1);
  });

  it("verify with a join request for a member: refused, name unchanged, the code is not used up", async () => {
    await join("dana@example.com", "דנה");
    await post(start, { email: "dana@example.com", mode: "login" });
    const code = codeFromLastEmail();
    const refused = await post(verify, { email: "dana@example.com", code, displayName: "שם אחר", mode: "join" });
    expect(refused.body).toEqual({ ok: false, reason: "already_member" });
    expect(members()[0]!.displayName).toBe("דנה");
    // The same code still logs in.
    expect((await post(verify, { email: "dana@example.com", code, mode: "login" })).body.ok).toBe(true);
  });

  it("no second member and no second 10% code", async () => {
    await join("dana@example.com", "דנה");
    await post(start, { email: "dana@example.com", mode: "join" });
    await post(start, { email: "dana@example.com", mode: "login" });
    await post(verify, { email: "dana@example.com", code: codeFromLastEmail(), mode: "login" });
    expect(members()).toHaveLength(1);
    expect(fake.col("loyaltyCoupons").size).toBe(1);
    expect(fake.get("loyaltyEmailIndex", hashEmail("dana@example.com"))!.memberId).toBe(members()[0]!.id);
  });

  it("two verifications at once: the one that loses finds the email taken and gets the same member", async () => {
    // The other request already claimed the email (its member is not visible to the lookup yet).
    fake.put("loyaltyMembers", "first", { id: "first", memberNumber: "M-1", email: "x", emailHash: "not-yet-indexed", status: "email_verified" });
    fake.put("loyaltyEmailIndex", hashEmail("race@example.com"), { memberId: "first" });
    const got = await upsertVerifiedMember(fake.db as never, { email: "race@example.com", displayName: "ב" });
    expect(got.id).toBe("first");
    expect(members()).toHaveLength(1);
  });

  it("someone who started the old flow and never finished can still join", async () => {
    fake.put("loyaltyMembers", "old", { id: "old", memberNumber: "M-OLD", email: "old@example.com", emailHash: hashEmail("old@example.com"), status: "email_verified", balancePoints: 0, joinFeePaidMinor: 0, consentTerms: false, consentMarketing: false, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    const res = await join("old@example.com", "ותיק");
    expect(res.body.ok).toBe(true);
    expect(members()).toHaveLength(1);
    expect(fake.get("loyaltyMembers", "old")!.status).toBe("active");
  });
});

// ── Coffee card ───────────────────────────────────────────────────────
describe("coffee card at the counter", () => {
  it("staff add cups (several at once); extra cups carry over after the free cup", async () => {
    member("m1");
    expect(await coffee.addCoffeeCups(fake.db as never, { memberId: "m1", count: 4, requestId: rid(), actor: NOA, now: NOW })).toEqual({ ok: true });
    expect(await coffee.redeemCoffeeGift(fake.db as never, { memberId: "m1", requestId: rid(), actor: NOA, now: at(120) })).toEqual({ ok: false, reason: "not_enough" });
    expect((await coffee.addCoffeeCups(fake.db as never, { memberId: "m1", count: 3, requestId: rid(), actor: NOA, now: at(120) })).ok).toBe(true);
    expect(cups("m1")).toBe(7);
    expect(coffeeCardView(7)).toEqual({ filled: 5, giftReady: true, toGift: 0 });
    expect(await coffee.redeemCoffeeGift(fake.db as never, { memberId: "m1", requestId: rid(), actor: NOA, now: at(130) })).toEqual({ ok: true });
    expect(cups("m1")).toBe(2);
    expect(fake.get("loyaltyMembers", "m1")!.coffeeRewardsRedeemed).toBe(1);
  });

  it("double scan: within 60 s asks first; a retried request is applied once", async () => {
    member("m1");
    const id = rid();
    await coffee.addCoffeeCups(fake.db as never, { memberId: "m1", count: 1, requestId: id, actor: NOA, now: NOW });
    // Network retry of the same click.
    expect(await coffee.addCoffeeCups(fake.db as never, { memberId: "m1", count: 1, requestId: id, actor: NOA, now: at(1) })).toEqual({ ok: true, duplicate: true });
    expect(cups("m1")).toBe(1);
    // A second scan 20 s later.
    expect(await coffee.addCoffeeCups(fake.db as never, { memberId: "m1", count: 1, requestId: rid(), actor: RAMI, now: at(20) })).toEqual({ ok: false, reason: "recent", secondsAgo: 20 });
    expect(cups("m1")).toBe(1);
    expect((await coffee.addCoffeeCups(fake.db as never, { memberId: "m1", count: 1, requestId: rid(), actor: RAMI, now: at(21), confirm: true })).ok).toBe(true);
    expect(cups("m1")).toBe(2);
    // After a minute no question.
    expect((await coffee.addCoffeeCups(fake.db as never, { memberId: "m1", count: 1, requestId: rid(), actor: RAMI, now: at(90) })).ok).toBe(true);
  });

  it("limits: 1–5 cups at once; suspended members; switched off", async () => {
    member("m1");
    member("m2", { status: "suspended" });
    for (const count of [0, 6, Number.NaN]) {
      expect((await coffee.addCoffeeCups(fake.db as never, { memberId: "m1", count, requestId: rid(), actor: NOA, now: NOW })).ok).toBe(false);
    }
    expect(await coffee.addCoffeeCups(fake.db as never, { memberId: "m2", count: 1, requestId: rid(), actor: NOA, now: NOW })).toEqual({ ok: false, reason: "inactive" });
    fake.put("loyaltySettings", "app", { coffeeCardEnabled: false });
    expect(await coffee.addCoffeeCups(fake.db as never, { memberId: "m1", count: 1, requestId: rid(), actor: NOA, now: NOW })).toEqual({ ok: false, reason: "disabled" });
  });

  it("undo last action: whoever did it or a manager, within 10 minutes, only the latest", async () => {
    member("m1");
    await coffee.addCoffeeCups(fake.db as never, { memberId: "m1", count: 2, requestId: "req-first-001", actor: NOA, now: NOW });
    await coffee.addCoffeeCups(fake.db as never, { memberId: "m1", count: 3, requestId: "req-second-01", actor: NOA, now: at(100) });
    // Not the latest.
    expect(await coffee.undoCoffeeEntry(fake.db as never, { memberId: "m1", entryId: "req-first-001", actor: NOA, now: at(110) })).toEqual({ ok: false, reason: "cannot_undo" });
    // Another employee.
    expect(await coffee.undoCoffeeEntry(fake.db as never, { memberId: "m1", entryId: "req-second-01", actor: RAMI, now: at(110) })).toEqual({ ok: false, reason: "cannot_undo" });
    // A manager can.
    expect(await coffee.undoCoffeeEntry(fake.db as never, { memberId: "m1", entryId: "req-second-01", actor: BOSS, now: at(110) })).toEqual({ ok: true });
    expect(cups("m1")).toBe(2);
    // Now the first one is the latest open action, but more than 10 minutes old.
    expect(await coffee.undoCoffeeEntry(fake.db as never, { memberId: "m1", entryId: "req-first-001", actor: NOA, now: at(11 * 60) })).toEqual({ ok: false, reason: "cannot_undo" });
    // Its own author within 10 minutes can.
    expect(await coffee.undoCoffeeEntry(fake.db as never, { memberId: "m1", entryId: "req-first-001", actor: NOA, now: at(9 * 60) })).toEqual({ ok: true });
    expect(cups("m1")).toBe(0);
  });

  it("undoing a free cup gives the 5 cups back", async () => {
    member("m1", { coffeeCups: 6 });
    await coffee.redeemCoffeeGift(fake.db as never, { memberId: "m1", requestId: "req-gift-0001", actor: NOA, now: NOW });
    expect(cups("m1")).toBe(1);
    await coffee.undoCoffeeEntry(fake.db as never, { memberId: "m1", entryId: "req-gift-0001", actor: NOA, now: at(30) });
    expect(cups("m1")).toBe(6);
    expect(fake.get("loyaltyMembers", "m1")!.coffeeRewardsRedeemed).toBe(0);
  });
});

// ── 10% at the counter ───────────────────────────────────────────────
describe("the 10% welcome code used at the counter", () => {
  it("marked used by the staff member; then it no longer works on the site; undo gives it back", async () => {
    member("m1");
    welcomeCoupon("m1");
    expect(await coffee.redeemCouponAtCounter(fake.db as never, { memberId: "m1", code: "MK-AAAA-BBBB", requestId: "req-coupon-01", actor: NOA, now: NOW })).toEqual({ ok: true });
    expect(fake.get("loyaltyCoupons", "MK-AAAA-BBBB")).toMatchObject({ status: "redeemed", channel: "pos", orderId: null, redeemedBy: "u-noa" });
    // A counter use is never "released" like an abandoned card payment.
    expect(await checkCouponForMember(fake.db as never, { code: "MK-AAAA-BBBB", member: { id: "m1", status: "active" }, now: at(3600) })).toEqual({ ok: false, reason: "used" });
    const summary = await coffee.scanSummary(fake.db as never, "m1", NOA, at(60));
    expect(summary!.coupons).toHaveLength(0);
    // Used twice → refused.
    expect(await coffee.redeemCouponAtCounter(fake.db as never, { memberId: "m1", code: "MK-AAAA-BBBB", requestId: rid(), actor: NOA, now: at(70) })).toEqual({ ok: false, reason: "used" });
    // Undo (mistake).
    expect(await coffee.undoCoffeeEntry(fake.db as never, { memberId: "m1", entryId: "req-coupon-01", actor: NOA, now: at(80) })).toEqual({ ok: true });
    expect(fake.get("loyaltyCoupons", "MK-AAAA-BBBB")!.status).toBe("active");
  });

  it("another member's code is refused", async () => {
    member("m1");
    member("m2");
    welcomeCoupon("m1");
    expect(await coffee.redeemCouponAtCounter(fake.db as never, { memberId: "m2", code: "MK-AAAA-BBBB", requestId: rid(), actor: NOA, now: NOW })).toEqual({ ok: false, reason: "invalid" });
  });
});

// ── Scan lookup ──────────────────────────────────────────────────────
describe("staff scan screen", () => {
  it("finds the member by the scanned card link or the typed number; a forged link finds nobody", async () => {
    member("m1");
    const link = `https://mishkatcafe.dev/club/card?c=${encodeURIComponent(signMemberCard("m1"))}`;
    expect((await coffee.findMemberForScan(fake.db as never, { qr: link }))?.id).toBe("m1");
    expect((await coffee.findMemberForScan(fake.db as never, { memberNumber: " m-1234-m1 " }))?.id).toBe("m1");
    expect(await coffee.findMemberForScan(fake.db as never, { qr: link.replace("m1.", "m2.") })).toBeNull();
    expect(await coffee.findMemberForScan(fake.db as never, { qr: "MISHKAH:MEMBER:M-1234-M1" })).toBeNull();
  });

  it("shows only name, member number and a masked email; history says who and when", async () => {
    member("m1");
    welcomeCoupon("m1");
    await coffee.addCoffeeCups(fake.db as never, { memberId: "m1", count: 2, requestId: "req-hist-0001", actor: NOA, now: NOW });
    const summary = (await coffee.scanSummary(fake.db as never, "m1", NOA, at(30)))!;
    expect(summary.member).toEqual({ id: "m1", name: "דנה כהן", memberNumber: "M-1234-M1", maskedEmail: "m***@gmail.com", status: "active" });
    expect(JSON.stringify(summary)).not.toMatch(/m1@gmail\.com|balancePoints/);
    expect(summary.coffee).toMatchObject({ enabled: true, cups: 2, filled: 2, giftReady: false, toGift: 3 });
    expect(summary.coupons.map((c) => c.code)).toEqual(["MK-AAAA-BBBB"]);
    expect(summary.history[0]).toMatchObject({ kind: "cups", cups: 2, actorName: "נועה", actorRole: "Employee", canUndo: true });
    // Another employee sees it without the undo button.
    expect((await coffee.scanSummary(fake.db as never, "m1", RAMI, at(30)))!.history[0]!.canUndo).toBe(false);
  });

  it("masked email / undo rules (pure)", () => {
    expect(maskEmail("dana.cohen@gmail.com")).toBe("d***@gmail.com");
    expect(maskEmail("")).toBe("");
    const entry = { actorUid: "a", createdAt: NOW.toISOString() };
    expect(canUndoCoffeeEntry(entry, { uid: "a", role: "Employee" }, at(599), true)).toBe(true);
    expect(canUndoCoffeeEntry(entry, { uid: "a", role: "Employee" }, at(601), true)).toBe(false);
    expect(canUndoCoffeeEntry(entry, { uid: "b", role: "Admin" }, at(60), true)).toBe(true);
    expect(canUndoCoffeeEntry(entry, { uid: "a", role: "Employee" }, at(60), false)).toBe(false);
  });
});

// ── Wiring ───────────────────────────────────────────────────────────
describe("wiring", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
  const filesUnder = (dir: string): string[] =>
    readdirSync(resolve(process.cwd(), dir)).flatMap((name) => {
      const path = pathJoin(dir, name);
      return statSync(resolve(process.cwd(), path)).isDirectory() ? filesUnder(path) : [path];
    });

  it("cups are added only through the staff routes (the customer's club routes never write them)", () => {
    for (const path of ["src/app/api/admin/club/scan/route.ts", "src/app/api/admin/club/coffee/route.ts"]) {
      expect(read(path), path).toMatch(/const auth = await requireStaff\(request\);\s*if \(auth instanceof Response\) return auth;/);
    }
    for (const path of filesUnder("src/app/api/club")) {
      // (/api/club/me only reads the count for display.)
      expect(read(path), path).not.toMatch(/admin\/coffee|addCoffeeCups|redeemCoffeeGift|undoCoffeeEntry|loyaltyCoffeeLedger/);
    }
  });

  it("scan screen in the menu for every staff role; camera: built-in reader first, jsQR elsewhere", () => {
    expect(read("src/features/admin/admin-nav-config.ts")).toMatch(/\{ segment: "club-scan", labelKey: "club3\.scan\.title", icon: ScanLine \}/);
    const camera = read("src/features/admin/club-scan/qr-camera.tsx");
    expect(camera).toMatch(/const detector = await nativeDetector\(\);\s*const jsQR = detector \? null : \(await import\("jsqr"\)\)\.default;/);
    expect(camera).toMatch(/playsInline/);
  });

  it("the join page shows '6 = 🎁' only while the coffee card is on", () => {
    expect(read("src/app/club/page.tsx")).toMatch(/settings\?\.coffeeCardEnabled \? \(\s*<ClubPerk title="6 = 🎁"/);
    expect(read("src/app/club/me/page.tsx")).toMatch(/settings\?\.coffeeCardEnabled \? <ClubCoffeeCard cups=\{member\.coffeeCups \?\? 0\} \/> : null/);
  });

  it("the coffee card switch is on by default", async () => {
    const { parseLoyaltySettings } = await import("@/lib/loyalty/settings");
    expect(parseLoyaltySettings({}).coffeeCardEnabled).toBe(true);
    expect(parseLoyaltySettings({ coffeeCardEnabled: false }).coffeeCardEnabled).toBe(false);
  });
});
