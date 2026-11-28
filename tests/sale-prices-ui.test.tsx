import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/providers/locale-provider", async () => {
  const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
  const { UI_TRANSLATIONS_SEED } = await import("@/data/ui-translations-seed");
  const t = (key: string, fallback?: string) => ADMIN_TRANSLATIONS.he[key] ?? UI_TRANSLATIONS_SEED.he[key] ?? fallback ?? key;
  return { useT: () => t, useLocale: () => ({ locale: "he", dir: "rtl" }) };
});
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => ({ firebaseUser: { uid: "admin" }, loading: false, user: { role: "Admin" } }) }));
vi.mock("@/features/admin/components/admin-page-header", () => ({ AdminPageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <header><h1>{title}</h1>{actions}</header> }));
const PRODUCTS = [
  { id: "latte", name_he: "לאטה", name_ar: "لاتيه", name_en: "Latte", price: 18, available: true, active: true },
  { id: "tea", name_he: "תה", name_ar: "شاي", name_en: "Tea", price: 12, available: true, active: true },
];
vi.mock("@/hooks/useProducts", () => ({ useAllProducts: () => ({ products: PRODUCTS, loading: false }) }));
const fetchMock = vi.fn();
vi.mock("@/lib/auth/client-admin-fetch", async (orig) => ({ ...(await orig<object>()), clientAdminFetch: (...a: unknown[]) => fetchMock(...a) }));

const { SalePrice, SaleBadge } = await import("@/features/sales/sale-price-view");
const { SalesAdmin } = await import("@/features/admin/sales-admin");
const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
const he = (k: string) => ADMIN_TRANSLATIONS.he[k]!;

const S = "2026-11-24T08:00:00.000Z";
const E = "2026-11-30T21:59:00.000Z";
const onSale = { price: 18, sales: [{ saleId: "SaleWeek01", kind: "percent", value: 20, startsAt: S, endsAt: E }] };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T10:00:00Z"));
  fetchMock.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("sale price on the storefront", () => {
  it("on sale: new price, the regular one struck through, the tag and 'until'", () => {
    const { container } = render(<><SalePrice product={onSale} until /><SaleBadge product={onSale} /></>);
    expect(container.querySelector("[data-price-now]")!.textContent).toContain("14.40");
    expect(container.querySelector("s[data-price-regular]")!.textContent).toContain("18");
    expect(container.querySelector("[data-sale-until]")!.textContent).toBe("עד 30.11");
    expect(container.querySelector("[data-sale-badge]")!.textContent).toContain("−20%");
  });

  it("no sale (or after it ended): the regular price only, no tag", () => {
    vi.setSystemTime(new Date("2026-12-01T10:00:00Z"));
    const { container } = render(<><SalePrice product={onSale} until /><SaleBadge product={onSale} /></>);
    expect(container.querySelector("[data-price]")!.textContent).toContain("18");
    expect(container.querySelector("[data-sale-price]")).toBeNull();
    expect(container.querySelector("[data-sale-badge]")).toBeNull();
  });

  it("a new price shows 'Sale' in the tag; ₪ off shows the amount", () => {
    const price = { price: 14, sales: [{ saleId: "SaleBake01", kind: "price", value: 10, startsAt: S, endsAt: E }] };
    const amount = { price: 14, sales: [{ saleId: "SaleBake02", kind: "amount", value: 5, startsAt: S, endsAt: E }] };
    const { container } = render(<><SaleBadge product={price} /><SaleBadge product={amount} /></>);
    const tags = [...container.querySelectorAll("[data-sale-badge]")].map((n) => n.textContent);
    expect(tags[0]).toBe("מבצע");
    expect(tags[1]).toContain("−");
    expect(tags[1]).toContain("5");
  });
});

