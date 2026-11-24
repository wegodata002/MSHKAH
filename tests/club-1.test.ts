import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canApplyAction, nextStatusFor } from "@/lib/loyalty/state";
import { parseLoyaltySettings } from "@/lib/loyalty/settings";
import { DEFAULT_LOYALTY_SETTINGS } from "@/lib/loyalty/types";
import { renderClubWelcomeEmail } from "@/lib/email/loyalty-templates";
import { getAdminQrLinks } from "@/lib/admin-qr-links";
import { formatIlsShort } from "@/features/club/club-ui";
import { earnWithCarry, spendToNextPoint } from "@/lib/loyalty/points-math";

/** Pure — no Firebase, no network. */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("free sign-up", () => {
  it("a verified email (or an unpaid old sign-up) becomes active with activate_free", () => {
    expect(nextStatusFor("email_verified", "activate_free")).toBe("active");
    expect(nextStatusFor("awaiting_payment", "activate_free")).toBe("active");
  });

  it("active and suspended members are not touched by it", () => {
    expect(canApplyAction("active", "activate_free")).toBe(false);
    expect(canApplyAction("suspended", "activate_free")).toBe(false);
  });

  it("the verify route activates for free, needs a name only to join, and sends the welcome email", () => {
    const route = read("src/app/api/club/enroll/verify/route.ts");
    expect(route).toMatch(/source: "free"/);
    expect(route).toMatch(/paidAmountMinor: 0/);
    expect(route).toMatch(/if \(!existing && !displayName\)/);
    expect(route).toMatch(/void sendClubWelcomeEmail\(db, member\.id\)/);
  });

  it("with sign-up closed, existing members can still log in (start + verify)", () => {
    expect(read("src/app/api/club/enroll/verify/route.ts")).toMatch(
      /!settings\.enrollmentEnabled && !\(await readMemberByEmail\(db, email\)\)/
    );
    const start = read("src/app/api/club/enroll/start/route.ts");
    expect(start).toMatch(/const existing = await readMemberByEmail\(db, email\);/);
    expect(start).toMatch(/!settings\.enrollmentEnabled && !existing/);
  });

  it("the verify page goes to the member page, not to a payment", () => {
    const page = read("src/app/club/verify/page.tsx");
    expect(page).not.toMatch(/enroll\/pay/);
    expect(page).toMatch(/\/club\/me\?welcome=1/);
  });
});

describe("points: every ₪X = 1 point", () => {
  it("default ₪100 per point", () => {
    expect(DEFAULT_LOYALTY_SETTINGS.spendPerPointMinor).toBe(10000);
    expect(parseLoyaltySettings({}).spendPerPointMinor).toBe(10000);
  });

  it("the manager's value is kept; out-of-range values fall back to ₪100", () => {
    expect(parseLoyaltySettings({ spendPerPointMinor: 5000 }).spendPerPointMinor).toBe(5000);
    expect(parseLoyaltySettings({ spendPerPointMinor: 50 }).spendPerPointMinor).toBe(10000);
    expect(parseLoyaltySettings({ spendPerPointMinor: 2_000_000 }).spendPerPointMinor).toBe(10000);
  });

  it("the old points-per-₪100 field is no longer read", () => {
    expect(parseLoyaltySettings({ earnPointsPer100: 10 } as Record<string, unknown>).spendPerPointMinor).toBe(10000);
  });

  it('"₪100" / "₪12.50" display', () => {
    expect(formatIlsShort(10000)).toBe("₪100");
    expect(formatIlsShort(1250)).toBe("₪12.50");
  });
});

describe("points on cash / courier orders once marked paid", () => {
  it("the admin calls the award route after marking a cash order paid", () => {
    expect(read("src/features/admin/orders-admin.tsx")).toMatch(/clientAdminFetch\("\/api\/admin\/club\/award-order", \{ orderId: order\.id \}\)/);
  });

  it("the route is staff-only and checks the order is really paid and not cancelled", () => {
    const route = read("src/app/api/admin/club/award-order/route.ts");
    expect(route).toMatch(/requireStaff\(request\)/);
    expect(route).toMatch(/order\.paymentStatus !== "paid" \|\| order\.status === "cancelled"/);
  });
});

