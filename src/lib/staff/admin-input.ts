import { phoneKey } from "@/lib/customers/identity";
import { isStaffRole, type StaffRole } from "@/lib/staff/types";
import { isValidPinFormat, isWeakPin } from "@/lib/staff/pin";

/** Admin "Staff" page requests (POST /api/admin/staff). */
export type StaffAdminRequest =
  | { action: "list" }
  | { action: "create"; name: string; phone: string; role: StaffRole; pin?: string }
  | { action: "update"; id: string; name?: string; phone?: string; role?: StaffRole; active?: boolean; worksToday?: boolean }
  | { action: "set-pin"; id: string; pin: string }
  /** Removes the staff record only; orders keep the names saved on them. */
  | { action: "delete"; id: string }
  | { action: "devices" }
  | { action: "rename-device"; deviceId: string; name: string }
  | { action: "revoke-device"; deviceId: string }
  /** The waiters' QR (made the first time) / a new one that disconnects the QR devices. */
  | { action: "waiter-qr" }
  | { action: "rotate-waiter-qr" };

export type StaffInputError = "NAME" | "PHONE" | "ROLE" | "PIN_FORMAT" | "PIN_WEAK" | "ID" | "ACTION" | "DEVICE_NAME";

function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 60 ? name : null;
}

function cleanPhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const phone = phoneKey(raw);
  return phone.length >= 9 && phone.length <= 12 ? phone : null;
}

function checkPin(raw: unknown): StaffInputError | null {
  if (!isValidPinFormat(raw)) return "PIN_FORMAT";
  if (isWeakPin(raw)) return "PIN_WEAK";
  return null;
}

const ID = /^[A-Za-z0-9]{8,64}$/;

export function parseStaffAdminRequest(body: unknown): { ok: true; request: StaffAdminRequest } | { ok: false; error: StaffInputError } {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  switch (input.action) {
    case "list":
      return { ok: true, request: { action: "list" } };
    case "create": {
      const name = cleanName(input.name);
      if (!name) return { ok: false, error: "NAME" };
      const phone = cleanPhone(input.phone);
      if (!phone) return { ok: false, error: "PHONE" };
      // Only couriers are added: waiters join with the waiters' QR and need no record.
      if (input.role !== "courier") return { ok: false, error: "ROLE" };
      const pinError = checkPin(input.pin);
      if (pinError) return { ok: false, error: pinError };
      return { ok: true, request: { action: "create", name, phone, role: input.role, pin: input.pin as string } };
    }
    case "update": {
      if (typeof input.id !== "string" || !ID.test(input.id)) return { ok: false, error: "ID" };
      const request: Extract<StaffAdminRequest, { action: "update" }> = { action: "update", id: input.id };
      if (input.name !== undefined) {
        const name = cleanName(input.name);
        if (!name) return { ok: false, error: "NAME" };
        request.name = name;
      }
      if (input.phone !== undefined) {
        const phone = cleanPhone(input.phone);
        if (!phone) return { ok: false, error: "PHONE" };
        request.phone = phone;
      }
      if (input.role !== undefined) {
        if (!isStaffRole(input.role)) return { ok: false, error: "ROLE" };
        request.role = input.role;
      }
      if (typeof input.active === "boolean") request.active = input.active;
      if (typeof input.worksToday === "boolean") request.worksToday = input.worksToday;
      return { ok: true, request };
    }
    case "devices":
      return { ok: true, request: { action: "devices" } };
    case "rename-device": {
      if (typeof input.deviceId !== "string" || !ID.test(input.deviceId)) return { ok: false, error: "ID" };
      const name = cleanName(input.name);
      if (!name || name.length > 40) return { ok: false, error: "DEVICE_NAME" };
      return { ok: true, request: { action: "rename-device", deviceId: input.deviceId, name } };
    }
    case "waiter-qr":
      return { ok: true, request: { action: "waiter-qr" } };
    case "rotate-waiter-qr":
      return { ok: true, request: { action: "rotate-waiter-qr" } };
    case "revoke-device": {
      if (typeof input.deviceId !== "string" || !ID.test(input.deviceId)) return { ok: false, error: "ID" };
      return { ok: true, request: { action: "revoke-device", deviceId: input.deviceId } };
    }
    case "delete": {
      if (typeof input.id !== "string" || !ID.test(input.id)) return { ok: false, error: "ID" };
      return { ok: true, request: { action: "delete", id: input.id } };
    }
    case "set-pin": {
      if (typeof input.id !== "string" || !ID.test(input.id)) return { ok: false, error: "ID" };
      const pinError = checkPin(input.pin);
      if (pinError) return { ok: false, error: pinError };
      return { ok: true, request: { action: "set-pin", id: input.id, pin: input.pin as string } };
    }
    default:
      return { ok: false, error: "ACTION" };
  }
}
