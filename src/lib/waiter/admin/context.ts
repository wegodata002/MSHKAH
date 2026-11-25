import type { NextRequest } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { STAFF_COOKIE_NAME } from "@/lib/staff/session";
import { DEVICE_COOKIE_NAME } from "@/lib/staff/device";
import { readStaffMember } from "@/lib/staff/admin/store";
import { readStaffDevice } from "@/lib/staff/admin/devices";
import { findActiveWaiter } from "@/lib/waiter/admin/store";
import { actorLabel } from "@/lib/waiter/tables";

/** Who is using the waiter screen: a waiter signed in with her code, or a fixed cafe tablet. */
export type WaiterContext =
  | { mode: "personal"; waiter: { id: string; name: string } }
  | { mode: "device"; device: { id: string; name: string } };

export async function readWaiterContext(db: Firestore, request: NextRequest): Promise<WaiterContext | null> {
  const member = await readStaffMember(db, request.cookies.get(STAFF_COOKIE_NAME)?.value);
  if (member && member.role === "waiter") return { mode: "personal", waiter: { id: member.id, name: member.name } };
  const device = await readStaffDevice(db, request.cookies.get(DEVICE_COOKIE_NAME)?.value);
  if (device) return { mode: "device", device: { id: device.id, name: device.name } };
  return null;
}

/**
 * The name saved as "who did it". A waiter with her code: her name. A fixed tablet: the waiter chosen
 * on the tablet ("Who is working now?"), checked against the active waiters, plus the tablet's name.
 */
export async function actorFor(db: Firestore, ctx: WaiterContext, waiterId: unknown): Promise<string | null> {
  if (ctx.mode === "personal") return ctx.waiter.name;
  if (typeof waiterId !== "string") return null;
  const waiter = await findActiveWaiter(db, waiterId);
  return waiter ? actorLabel(waiter.name, ctx.device.name) : null;
}
