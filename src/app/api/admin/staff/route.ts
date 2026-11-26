import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { parseStaffAdminRequest } from "@/lib/staff/admin-input";
import { createStaff, deleteStaff, listStaff, setStaffPin, updateStaff } from "@/lib/staff/admin/store";
import { listCourierDeliveries } from "@/lib/couriers/admin/store";
import { openDeliveryCount } from "@/lib/couriers/deliveries";
import { getOrCreateWaiterJoinKey, listDevices, renameDevice, revokeDevice, rotateWaiterJoinKey } from "@/lib/staff/admin/devices";
import { waiterJoinUrl } from "@/lib/staff/waiter-join";
import { qrStoreOrigin } from "@/lib/admin-qr-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin "Staff" page (Admin only): POST { action: "list" | "create" | "update" | "set-pin", … }.
 * The code is only ever received here to be hashed; it is never stored or sent back.
 * Also the waiters' QR ("waiter-qr", "rotate-waiter-qr") and the devices that joined with it.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const parsed = parseStaffAdminRequest(await request.json().catch(() => null));
  if (!parsed.ok) return Response.json({ error: "VALIDATION", code: parsed.error }, { status: 400 });

  try {
    const db = getAdminDb();
    const actor = auth.email || auth.uid;
    const req = parsed.request;
    if (req.action === "list") return Response.json({ ok: true, staff: await listStaff(db) });
    // Devices on the waiter screen, and the waiters' QR that connects them.
    if (req.action === "devices") return Response.json({ ok: true, devices: await listDevices(db) });
    if (req.action === "waiter-qr" || req.action === "rotate-waiter-qr") {
      const qr = req.action === "waiter-qr" ? await getOrCreateWaiterJoinKey(db, { actor }) : await rotateWaiterJoinKey(db, { actor });
      const url = waiterJoinUrl(qrStoreOrigin(), qr.key);
      return Response.json(
        { ok: true, qr: { url, version: qr.version, createdAt: qr.createdAt, disconnected: "disconnected" in qr ? qr.disconnected : 0 } },
        { headers: { "cache-control": "no-store" } }
      );
    }
    if (req.action === "rename-device") {
      const done = await renameDevice(db, req.deviceId, req.name);
      return done ? Response.json({ ok: true }) : Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
    }
    if (req.action === "delete") {
      const result = await deleteStaff(db, {
        id: req.id,
        openDeliveriesToday: async (courierId) => openDeliveryCount(await listCourierDeliveries(db, courierId)),
      });
      if (result.ok) return Response.json({ ok: true });
      return result.code === "OPEN_DELIVERIES"
        ? Response.json({ error: result.code, code: result.code, open: result.open }, { status: 409 })
        : Response.json({ error: result.code, code: result.code }, { status: 404 });
    }
    if (req.action === "revoke-device") {
      const done = await revokeDevice(db, req.deviceId);
      return done ? Response.json({ ok: true }) : Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404 });
    }
    const result =
      req.action === "create"
        ? await createStaff(db, { ...req, actor })
        : req.action === "update"
          ? await updateStaff(db, { ...req, actor })
          : await setStaffPin(db, { ...req, actor });
    if (!result.ok) return Response.json({ error: result.code, code: result.code }, { status: result.code === "NOT_FOUND" ? 404 : 409 });
    return Response.json({ ok: true, member: result.member });
  } catch (error) {
    console.error("[admin/staff] failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "UNAVAILABLE", code: "UNAVAILABLE" }, { status: 500 });
  }
}
