import type { StaffMemberView, StaffRole } from "@/lib/staff/types";

/** Admin → Staff list filters (in the browser, on the list already loaded). */
export type StaffFilter = {
  role: "all" | StaffRole;
  status: "all" | "active" | "disabled";
  /** Couriers only: active couriers marked "works today". Ignored for other roles. */
  worksToday: boolean;
  /** Part of the name, or of the phone number (digits). */
  query: string;
};

export const DEFAULT_STAFF_FILTER: StaffFilter = { role: "all", status: "all", worksToday: false, query: "" };

const digits = (s: string) => s.replace(/\D/g, "");

export function matchesStaffQuery(member: Pick<StaffMemberView, "name" | "phone">, query: string): boolean {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return true;
  if (member.name.toLocaleLowerCase().includes(q)) return true;
  const qDigits = digits(q);
  // Two digits or more, so a single digit does not match half the list.
  return qDigits.length >= 2 && qDigits.length === q.replace(/[\s\-+()]/g, "").length && digits(member.phone).includes(qDigits);
}

export function filterStaff(list: readonly StaffMemberView[], filter: StaffFilter): StaffMemberView[] {
  return list.filter(
    (m) =>
      (filter.role === "all" || m.role === filter.role) &&
      (filter.status === "all" || (filter.status === "active" ? m.active : !m.active)) &&
      (!filter.worksToday || filter.role !== "courier" || (m.active && m.worksToday)) &&
      matchesStaffQuery(m, filter.query)
  );
}

/** Numbers on the filter buttons (before the role/status choice, after the search). */
export function staffCounts(list: readonly StaffMemberView[], query: string) {
  const found = list.filter((m) => matchesStaffQuery(m, query));
  return {
    all: found.length,
    courier: found.filter((m) => m.role === "courier").length,
    waiter: found.filter((m) => m.role === "waiter").length,
    active: found.filter((m) => m.active).length,
    disabled: found.filter((m) => !m.active).length,
    worksToday: found.filter((m) => m.role === "courier" && m.active && m.worksToday).length,
  };
}
