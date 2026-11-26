import type { NextRequest } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { DEVICE_COOKIE_NAME } from "@/lib/staff/device";
import { readStaffDevice } from "@/lib/staff/admin/devices";

/**
 * Who is using the waiter screen: a device that joined with the waiters' QR (or one linked earlier
 * with a 6-digit code). Waiters no longer sign in with a personal code.
 */
export type WaiterContext = { mode: "device"; device: { id: string; name: string } };

export async function readWaiterContext(db: Firestore, request: NextRequest): Promise<WaiterContext | null> {
  const device = await readStaffDevice(db, request.cookies.get(DEVICE_COOKIE_NAME)?.value);
  return device ? { mode: "device", device: { id: device.id, name: device.name } } : null;
}

/** The name saved as "who did it": the device's name ("טלפון מלצרית 1"). */
export function actorFor(ctx: WaiterContext): string {
  return ctx.device.name;
}
