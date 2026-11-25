import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { consumeRateLimit, rateLimitKey } from "@/lib/loyalty/admin/rate-limit";
import { loadCatalogProducts, loadFulfillmentContext } from "@/lib/orders/server-context";
import { loadModifierConfigs } from "@/lib/orders/admin-modifier-config";
import { notifyNewOrder } from "@/lib/email/notifications";
import { maybeEnqueueNewOrderPrint } from "@/lib/print-jobs/enqueue-new-order";
import { actorFor, readWaiterContext } from "@/lib/waiter/admin/context";
import { handleWaiterOrder, WAITER_ORDER_LIMIT } from "@/lib/waiter/new-order";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * POST — a waiter enters a guest's order at a table (waiter signed in with her code, or a fixed
 * tablet with the waiter chosen on it). Same server checks as a guest's order; printed and emailed
 * here on the server, like any new order.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { waiterId?: unknown } | null;
  try {
    const db = getAdminDb();
    const ctx = await readWaiterContext(db, request);
    if (!ctx) return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
    const actor = await actorFor(db, ctx, body?.waiterId);
    if (!actor) return NextResponse.json({ ok: false, code: "CHOOSE_WAITER" }, { status: 400, headers: NO_STORE });
    const who = ctx.mode === "personal" ? `staff:${ctx.waiter.id}` : `device:${ctx.device.id}`;

    const result = await handleWaiterOrder(body, actor, {
      now: () => new Date(),
      rateLimit: async () =>
        (await consumeRateLimit(db, { key: rateLimitKey(["waiter-order", who]), windowSeconds: WAITER_ORDER_LIMIT.windowSeconds, limit: WAITER_ORDER_LIMIT.limit })).ok,
      loadProducts: (ids) => loadCatalogProducts(db, ids),
      loadContext: () => loadFulfillmentContext(db),
      loadModifierConfigs: (ids) => loadModifierConfigs(db, ids),
      saveOrder: async (draft) => {
        const now = Timestamp.now();
        const ref = await db.collection(COLLECTIONS.orders).add({ ...draft, createdAt: now, receivedAt: now });
        return ref.id;
      },
      afterSave: async (orderId) => {
        // Kitchen ticket and the new-order email; neither may fail the order.
        const settled = await Promise.allSettled([maybeEnqueueNewOrderPrint(orderId), notifyNewOrder(orderId)]);
        for (const r of settled) {
          if (r.status === "rejected") console.error("[staff/tables/order] after-save failed:", r.reason instanceof Error ? r.reason.message : r.reason);
        }
      },
    });
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
  } catch (error) {
    console.error("[staff/tables/order] failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, code: "ORDER_SAVE_FAILED" }, { status: 500, headers: NO_STORE });
  }
}
