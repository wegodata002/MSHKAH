import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StaffMemberView } from "@/lib/staff/types";

vi.mock("@/components/providers/locale-provider", async () => {
  const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
  return {
    useT: () => (key: string, fallback?: string) => ADMIN_TRANSLATIONS.he[key] ?? fallback ?? key,
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
  hasPin: true,
  pinSetAt: null,
});
const STAFF = [
  m("סמיר חדאד", "courier", true, true, "0521112233"),
  m("יוסף", "courier", true, false, "0501234567"),
  m("עלי", "courier", false, false, "0507654321"),
  m("רנא", "waiter", true, false, "0549998877"),
  m("סמאח", "waiter", false, false, "0531231234"),
];

vi.mock("@/lib/auth/client-admin-fetch", () => ({
  clientAdminFetch: vi.fn(async (_url: string, body: { action: string }) =>
    body.action === "list" ? { ok: true, data: { staff: STAFF } } : { ok: true, data: { devices: [] } }
  ),
}));

import { StaffAdmin } from "@/features/admin/staff-admin";

const shownNames = () =>
  [...document.querySelectorAll("[data-staff-member]")].map((el) => el.getAttribute("data-staff-member"));

describe("Admin → Staff filters (rendered)", () => {
  it("role, status, works today, search by name and phone, clear", async () => {
    render(<StaffAdmin />);
    await waitFor(() => expect(shownNames()).toHaveLength(5));
    const filters = document.querySelector("[data-staff-filters]") as HTMLElement;

    // Counts on the buttons.
    expect(within(filters).getByText("שליחים").parentElement?.textContent).toContain("3");
    // No "works today" until couriers are chosen.
    expect(document.querySelector("[data-staff-works-today]")).toBeNull();

    fireEvent.click(document.querySelector('[data-staff-role="courier"]')!);
    expect(shownNames()).toEqual(["סמיר חדאד", "יוסף", "עלי"]);
    fireEvent.click(document.querySelector("[data-staff-works-today]")!);
    expect(shownNames()).toEqual(["סמיר חדאד"]);

    fireEvent.click(document.querySelector('[data-staff-role="waiter"]')!);
    expect(document.querySelector("[data-staff-works-today]")).toBeNull();
    fireEvent.click(document.querySelector('[data-staff-status="disabled"]')!);
    expect(shownNames()).toEqual(["סמאח"]);

    fireEvent.click(document.querySelector('[data-staff-role="all"]')!);
    fireEvent.click(document.querySelector('[data-staff-status="all"]')!);
    const search = document.querySelector("[data-staff-search]") as HTMLInputElement;
    fireEvent.change(search, { target: { value: "סמ" } });
    expect(shownNames()).toEqual(["סמיר חדאד", "סמאח"]);
    fireEvent.change(search, { target: { value: "054-999" } });
    expect(shownNames()).toEqual(["רנא"]);

    fireEvent.change(search, { target: { value: "אין כזה" } });
    expect(shownNames()).toEqual([]);
    expect(screen.getByText("אין אנשי צוות שמתאימים לסינון.")).toBeTruthy();
    fireEvent.click(document.querySelector("[data-staff-clear-filters]")!);
    expect(shownNames()).toHaveLength(5);
    expect(search.value).toBe("");
  });
});
