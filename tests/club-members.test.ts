// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFakeFirestore } from "./helpers/fake-firestore";
import { israelMonth, memberRowsAndCounts, summarizeMemberOrders, welcomeState } from "@/lib/loyalty/admin/member-list";
import type { Order } from "@/types";

const fake = createFakeFirestore();
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fake.db }));
const list = await import("@/lib/loyalty/admin/member-list");
const db = fake.db as unknown as Parameters<typeof list.listClubMembers>[0];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const NOW = new Date("2026-11-26T10:00:00Z");

describe("member list rules", () => {
  it("only finished members are listed; unfinished sign-ups are counted; joined this month in Israel time", () => {
    const { members, counts } = memberRowsAndCounts(
      [
        { id: "A", displayName: "דנה", email: "d@x.com", status: "active", activatedAt: "2026-11-03T08:00:00Z", balancePoints: 42, coffeeCups: 8 },
        { id: "B", displayName: "סמיר", email: "s@x.com", status: "suspended", activatedAt: "2026-10-31T22:30:00Z", balancePoints: 0 }, // 01/11 in Israel
        { id: "C", email: "c@x.com", status: "email_verified", createdAt: "2026-11-20T08:00:00Z" },
        { id: "D", email: "e@x.com", status: "active", activatedAt: "2026-09-01T08:00:00Z", balancePoints: 5 },
      ],
      NOW
    );
    expect(members.map((m) => m.id)).toEqual(["A", "B", "D"]); // newest first
    expect(counts).toEqual({ total: 3, joinedThisMonth: 2, incomplete: 1 });
    expect(members[0]).toMatchObject({ name: "דנה", balancePoints: 42, coffeeCups: 8, status: "active" });
    expect(israelMonth(new Date("2026-10-31T22:30:00Z"))).toBe("2026-11");
  });

  it("orders and total leave out cancelled orders and card orders never paid", () => {
    const o = (status: string, extra: Partial<Order> = {}) => ({ status, total: 50, paymentMethod: "cash", paymentStatus: "pending", ...extra }) as unknown as Order;
    expect(summarizeMemberOrders([o("delivered"), o("cancelled"), o("pending", { paymentMethod: "card", paymentStatus: "pending" }), o("pending", { paymentMethod: "card", paymentStatus: "paid", total: 20.5 })])).toEqual({ orders: 2, total: 70.5 });
  });

  it("the 10% code: never received / its state", () => {
    expect(welcomeState(undefined, [])).toBe("none");
    expect(welcomeState("MK-AAAA-BBBB", [{ code: "MK-AAAA-BBBB", kind: "welcome", percent: 10, firstPurchaseOnly: true, expiresAt: "", state: "used" }])).toBe("used");
  });
});

describe("server (in-memory database)", () => {
  beforeEach(() => fake.reset());

  it("list, stats for the rows on screen, and one member's details", async () => {
    fake.put("loyaltyMembers", "MemberA001", { displayName: "דנה", email: "d@x.com", status: "active", activatedAt: "2026-11-03T08:00:00Z", balancePoints: 42, coffeeCups: 3, welcomeCouponCode: "MK-AAAA-BBBB", memberNumber: "M-1" });
    fake.put("loyaltyCoupons", "MK-AAAA-BBBB", { code: "MK-AAAA-BBBB", memberId: "MemberA001", kind: "welcome", percent: 10, firstPurchaseOnly: true, status: "active", issuedAt: "2026-11-03T08:00:00Z", expiresAt: "2026-12-03T08:00:00Z" });
    fake.put("orders", "Order001", { orderNumber: "MC-1", status: "delivered", total: 62, paymentMethod: "cash", paymentStatus: "paid", orderType: "delivery", createdAt: "2026-11-20T08:00:00Z", loyalty: { memberId: "MemberA001" }, items: [] });
    fake.put("orders", "Order002", { orderNumber: "MC-2", status: "cancelled", total: 30, paymentMethod: "cash", paymentStatus: "pending", orderType: "pickup", createdAt: "2026-11-21T08:00:00Z", loyalty: { memberId: "MemberA001" }, items: [] });
    fake.put("orders", "Order003", { orderNumber: "MC-3", status: "delivered", total: 99, paymentMethod: "cash", paymentStatus: "paid", orderType: "pickup", createdAt: "2026-11-21T08:00:00Z", loyalty: { memberId: "OtherMember" }, items: [] });
    fake.put("loyaltyPointsLedger", "earn:Order001", { memberId: "MemberA001", kind: "earn", points: 1, source: "order", orderId: "Order001", createdAt: "2026-11-20T09:00:00Z" });

    const { members, counts } = await list.listClubMembers(db, NOW);
    expect(members.map((m) => m.email)).toEqual(["d@x.com"]);
    expect(counts.total).toBe(1);

    const stats = await list.clubMemberStats(db, ["MemberA001"], NOW);
    // First-purchase code: a completed order without it ends it (the existing club rule).
    expect(stats.MemberA001).toEqual({ orders: 1, total: 62, welcome: "expired" });

    const detail = await list.clubMemberDetail(db, "MemberA001", NOW);
    expect(detail!.orders.map((o) => [o.orderNumber, o.counted])).toEqual([["MC-2", false], ["MC-1", true]]);
    expect(detail!.history.map((h) => h.points)).toEqual([1]);
    expect(detail!.coupons.map((c) => c.code)).toEqual(["MK-AAAA-BBBB"]);
    expect(await list.clubMemberDetail(db, "Nobody0001", NOW)).toBeNull();
  });
});

describe("wiring", () => {
  it("admin only, read only, through the server; suspend / resume reuse the admin-only routes", () => {
    const route = read("src/app/api/admin/club/members/route.ts");
    expect(route).toContain("requireAdminOnly(request)");
    expect(route).not.toMatch(/\.set\(|\.update\(|\.delete\(/);
    for (const p of ["src/app/api/admin/club/suspend/route.ts", "src/app/api/admin/club/resume/route.ts"]) expect(read(p)).toContain("requireAdminOnly(request)");
    expect(read("firestore.rules")).not.toContain("clubMembers");
  });

  it("an order opens in the same tab, shows that order, and 'Back' returns to the members tab", () => {
    const tab = read("src/features/admin/club-members.tsx");
    expect(tab).toContain('`${adminPath("orders")}?order=${encodeURIComponent(id)}&from=club`');
    expect(tab).not.toMatch(/target="_blank"/);
    expect(tab).toContain("CLUB_MEMBERS_VIEW_KEY");
    const orders = read("src/features/admin/orders-admin.tsx");
    expect(orders).toContain('params.get("from") === "club"');
    expect(orders).toContain('setDateFilter("all");');
    expect(orders).toContain("setExpanded(order.id);");
    expect(orders).toContain('`${adminPath("club")}?tab=members`');
    expect(read("src/features/admin/club-admin.tsx")).toContain('get("tab") === "members"');
  });
});
