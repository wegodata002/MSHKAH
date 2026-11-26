import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/providers/locale-provider", async () => {
  const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
  const t = (key: string, fallback?: string) => ADMIN_TRANSLATIONS.he[key] ?? fallback ?? key;
  return { useT: () => t, useLocale: () => ({ locale: "he", dir: "rtl" }) };
});
vi.mock("@/features/admin/components/admin-page-header", () => ({ AdminPageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock("@/hooks/useAdminPath", () => ({ useAdminPath: () => (segment: string) => `/admin/${segment}` }));
vi.mock("next/link", () => ({ default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: () => void }) => <a href={href} onClick={onClick} {...rest}>{children}</a> }));
const fetchMock = vi.fn();
vi.mock("@/lib/auth/client-admin-fetch", () => ({ clientAdminFetch: (...args: unknown[]) => fetchMock(...args) }));

const { ClubMembersTab, CLUB_MEMBERS_VIEW_KEY } = await import("@/features/admin/club-members");
const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
const he = (key: string) => ADMIN_TRANSLATIONS.he[key]!;

const member = (i: number, over: Record<string, unknown> = {}) => ({
  id: `Member${String(i).padStart(4, "0")}`,
  memberNumber: `M-${i}`,
  name: `חבר ${i}`,
  email: `m${i}@x.com`,
  status: "active",
  joinedAt: new Date(Date.UTC(2026, 10, 26) - i * 86400000).toISOString(),
  balancePoints: i % 7,
  coffeeCups: i % 5,
  ...over,
});
const MEMBERS = [
  member(0, { name: "דנה כהן", email: "dana@mail.com", balancePoints: 42 }),
  member(1, { name: "רנא", email: "rana@mail.com", status: "suspended", balancePoints: 15 }),
  ...Array.from({ length: 38 }, (_, i) => member(i + 2)),
];

beforeEach(() => {
  window.sessionStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, body?: { action?: string; memberIds?: string[]; memberId?: string }) => {
    if (url.endsWith("/suspend") || url.endsWith("/resume")) return { ok: true, status: 200, data: { ok: true } };
    if (body?.action === "list") return { ok: true, status: 200, data: { members: MEMBERS, counts: { total: 40, joinedThisMonth: 19, incomplete: 3 } } };
    if (body?.action === "stats") return { ok: true, status: 200, data: { stats: Object.fromEntries((body.memberIds ?? []).map((id) => [id, { orders: 17, total: 1284, welcome: "used" }])) } };
    if (body?.action === "detail")
      return {
        ok: true,
        status: 200,
        data: {
          orders: [{ id: "Order0001", orderNumber: "MC-2026-1042", createdAt: "2026-11-26T08:00:00Z", orderType: "delivery", total: 62, status: "delivered", paymentStatus: "paid", counted: true }],
          history: [{ id: "earn:Order0001", memberId: body.memberId, kind: "earn", points: 1, source: "order", createdAt: "2026-11-26T09:00:00Z" }],
          coupons: [{ code: "MK-AAAA-BBBB", kind: "welcome", percent: 10, firstPurchaseOnly: true, expiresAt: "2026-12-03T08:00:00Z", state: "used" }],
        },
      };
    return { ok: false, status: 400 };
  });
});
afterEach(cleanup);

const rows = () => [...document.querySelectorAll("[data-members-table] [data-member]")].map((r) => r.getAttribute("data-member"));