describe("Admin → Sales (rendered)", () => {
  const list = [
    { id: "SaleWeek01", name: { he: "שבוע הקפה", ar: "", en: "" }, kind: "percent", value: 20, startsAt: S, endsAt: E, productIds: ["latte"], createdAt: "", updatedAt: "", status: "active" },
    { id: "SaleOld001", name: { he: "סוף קיץ", ar: "", en: "" }, kind: "amount", value: 3, startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-09-15T00:00:00.000Z", productIds: ["tea"], createdAt: "", updatedAt: "", status: "ended" },
  ];
  const okList = () => fetchMock.mockImplementation(async (_u: string, body: { action: string }) => (body.action === "list" ? { ok: true, status: 200, data: { sales: list } } : { ok: true, status: 200, data: { ok: true } }));

  it("list with status and filters; End now only on an active sale; Edit not on an ended one", async () => {
    okList();
    const { container } = render(<SalesAdmin />);
    await waitFor(() => expect(container.querySelectorAll("[data-sale]")).toHaveLength(2));
    const active = container.querySelector('[data-sale="SaleWeek01"]')!;
    const ended = container.querySelector('[data-sale="SaleOld001"]')!;
    expect(active.querySelector("[data-sale-end]")).toBeTruthy();
    expect(ended.querySelector("[data-sale-end]")).toBeNull();
    expect(ended.querySelector("[data-sale-edit]")).toBeNull();
    expect(active.textContent).toContain("לאטה");
    fireEvent.click(container.querySelector('[data-sales-filter="ended"]')!);
    expect(container.querySelectorAll("[data-sale]")).toHaveLength(1);
  });

  it("new sale: pick products, preview old → new (flags one that would not go down), save sends Israel time as UTC", async () => {
    okList();
    const { container } = render(<SalesAdmin />);
    await waitFor(() => expect(container.querySelectorAll("[data-sale]")).toHaveLength(2));
    fireEvent.click(container.querySelector("[data-sale-add]")!);
    await waitFor(() => expect(document.querySelector("[data-sale-form]")).toBeTruthy());
    const form = document.querySelector("[data-sale-form]")!;
    fireEvent.change(form.querySelector('[data-sale-name="he"]')!, { target: { value: "מבצע חורף" } });
    fireEvent.click(form.querySelector('[data-sale-kind="price"]')!);
    fireEvent.change(form.querySelector("[data-sale-value]")!, { target: { value: "15" } });
    for (const q of ["לאט", "תה"]) {
      fireEvent.change(form.querySelector("[data-sale-search]")!, { target: { value: q } });
      fireEvent.click(document.querySelector("[data-sale-pick]")!);
    }
    expect(document.querySelector('[data-sale-row="latte"]')!.getAttribute("data-lower")).toBe("yes");
    expect(document.querySelector('[data-sale-row="latte"]')!.textContent).toContain("15");
    expect(document.querySelector('[data-sale-row="tea"]')!.getAttribute("data-lower")).toBe("no");
    expect(document.querySelector('[data-sale-row="tea"]')!.textContent).toContain(he("admin.sales.notLower"));
    fireEvent.change(form.querySelector("[data-sale-starts]")!, { target: { value: "2026-12-01T00:00" } });
    fireEvent.change(form.querySelector("[data-sale-ends]")!, { target: { value: "2026-12-07T23:59" } });
    fireEvent.click(document.querySelector("[data-sale-save]")!);
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1].action === "create")).toBe(true));
    const sent = fetchMock.mock.calls.find((c) => c[1].action === "create")![1].sale;
    expect(sent).toEqual({ name: { he: "מבצע חורף", ar: "", en: "" }, kind: "price", value: 15, startsAt: "2026-11-30T22:00:00.000Z", endsAt: "2026-12-07T21:59:00.000Z", productIds: ["latte", "tea"], freeDelivery: false, freeDeliveryMin: 0 });
  });

  it("a refusal from the server is shown in words (overlap names the sale and the products)", async () => {
    fetchMock.mockImplementation(async (_u: string, body: { action: string }) =>
      body.action === "list"
        ? { ok: true, status: 200, data: { sales: list } }
        : { ok: false, status: 409, data: { ok: false, error: { code: "OVERLAP", saleName: "שבוע הקפה", products: ["לאטה"] } } }
    );
    const { container } = render(<SalesAdmin />);
    await waitFor(() => expect(container.querySelectorAll("[data-sale]")).toHaveLength(2));
    fireEvent.click(container.querySelector('[data-sale="SaleWeek01"] [data-sale-edit]')!);
    fireEvent.click(document.querySelector("[data-sale-save]")!);
    await waitFor(() => expect(document.querySelector("[data-sale-form-error]")).toBeTruthy());
    expect(document.querySelector("[data-sale-form-error]")!.textContent).toBe(he("admin.sales.error.OVERLAP").replace("{sale}", "שבוע הקפה").replace("{products}", "לאטה"));
  });

  it("End now asks first, then calls the server and reloads", async () => {
    okList();
    const { container } = render(<SalesAdmin />);
    await waitFor(() => expect(container.querySelectorAll("[data-sale]")).toHaveLength(2));
    fireEvent.click(container.querySelector('[data-sale="SaleWeek01"] [data-sale-end]')!);
    expect(fetchMock.mock.calls.some((c) => c[1].action === "end")).toBe(false);
    expect(screen.getByText(he("admin.sales.endQuestion"))).toBeTruthy();
    fireEvent.click(document.querySelector("[data-sale-confirm-yes]")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/sales", { action: "end", id: "SaleWeek01" }));
    await waitFor(() => expect(container.querySelector("[data-sales-notice]")!.textContent).toContain(he("admin.sales.ended")));
  });

  it("403 → admin only (no retry); a server error → 'couldn't load' with Try again", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, code: "PERMISSION_DENIED" });
    const first = render(<SalesAdmin />);
    await waitFor(() => expect(first.container.querySelector('[data-sales-error="denied"]')).toBeTruthy());
    expect(first.container.querySelector("[data-sales-retry]")).toBeNull();
    first.unmount();
    fetchMock.mockResolvedValue({ ok: false, status: 503, code: "UNAVAILABLE" });
    const { container } = render(<SalesAdmin />);
    await waitFor(() => expect(container.querySelector('[data-sales-error="failed"]')).toBeTruthy());
    expect(container.querySelector("[data-sales-retry]")).toBeTruthy();
  });
});
