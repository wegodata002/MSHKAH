// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFakeFirestore } from "./helpers/fake-firestore";
import { isoDate, joinedStatus, memberRowsAndCounts } from "@/lib/loyalty/admin/member-list";
import { matchCustomersToMembers } from "@/lib/loyalty/admin/customer-links";
import { ADMIN_TRANSLATIONS } from "@/data/admin-translations";

const fake = createFakeFirestore();
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fake.db }));
const links = await import("@/lib/loyalty/admin/customer-links");
const list = await import("@/lib/loyalty/admin/member-list");
const db = fake.db as unknown as Parameters<typeof links.customerMemberLinks>[0];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const NOW = new Date("2026-11-26T10:00:00Z");

describe("Club → Members: every member who finished joining is listed", () => {
  it("dates: ISO text, Firestore Timestamp, {seconds}, Date, milliseconds; anything else is null", () => {
    const iso = "2026-11-03T08:00:00.000Z";
    const ms = Date.parse(iso);
    expect(isoDate(iso)).toBe(iso);
    expect(isoDate({ toDate: () => new Date(ms) })).toBe(iso);
    expect(isoDate({ seconds: ms / 1000, nanoseconds: 0 })).toBe(iso);
    expect(isoDate({ _seconds: ms / 1000 })).toBe(iso);
    expect(isoDate(new Date(ms))).toBe(iso);
    expect(isoDate(ms)).toBe(iso);
    expect(isoDate("not a date")).toBeNull();
    expect(isoDate({})).toBeNull();
    expect(isoDate(undefined)).toBeNull();
  });

  it("status is read loosely; the activation date means joined; unfinished sign-ups stay out", () => {
    expect(joinedStatus({ status: "Active" })).toBe("active");
    expect(joinedStatus({ status: " suspended " })).toBe("suspended");
    expect(joinedStatus({ status: "member", activatedAt: "2026-11-01T08:00:00Z" })).toBe("active");
    expect(joinedStatus({ activatedAt: { seconds: 1_790_000_000 } })).toBe("active");
    expect(joinedStatus({ status: "email_verified" })).toBeNull();
    expect(joinedStatus({ status: "awaiting_payment", activatedAt: "2026-11-01T08:00:00Z" })).toBeNull();
    expect(joinedStatus({})).toBeNull();
  });

  it("odd records (Timestamp dates, 'Active', no name, 0 orders) are listed and never break the list", () => {
    const { members, counts } = memberRowsAndCounts(
      [
        { id: "A", displayName: "דנה", email: "d@x.com", status: "active", activatedAt: { toDate: () => new Date("2026-11-03T08:00:00Z") } },
        { id: "B", email: " s@x.com ", status: "Active", createdAt: { seconds: Date.parse("2026-10-01T08:00:00Z") / 1000 } },
        { id: "C", status: "active", activatedAt: "garbage", balancePoints: "x" },
        { id: "D", status: "email_verified" },
        { id: "E", status: "awaiting_payment" },
      ],
      NOW
    );
    expect(members.map((m) => m.id)).toEqual(["A", "B", "C"]);
    expect(members.find((m) => m.id === "A")!.joinedAt).toBe("2026-11-03T08:00:00.000Z");
    expect(members.find((m) => m.id === "B")).toMatchObject({ email: "s@x.com", status: "active", name: "" });
    expect(members.find((m) => m.id === "C")).toMatchObject({ joinedAt: null, balancePoints: 0 });
    expect(counts).toEqual({ total: 3, joinedThisMonth: 1, incomplete: 2 });
  });

  it("server: a member stored with Timestamp dates and no orders is listed", async () => {
    fake.reset();
    fake.put("loyaltyMembers", "MemberTs01", { displayName: "רנא", email: "r@x.com", status: "active", activatedAt: { seconds: Date.parse("2026-11-20T08:00:00Z") / 1000, nanoseconds: 0 } });
    const { members, counts } = await list.listClubMembers(db, NOW);
    expect(members.map((m) => m.id)).toEqual(["MemberTs01"]);
    expect(counts).toEqual({ total: 1, joinedThisMonth: 1, incomplete: 0 });
  });
});

