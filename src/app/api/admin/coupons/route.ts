import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { createStoreCoupon, deleteStoreCoupon, listStoreCoupons, updateStoreCoupon } from "@/lib/coupons/admin/store";
import { normalizeStoreCode, parseCouponInput, COUPON_CODE } from "@/lib/coupons/store-coupons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Admin → Coupons (Admin only): POST { action: "list" | "create" | "update" | "toggle" | "delete", … }.
 * Store coupons only; personal club codes (MK-…) are managed by the club and never here.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = body?.action;
  const actor = auth.email || auth.uid;
  try {
    const db = getAdminDb();
    if (action === "list") return Response.json({ ok: true, coupons: await listStoreCoupons(db) }, { headers: NO_STORE });

    if (action === "create" || action === "update") {
      const parsed = parseCouponInput(body?.coupon);
      if (!parsed.ok) return Response.json({ error: "VALIDATION", code: parsed.error }, { status: 400, headers: NO_STORE });
      if (action === "create") {
        const result = await createStoreCoupon(db, { coupon: parsed.coupon, actor });
        return result.ok
          ? Response.json({ ok: true, coupon: result.coupon }, { headers: NO_STORE })
          : Response.json({ error: result.code, code: result.code }, { status: 409, headers: NO_STORE });
      }
      const { code, ...patch } = parsed.coupon;
      const result = await updateStoreCoupon(db, { code, patch, actor });
      return result.ok
        ? Response.json({ ok: true, coupon: result.coupon }, { headers: NO_STORE })
        : Response.json({ error: result.code, code: result.code }, { status: 404, headers: NO_STORE });
    }

    const code = normalizeStoreCode(body?.code);
    if (!COUPON_CODE.test(code)) return Response.json({ error: "VALIDATION", code: "CODE" }, { status: 400, headers: NO_STORE });
    if (action === "toggle" && typeof body?.active === "boolean") {
      const result = await updateStoreCoupon(db, { code, patch: { active: body.active }, actor });
      return result.ok
        ? Response.json({ ok: true, coupon: result.coupon }, { headers: NO_STORE })
        : Response.json({ error: result.code, code: result.code }, { status: 404, headers: NO_STORE });
    }
    if (action === "delete") {
      return (await deleteStoreCoupon(db, { code, actor }))
        ? Response.json({ ok: true }, { headers: NO_STORE })
        : Response.json({ error: "NOT_FOUND", code: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
    }
    return Response.json({ error: "VALIDATION", code: "ACTION" }, { status: 400, headers: NO_STORE });
  } catch (error) {
    console.error("[admin/coupons] failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "UNAVAILABLE", code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
