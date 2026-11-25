import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { STAFF_COOKIE_NAME } from "@/lib/staff/session";
import { readStaffMember } from "@/lib/staff/admin/store";
import { applyCourierAction, listCourierDeliveries } from "@/lib/couriers/admin/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

async function signedInCourier(request: NextRequest) {
  const member = await readStaffMember(getAdminDb(), request.cookies.get(STAFF_COOKIE_NAME)?.value);
  return member && member.role === "courier" ? member : null;
}

/** The signed-in courier's deliveries assigned today (the courier screen asks every 10 seconds). */
export async function GET(request: NextRequest) {
  try {
    const courier = await signedInCourier(request);
    if (!courier) return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
    const deliveries = await listCourierDeliveries(getAdminDb(), courier.id);
    return NextResponse.json({ ok: true, worksToday: courier.worksToday, deliveries }, { headers: NO_STORE });
  } catch (error) {
    console.error("[staff/deliveries] list failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}

/** POST { orderId, action: "out" | "delivered", paidWith?: "cash" | "card" } on the courier's own delivery. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { orderId?: unknown; action?: unknown; paidWith?: unknown } | null;
  const orderId = typeof body?.orderId === "string" && /^[A-Za-z0-9]{8,64}$/.test(body.orderId) ? body.orderId : null;
  const action = body?.action === "out" || body?.action === "delivered" ? body.action : null;
  const paidWith = body?.paidWith === "cash" || body?.paidWith === "card" ? body.paidWith : null;
  if (!orderId || !action) return NextResponse.json({ ok: false, code: "INVALID" }, { status: 400, headers: NO_STORE });
  try {
    const courier = await signedInCourier(request);
    if (!courier) return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
    const result = await applyCourierAction(getAdminDb(), { courier: { id: courier.id, name: courier.name }, orderId, action, paidWith });
    if (!result.ok) {
      const status = result.code === "ORDER_NOT_FOUND" || result.code === "NOT_YOURS" ? 404 : result.code === "PAYMENT_REQUIRED" ? 400 : 409;
      return NextResponse.json({ ok: false, code: result.code }, { status, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true, delivery: result.delivery }, { headers: NO_STORE });
  } catch (error) {
    console.error("[staff/deliveries] action failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