describe("Customers → 'club member' badge", () => {
  const members = [
    { id: "MemOrder01", status: "active", email: "o@x.com" },
    { id: "MemLinked1", status: "active", linkedCustomerId: "CustLinked" },
    { id: "MemEmail01", status: "suspended", email: "Dana@Mail.com" },
    { id: "MemPhone01", status: "active", phone: "+972 50-123-4567" },
    { id: "MemShare01", status: "active", phone: "052-0000000" },
    { id: "MemShare02", status: "active", phone: "0520000000" },
    { id: "MemNotDone", status: "email_verified", email: "nd@x.com", phone: "0539999999" },
  ];
  const customers = [
    { id: "CustOrder1", email: "dana@mail.com", phone: "0501234567" }, // order link wins over email/phone
    { id: "CustLinked" },
    { id: "CustEmail1", email: " dana@mail.com " },
    { id: "CustPhone1", phone: "050-1234567" },
    { id: "CustShared", phoneKey: "0520000000" },
    { id: "CustNotDon", email: "nd@x.com", phone: "0539999999" },
    { id: "CustNobody", email: "z@x.com", phone: "0541111111" },
  ];
  const orders = [{ customerId: "CustOrder1", memberId: "MemOrder01" }, { customerId: "CustNobody", memberId: "MemNotDone" }];

  it("order link, then linked customer, then email, then a phone only one member has", () => {
    expect(matchCustomersToMembers(members, customers, orders)).toEqual({
      CustOrder1: { memberId: "MemOrder01", status: "active" },
      CustLinked: { memberId: "MemLinked1", status: "active" },
      CustEmail1: { memberId: "MemEmail01", status: "suspended" },
      CustPhone1: { memberId: "MemPhone01", status: "active" },
    });
  });

  it("server: reads members, customers and the members' orders", async () => {
    fake.reset();
    fake.put("loyaltyMembers", "MemberA001", { status: "active", email: "a@x.com" });
    fake.put("customers", "CustomerA1", { name: "א", phone: "0501111111", phoneKey: "0501111111" });
    fake.put("orders", "Order001", { customerId: "CustomerA1", loyalty: { memberId: "MemberA001" }, status: "delivered", items: [] });
    expect(await links.customerMemberLinks(db)).toEqual({ CustomerA1: { memberId: "MemberA001", status: "active" } });
  });

  it("the API is Admin only and sends ids and status only", () => {
    const route = read("src/app/api/admin/club/members/route.ts");
    expect(route).toContain("requireAdminOnly");
    expect(route).toContain('"customer-links"');
  });
});

describe("Coupons page: notes removed", () => {
  const page = read("src/features/admin/coupons-admin.tsx");
  it("no subtitle, no club-codes line, no code hint; the MISHKAT10 delete warning stays", () => {
    for (const key of ["admin.coupons.subtitle", "admin.coupons.personalNote", "admin.coupons.personalLink", "admin.coupons.codeHint"]) {
      expect(page).not.toContain(key);
      for (const lang of ["he", "ar", "en"] as const) expect(ADMIN_TRANSLATIONS[lang][key]).toBeUndefined();
    }
    expect(page).toContain("admin.coupons.deleteBuiltin");
  });
});

describe("Customers page wiring", () => {
  it("the badge comes from the server match (Admin only) and links to Club → Members with the member open", () => {
    const page = read("src/features/admin/customers-admin.tsx");
    expect(page).toContain("useCustomerMemberLinks()");
    expect(page).toContain("data-customer-members-retry");
    expect(page).not.toContain("useClubMembers");
    expect(page).toContain('`${adminPath("club")}?tab=members&member=${encodeURIComponent(memberId)}`');
    const hook = read("src/hooks/useCustomerMemberLinks.ts");
    expect(hook).toContain("canManageUsers(user.role)");
    expect(hook).toContain('{ action: "customer-links" }');
  });

  it("new texts exist in Hebrew, Arabic and English", () => {
    for (const key of ["admin.customers.memberDetails", "admin.customers.clubDenied", "admin.customers.clubError", "admin.clubMembers.error", "admin.clubMembers.adminOnly", "admin.waiterQr.print", "admin.waiterQr.printTitle", "admin.waiterQr.printNote", "admin.waiterQr.loadError"]) {
      for (const lang of ["he", "ar", "en"] as const) expect(ADMIN_TRANSLATIONS[lang][key], `${lang} ${key}`).toBeTruthy();
    }
  });
});
