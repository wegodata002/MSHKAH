import { NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { assignCourier, listWorkingCouriers } from "@/lib/couriers/admin/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin orders screen (any staff): POST { action: "list" } → couriers working today;
 * POST { action: "assign", orderId, courierId | null } → give a delivery to a courier (or take it away).
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { action?: unknown; orderId?: unknown; courierId?: unknown } | null;
  try {
    const db = getAdminDb();
    if (body?.action === "list") return Response.json({ ok: true, couriers: await listWorkingCouriers(db) });
    if (body?.action === "assign") {
      const orderId = typeof body.orderId === "string" && /^[A-Za-z0-9]{8,64}$/.test(body.orderId) ? body.orderId : null;
      const courierId =
        body.courierId === null ? null : typeof body.courierId === "string" && /^[A-Za-z0-9]{8,64}$/.test(body.courierId) ? body.courierId : undefined;
      if (!orderId || courierId === undefined) return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
      const result = await assignCourier(db, { orderId, courierId });
      if (!result.ok) return Response.json({ error: result.code, code: result.code }, { status: result.code === "ORDER_NOT_FOUND" ? 404 : 409 });
      return Response.json({ ok: true, courier: result.courier });
    }
    return Response.json({ error: "VALIDATION", code: "VALIDATION" }, { status: 400 });
  } catch (error) {
    console.error("[admin/couriers] failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "UNAVAILABLE", code: "UNAVAILABLE" }, { status: 500 });
  }
}
