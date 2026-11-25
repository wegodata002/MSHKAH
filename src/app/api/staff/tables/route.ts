import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { actorFor, readWaiterContext } from "@/lib/waiter/admin/context";
import { listActiveWaiters, listTodayTableOrders, loadTables, markPaid, markServed } from "@/lib/waiter/admin/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
const ID = /^[A-Za-z0-9]{8,64}$/;

/** Waiter screen data (every 10 seconds): the tables, today's table orders, and who is using it. */
export async function GET(request: NextRequest) {
  try {
    const db = getAdminDb();
    const ctx = await readWaiterContext(db, request);
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
    const [settings, orders, waiters] = await Promise.all([
      loadTables(db),
      listTodayTableOrders(db),
      ctx.mode === "device" ? listActiveWaiters(db) : Promise.resolve([]),
    ]);
    return NextResponse.json(
      {
        ok: true,
        mode: ctx.mode,
        me: ctx.mode === "personal" ? { name: ctx.waiter.name } : null,
        device: ctx.mode === "device" ? { name: ctx.device.name } : null,
        waiters,
        dineInEnabled: settings.enabled,
        tables: settings.tables,
        orders,
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    console.error("[staff/tables] list failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}

/**
 * POST { action: "served", orderId, waiterId? } or { action: "paid", orderIds, paidWith: "cash" | "card", waiterId? }.
 * waiterId: the waiter chosen on a fixed tablet (a waiter signed in with her code needs none).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { action?: unknown; orderId?: unknown; orderIds?: unknown; paidWith?: unknown; waiterId?: unknown }
    | null;
  try {
    const db = getAdminDb();
    const ctx = await readWaiterContext(db, request);
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
    const actor = await actorFor(db, ctx, body?.waiterId);
    if (!actor) return NextResponse.json({ ok: false, code: "CHOOSE_WAITER" }, { status: 400, headers: NO_STORE });

    if (body?.action === "served" && typeof body.orderId === "string" && ID.test(body.orderId)) {
      const result = await markServed(db, { orderId: body.orderId, actor });
      return NextResponse.json(result, { status: result.ok ? 200 : 409, headers: NO_STORE });
    }
    if (
      body?.action === "paid" &&
      Array.isArray(body.orderIds) &&
      body.orderIds.length > 0 &&
      body.orderIds.every((id) => typeof id === "string" && ID.test(id)) &&
      (body.paidWith === "cash" || body.paidWith === "card")
    ) {
      const result = await markPaid(db, { orderIds: body.orderIds as string[], paidWith: body.paidWith, actor });
      return NextResponse.json(result, { status: result.ok ? 200 : 409, headers: NO_STORE });
    }
    return NextResponse.json({ ok: false, code: "INVALID" }, { status: 400, headers: NO_STORE });
  } catch (error) {
    console.error("[staff/tables] action failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
