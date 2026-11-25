/** Staff who sign in with a personal 4-digit code (no admin account): couriers and waiters. */
export const STAFF_ROLES = ["courier", "waiter"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return value === "courier" || value === "waiter";
}

/** Stored in `staffMembers/{id}` (server only; the browser never reads this collection). */
export type StaffMemberDoc = {
  name: string;
  phone: string;
  role: StaffRole;
  active: boolean;
  /** HMAC of the 4-digit code with the server pepper; unique across staff. Never the code itself. */
  pinHash: string | null;
  pinSetAt: string | null;
  /** Bumped when the code changes or the member is disabled: every open login ends at once. */
  sessionVersion: number;
  /** Couriers: "YYYY-MM-DD" (Jerusalem) of the day marked "working today"; any other day = not working. */
  workingDate: string | null;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
};

/** What the admin "Staff" page receives (no code, no hash). */
export type StaffMemberView = {
  id: string;
  name: string;
  phone: string;
  role: StaffRole;
  active: boolean;
  hasPin: boolean;
  pinSetAt: string | null;
  worksToday: boolean;
};

/** "2026-11-25" in Asia/Jerusalem. */
export function jerusalemDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function toStaffView(id: string, doc: StaffMemberDoc, now: Date = new Date()): StaffMemberView {
  return {
    id,
    name: doc.name,
    phone: doc.phone,
    role: doc.role,
    active: doc.active,
    hasPin: !!doc.pinHash,
    pinSetAt: doc.pinSetAt,
    worksToday: doc.role === "courier" && doc.workingDate === jerusalemDate(now),
  };
}
