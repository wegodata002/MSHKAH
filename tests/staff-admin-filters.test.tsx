import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffMemberView } from "@/lib/staff/types";

vi.mock("@/components/providers/locale-provider", async () => {
  const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
  // Stable, like the real one (a new function each render would reload the list every time).
  const t = (key: string, fallback?: string) => ADMIN_TRANSLATIONS.he[key] ?? fallback ?? key;
  return {
    useT: () => t,
    useLocale: () => ({ locale: "he", dir: "rtl" }),
  };
});

const m = (name: string, role: "courier" | "waiter", active: boolean, worksToday: boolean, phone: string): StaffMemberView => ({
  id: `Staff${name.length}${phone.slice(-4)}`,
  name,
  phone,
  role,
  active,
  worksToday,
  hasPin: role === "courier",
  pinSetAt: null,
});
const STAFF = [
  m("סמיר חדאד", "courier", true, true, "0521112233"),
  m("יוסף", "courier", true, false, "0501234567"),
  m("עלי", "courier", false, false, "0507654321"),
  m("רנא", "waiter", true, false, "0549998877"),
  m("סמאח", "waiter", false, false, "0531231234"),
];

const fetchMock = vi.fn();
vi.mock("@/lib/auth/client-admin-fetch", () => ({ clientAdminFetch: (...args: unknown[]) => fetchMock(...args) }));

const { StaffAdmin } = await import("@/features/admin/staff-admin");
const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
const he = (key: string) => ADMIN_TRANSLATIONS.he[key]!;

const shownNames = () => [...document.querySelectorAll("[data-staff-member]")].map((el) => el.getAttribute("data-staff-member"));
const oldWaiterNames = () => [...document.querySelectorAll("[data-staff-old-waiter]")].map((el) => el.getAttribute("data-staff-old-waiter"));

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (_url: string, body?: { action: string; id?: string }) => {
    if (body?.action === "list") return { ok: true, status: 200, data: { staff: STAFF } };
    if (body?.action === "devices") return { ok: true, status: 200, data: { devices: [] } };
    if (body?.action === "create") {
      const b = body as unknown as { name: string; phone: string };
      return { ok: true, status: 200, data: { member: { ...STAFF[1]!, id: "NewCourier0001", name: b.name, phone: b.phone } } };
    }
    if (body?.action === "delete") {
      return body.id === STAFF[0]!.id
        ? { ok: false, status: 409, code: "OPEN_DELIVERIES" }
        : { ok: true, status: 200, data: { ok: true } };
    }
    return { ok: true, status: 200, data: {} };
  });
});
afterEach(cleanup);

describe("Admin → Staff (rendered)", () => {
  it("couriers only in the list; status, works today, search by name and phone, clear", async () => {
    render(<StaffAdmin />);
    await waitFor(() => expect(shownNames()).toEqual(["סמיר חדאד", "יוסף", "עלי"]));
    const filters = document.querySelector("[data-staff-filters]") as HTMLElement;
    // No role choice any more (couriers only); "works today" always there.
    expect(document.querySelector("[data-staff-role]")).toBeNull();
    expect(within(filters).getByText(he("admin.staff.worksToday")).parentElement?.textContent).toContain("1");

    fireEvent.click(document.querySelector("[data-staff-works-today]")!);
    expect(shownNames()).toEqual(["סמיר חדאד"]);
    fireEvent.click(document.querySelector("[data-staff-works-today]")!);
    fireEvent.click(document.querySelector('[data-staff-status="disabled"]')!);
    expect(shownNames()).toEqual(["עלי"]);
    fireEvent.click(document.querySelector('[data-staff-status="all"]')!);

    const search = document.querySelector("[data-staff-search]") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "סמ" } });
    expect(shownNames()).toEqual(["סמיר חדאד"]);
    fireEvent.change(search, { target: { value: "050-123" } });
    expect(shownNames()).toEqual(["יוסף"]);
    fireEvent.change(search, { target: { value: "אין כזה" } });
    expect(shownNames()).toEqual([]);
    expect(screen.getByText("אין אנשי צוות שמתאימים לסינון.")).toBeTruthy();
    fireEvent.click(document.querySelector("[data-staff-clear-filters]")!);
    expect(shownNames()).toHaveLength(3);
    expect(search.value).toBe("");
  });

  it("old waiter records: a separate group with Delete, until deleted", async () => {
    render(<StaffAdmin />);
    await waitFor(() => expect(oldWaiterNames()).toEqual(["רנא", "סמאח"]));
    expect(document.querySelector("[data-staff-old-waiters]")!.textContent).toContain(he("admin.staff.oldWaiters"));
    fireEvent.click(document.querySelector('[data-staff-old-waiter="רנא"] [data-staff-delete]')!);
    expect(document.querySelector("[data-staff-delete-dialog]")!.textContent).toContain(he("admin.staff.deleteQuestion"));
    fireEvent.click(document.querySelector("[data-staff-delete-confirm]")!);
    await waitFor(() => expect(oldWaiterNames()).toEqual(["סמאח"]));
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/staff", { action: "delete", id: STAFF[3]!.id });
    expect(document.querySelector("[data-staff-notice]")!.textContent).toContain("רנא");
  });

  it("deleting a courier asks first; one with an open delivery today is refused with a clear message", async () => {
    render(<StaffAdmin />);
    await waitFor(() => expect(shownNames()).toHaveLength(3));
    // Cancel: nothing sent.
    fireEvent.click(document.querySelector('[data-staff-member="יוסף"] [data-staff-delete]')!);
    fireEvent.click(screen.getByText(he("admin.staff.cancel")));
    expect(fetchMock.mock.calls.some((c) => (c[1] as { action?: string })?.action === "delete")).toBe(false);

    fireEvent.click(document.querySelector('[data-staff-member="סמיר חדאד"] [data-staff-delete]')!);
    fireEvent.click(document.querySelector("[data-staff-delete-confirm]")!);
    await waitFor(() => expect(document.querySelector("[data-staff-delete-error]")!.textContent).toBe(he("admin.staff.deleteOpenDeliveries")));
    expect(shownNames()).toContain("סמיר חדאד");

    fireEvent.click(screen.getByText(he("admin.staff.cancel")));
    fireEvent.click(document.querySelector('[data-staff-member="יוסף"] [data-staff-delete]')!);
    fireEvent.click(document.querySelector("[data-staff-delete-confirm]")!);
    await waitFor(() => expect(shownNames()).toEqual(["סמיר חדאד", "עלי"]));
  });

  it("adding: a courier only (no role choice), with a code", async () => {
    render(<StaffAdmin />);
    await waitFor(() => expect(shownNames()).toHaveLength(3));
    fireEvent.click(document.querySelector("[data-staff-add]")!);
    expect(screen.getAllByText(he("admin.staff.addCourier")).length).toBeGreaterThan(0);
    expect(screen.queryByText(he("admin.staff.role.waiter"))).toBeNull();
    expect(document.querySelector("#staff-pin")).toBeTruthy();
    fireEvent.change(document.querySelector("#staff-name")!, { target: { value: "חדש" } });
    fireEvent.change(document.querySelector("#staff-phone")!, { target: { value: "0501112222" } });
    fireEvent.click(document.querySelector("[data-staff-save]")!);
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => (c[1] as { action?: string })?.action === "create")).toBe(true));
    const create = fetchMock.mock.calls.find((c) => (c[1] as { action?: string })?.action === "create")![1] as Record<string, unknown>;
    expect(create).toMatchObject({ role: "courier", name: "חדש", phone: "0501112222" });
    expect(String(create.pin)).toMatch(/^\d{4}$/);
  });
});
