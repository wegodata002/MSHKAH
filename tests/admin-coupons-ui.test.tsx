import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/providers/locale-provider", async () => {
  const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
  const t = (key: string, fallback?: string) => ADMIN_TRANSLATIONS.he[key] ?? fallback ?? key;
  return { useT: () => t, useLocale: () => ({ locale: "he", dir: "rtl" }) };
});
vi.mock("@/features/admin/components/admin-page-header", () => ({
  AdminPageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));
const fetchMock = vi.fn();
vi.mock("@/lib/auth/client-admin-fetch", async (orig) => ({ ...(await orig<object>()), clientAdminFetch: (...args: unknown[]) => fetchMock(...args) }));

const { CouponsAdmin } = await import("@/features/admin/coupons-admin");
const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
const he = (key: string) => ADMIN_TRANSLATIONS.he[key]!;

const LIST = [
  { code: "MISHKAT10", name: { he: "10% הנחה", ar: "", en: "" }, type: "percent", value: 10, expiresOn: null, audience: "all", minOrder: 0, limit: "unlimited", active: true, builtin: true, uses: 37 },
  { code: "CLUB20", name: { he: "מועדון ₪20", ar: "", en: "" }, type: "fixed", value: 20, expiresOn: "2099-12-30", audience: "members", minOrder: 80, limit: "once", active: true, uses: 5 },
  { code: "WINTER25", name: { he: "חורף", ar: "", en: "" }, type: "percent", value: 25, expiresOn: "2020-02-28", audience: "all", minOrder: 0, limit: "unlimited", active: true, uses: 12 },
  { code: "TEST5", name: { he: "בדיקה", ar: "", en: "" }, type: "fixed", value: 5, expiresOn: null, audience: "all", minOrder: 0, limit: "unlimited", active: false, uses: 0 },
];

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, body?: { action: string }) =>
    body?.action === "list" ? { ok: true, status: 200, data: { coupons: LIST } } : { ok: true, status: 200, data: { coupon: {} } }
  );
});
afterEach(cleanup);

const rows = () => [...document.querySelectorAll("[data-coupon-table] [data-coupon]")].map((r) => r.getAttribute("data-coupon"));

describe("Admin → Coupons (rendered)", () => {
  it("list with status and uses; filter by status; search by code", async () => {
    render(<CouponsAdmin />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    const status = (code: string) => document.querySelector(`[data-coupon-table] [data-coupon="${code}"] [data-coupon-status]`)!.getAttribute("data-coupon-status");
    expect([status("MISHKAT10"), status("CLUB20"), status("WINTER25"), status("TEST5")]).toEqual(["active", "active", "expired", "disabled"]);
    expect(document.querySelector('[data-coupon-table] [data-coupon="MISHKAT10"] [data-coupon-uses]')!.textContent).toBe("37");
    fireEvent.click(document.querySelector('[data-coupon-filter="expired"]')!);
    expect(rows()).toEqual(["WINTER25"]);
    fireEvent.click(document.querySelector('[data-coupon-filter="all"]')!);
    fireEvent.change(document.querySelector("[data-coupon-search]")!, { target: { value: "club" } });
    expect(rows()).toEqual(["CLUB20"]);
  });

  it("create: sends what was entered", async () => {
    render(<CouponsAdmin />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    fireEvent.click(document.querySelector("[data-coupon-add]")!);
    fireEvent.change(document.querySelector("#coupon-code")!, { target: { value: "summer-15" } });
    fireEvent.change(document.querySelector('[data-coupon-name="he"]')!, { target: { value: "קיץ" } });
    fireEvent.click(document.querySelector('[data-coupon-option="fixed"]')!);
    fireEvent.change(document.querySelector("[data-coupon-value]")!, { target: { value: "15" } });
    fireEvent.click(document.querySelector('[data-coupon-option="members"]')!);
    fireEvent.click(document.querySelector('[data-coupon-option="once"]')!);
    fireEvent.change(document.querySelector("#coupon-min")!, { target: { value: "60" } });
    fireEvent.click(document.querySelector("[data-coupon-save]")!);
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => (c[1] as { action?: string })?.action === "create")).toBe(true));
    const body = fetchMock.mock.calls.find((c) => (c[1] as { action?: string })?.action === "create")![1] as { coupon: Record<string, unknown> };
    expect(body.coupon).toMatchObject({ code: "SUMMER15", type: "fixed", value: 15, audience: "members", limit: "once", minOrder: 60, active: true });
    expect((body.coupon.name as { he: string }).he).toBe("קיץ");
  });

  it("switch off, and deleting MISHKAT10 warns it will not come back", async () => {
    render(<CouponsAdmin />);
    await waitFor(() => expect(rows()).toHaveLength(4));
    fireEvent.click(document.querySelector('[data-coupon-table] [data-coupon="MISHKAT10"] [data-coupon-toggle]')!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/coupons", { action: "toggle", code: "MISHKAT10", active: false }));
    fireEvent.click(document.querySelector('[data-coupon-table] [data-coupon="MISHKAT10"] [data-coupon-delete]')!);
    expect(document.querySelector("[data-coupon-delete-dialog]")!.textContent).toContain(he("admin.coupons.deleteBuiltin"));
    fireEvent.click(screen.getByText(he("admin.coupons.cancel")));
    expect(fetchMock.mock.calls.some((c) => (c[1] as { action?: string })?.action === "delete")).toBe(false);
  });
});
