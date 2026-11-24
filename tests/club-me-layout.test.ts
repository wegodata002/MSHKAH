// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFakeFirestore } from "./helpers/fake-firestore";
import { signClubSession } from "@/lib/loyalty/session";
import { hashEmail } from "@/lib/loyalty/tokens";

/** Member page: compact layout wiring, "Order" button, small sign-out, live updates (light route). */

const fake = createFakeFirestore();
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fake.db }));
const { GET: live } = await import("@/app/api/club/me/live/route");

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const page = read("src/app/club/me/page.tsx");

function request(cookie?: string) {
  return { cookies: { get: (n: string) => (cookie && n === "mkh_club" ? { name: n, value: cookie } : undefined) } } as never;
}

describe("live check route", () => {
  it("answers only points, cups, spend toward the next point and status, for the logged-in member", async () => {
    fake.put("loyaltyMembers", "m1", {
      id: "m1",
      memberNumber: "M-1",
      email: "dana@example.com",
      emailHash: hashEmail("dana@example.com"),
      displayName: "דנה",
      status: "active",
      balancePoints: 4,
      pointsCarryMinor: 6000,
      coffeeCups: 3,
    });
    const res = await live(request(signClubSession({ emailHash: hashEmail("dana@example.com") }).value));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, balancePoints: 4, coffeeCups: 3, pointsCarryMinor: 6000, status: "active" });
  });

  it("not logged in → ok: false (nothing about anyone)", async () => {
    expect(await (await live(request())).json()).toEqual({ ok: false });
    expect(await (await live(request("forged.value"))).json()).toEqual({ ok: false });
  });
});

describe("member page", () => {
  it("live updates: every 10 s only while visible, right away when coming back; full reload only on a change", () => {
    expect(page).toMatch(/const CLUB_LIVE_INTERVAL_MS = 10_000;/);
    expect(page).toMatch(/document\.visibilityState !== "visible"\) return;/);
    expect(page).toMatch(/document\.addEventListener\("visibilitychange", onVisible\)/);
    expect(page).toMatch(/fetch\("\/api\/club\/me\/live", \{ cache: "no-store" \}\)/);
    expect(page).toMatch(/if \(!changed\) return;/);
    // Stops when the page is left.
    expect(page).toMatch(/clearInterval\(interval\)/);
  });

  it("two self-balancing columns on desktop (no gaps), one column on phones", () => {
    expect(page).toMatch(/columns-1 gap-4 lg:columns-2 \[&>\*\]:mb-3 \[&>\*\]:break-inside-avoid/);
    expect(page).not.toMatch(/row-span|row-start/);
  });

  it('"Order" → /catalog right under the points; no "back to shop"; sign-out is a small link at the end', () => {
    expect(page).toMatch(/href="\/catalog"[\s\S]{0,300}data-club-order/);
    expect(page).not.toMatch(/club\.me\.backToStore/);
    const order = page.indexOf("data-club-order");
    const hero = page.indexOf("<ClubHero");
    const signOut = page.indexOf("data-club-signout");
    const lastCard = page.lastIndexOf("</ClubCard>");
    expect(hero).toBeLessThan(order);
    expect(signOut).toBeGreaterThan(lastCard);
    const admin = read("src/data/admin-translations.ts");
    expect([...admin.matchAll(/"club4\.me\.order": "([^"]+)"/g)].map((m) => m[1])).toEqual(["להזמנה", "اطلبوا الآن", "Order now"]);
  });

  it("compact sizes: QR 96px, smaller hero and cards (other club pages keep the regular size)", () => {
    expect(page).toMatch(/className="h-24 w-24 shrink-0 rounded-md" data-club-qr/);
    expect(page).toMatch(/<ClubHero badge=\{t\("club\.join\.hero\.badge"\)\} compact>/);
    const ui = read("src/features/club/club-ui.tsx");
    expect(ui).toMatch(/compact = false/);
  });
});