describe("welcome email", () => {
  it("free sign-up: greets by name, every ₪100 = 1 point, no join fee line", () => {
    const mail = renderClubWelcomeEmail({
      memberNumber: "M-1234-ABCD",
      displayName: "דנה",
      spendPerPointIls: 100,
      joinFeeIls: 0,
      accountUrl: "https://example.com/club/me",
      showMarketingConsent: true,
    });
    expect(mail.html).toContain("ברוך הבא למועדון משכאת, דנה");
    expect(mail.html).toContain("נקודה על כל ₪100");
    expect(mail.html).not.toContain("דמי הצטרפות");
    expect(mail.text).toContain("צבירה: נקודה על כל ₪100");
  });

  it("an older paid sign-up still shows the paid fee", () => {
    const mail = renderClubWelcomeEmail({
      memberNumber: "M-1",
      spendPerPointIls: 100,
      joinFeeIls: 20,
      accountUrl: "https://example.com/club/me",
      showMarketingConsent: false,
    });
    expect(mail.html).toContain("דמי הצטרפות ששולמו: <strong>20.00 ₪</strong>");
  });
});

describe("join-the-club QR in the admin", () => {
  it("a third QR card that opens /club on the ordering site", () => {
    const club = getAdminQrLinks().find((l) => l.id === "club");
    expect(club?.url).toMatch(/^https:\/\/.+\/club$/);
    expect(club?.nameKey).toBe("admin.qr.clubName");
  });
});

describe("club session", () => {
  it("lasts about 6 months", () => {
    expect(read("src/lib/loyalty/session.ts")).toMatch(/60 \* 60 \* 24 \* 182/);
  });
});

describe("points remainder carried between orders", () => {
  const P100 = 10000;

  it("₪60 + ₪50 at ₪100 per point → 1 point, ₪10 carried on", () => {
    const first = earnWithCarry({ qualifyingAmountMinor: 6000, carryMinor: 0, spendPerPointMinor: P100 });
    expect(first).toEqual({ points: 0, carryMinor: 6000 });
    const second = earnWithCarry({ qualifyingAmountMinor: 5000, carryMinor: first.carryMinor, spendPerPointMinor: P100 });
    expect(second).toEqual({ points: 1, carryMinor: 1000 });
  });

  it("older members without a saved remainder start from 0", () => {
    expect(earnWithCarry({ qualifyingAmountMinor: 25000, carryMinor: undefined, spendPerPointMinor: P100 })).toEqual({ points: 2, carryMinor: 5000 });
  });

  it("after the manager lowers ₪ per point, a large remainder is converted on the next order", () => {
    // ₪90 saved at ₪100/point, then ₪30 per point: ₪90 + ₪10 = ₪100 → 3 points, ₪10 left.
    expect(earnWithCarry({ qualifyingAmountMinor: 1000, carryMinor: 9000, spendPerPointMinor: 3000 })).toEqual({ points: 3, carryMinor: 1000 });
  });

  it("the award transaction reads and saves the member's remainder", () => {
    const members = read("src/lib/loyalty/admin/members.ts");
    expect(members).toMatch(/carryMinor: member\.pointsCarryMinor/);
    expect(members).toMatch(/balancePoints: newBalance, pointsCarryMinor: carryMinor/);
    expect(members).toMatch(/tx\.set\(memberRef, \{ pointsCarryMinor: carryMinor, updatedAt: now \}, \{ merge: true \}\)/);
  });

  it('"₪X more to the next point"', () => {
    expect(spendToNextPoint(6000, P100)).toBe(4000);
    expect(spendToNextPoint(0, P100)).toBe(P100);
    expect(spendToNextPoint(undefined, P100)).toBe(P100);
  });
});

describe("shared QR (/club) for someone already in the club", () => {
  it("goes straight to /club/me (active or suspended) and shows no form until checked", () => {
    const page = read("src/app/club/page.tsx");
    expect(page).toMatch(/data\.member\?\.status === "active" \|\| data\.member\?\.status === "suspended"/);
    expect(page).toMatch(/router\.replace\("\/club\/me"\)/);
    expect(page).toMatch(/if \(!checked\) \{/);
  });
});