describe("Admin → Club → Members (rendered)", () => {
  it("counters, 30 at a time with 'show more', stats only for the rows on screen", async () => {
    render(<ClubMembersTab tabs={null} />);
    await waitFor(() => expect(rows()).toHaveLength(30));
    expect(document.querySelector("[data-count-total]")!.textContent).toBe("40");
    expect(document.querySelector("[data-count-month]")!.textContent).toBe("+19");
    expect(document.querySelector("[data-count-incomplete]")!.textContent).toContain("3");
    await waitFor(() => expect(document.querySelector('[data-members-table] [data-member="Member0000"] [data-member-orders]')!.textContent).toBe("17"));
    const statsCalls = () => fetchMock.mock.calls.filter((c) => (c[1] as { action?: string })?.action === "stats");
    expect((statsCalls()[0]![1] as { memberIds: string[] }).memberIds).toHaveLength(30);
    fireEvent.click(document.querySelector("[data-members-more]")!);
    await waitFor(() => expect(rows()).toHaveLength(40));
    await waitFor(() => expect(statsCalls()).toHaveLength(2));
    expect((statsCalls()[1]![1] as { memberIds: string[] }).memberIds).toHaveLength(10);
    expect(document.querySelector("[data-members-more]")).toBeNull();
  });

  it("search by name or email, filter by status, sort by points", async () => {
    render(<ClubMembersTab tabs={null} />);
    await waitFor(() => expect(rows()).toHaveLength(30));
    fireEvent.change(document.querySelector("[data-members-search]")!, { target: { value: "DANA@" } });
    expect(rows()).toEqual(["Member0000"]);
    fireEvent.change(document.querySelector("[data-members-search]")!, { target: { value: "רנא" } });
    expect(rows()).toEqual(["Member0001"]);
    fireEvent.change(document.querySelector("[data-members-search]")!, { target: { value: "" } });
    fireEvent.click(document.querySelector('[data-members-filter="suspended"]')!);
    expect(rows()).toEqual(["Member0001"]);
    fireEvent.click(document.querySelector('[data-members-filter="all"]')!);
    fireEvent.change(document.querySelector("[data-members-sort]")!, { target: { value: "points" } });
    expect(rows().slice(0, 2)).toEqual(["Member0000", "Member0001"]);
  });

  it("details: orders link in the same tab, points and coupons; suspend asks first", async () => {
    render(<ClubMembersTab tabs={null} />);
    await waitFor(() => expect(rows()).toHaveLength(30));
    fireEvent.click(document.querySelector('[data-members-table] [data-member="Member0000"]')!);
    await waitFor(() => expect(document.querySelector('[data-member-order="MC-2026-1042"]')).toBeTruthy());
    const link = document.querySelector('[data-member-order="MC-2026-1042"]') as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/admin/orders?order=Order0001&from=club");
    expect(link.getAttribute("target")).toBeNull();
    fireEvent.click(link);
    expect(JSON.parse(window.sessionStorage.getItem(CLUB_MEMBERS_VIEW_KEY)!)).toMatchObject({ selectedId: "Member0000" });
    fireEvent.click(document.querySelector('[data-member-section="points"]')!);
    expect(document.querySelector("[data-member-points-list]")!.textContent).toContain("+1");
    fireEvent.click(document.querySelector('[data-member-section="coupons"]')!);
    expect(document.querySelector("[data-member-coupons-list]")!.textContent).toContain("MK-AAAA-BBBB");

    fireEvent.click(document.querySelector('[data-member-action="suspend"]')!);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/suspend"))).toBe(false);
    expect(document.querySelector("[data-member-confirm]")!.textContent).toContain(he("admin.clubMembers.suspendText"));
    fireEvent.click(document.querySelector("[data-member-confirm-yes]")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/club/suspend", { memberId: "Member0000" }));
    await waitFor(() => expect(document.querySelector('[data-members-table] [data-member="Member0000"] [data-member-status]')!.getAttribute("data-member-status")).toBe("suspended"));
    expect(document.querySelector('[data-member-action="resume"]')).toBeTruthy();
  });

  it("back from an order: search, filter, how many shown and the open member are restored", async () => {
    window.sessionStorage.setItem(CLUB_MEMBERS_VIEW_KEY, JSON.stringify({ query: "", filter: "all", sort: "newest", shown: 60, selectedId: "Member0001", scrollY: 0 }));
    render(<ClubMembersTab tabs={null} />);
    await waitFor(() => expect(rows()).toHaveLength(40));
    await waitFor(() => expect(document.querySelector('[data-member-detail="Member0001"]')).toBeTruthy());
    expect(screen.getAllByText("רנא").length).toBeGreaterThan(0);
  });
});
