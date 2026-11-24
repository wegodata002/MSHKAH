import { NextRequest } from "next/server";
import { requireStaff } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  addCoffeeCups,
  redeemCoffeeGift,
  redeemCouponAtCounter,
  scanSummary,
  undoCoffeeEntry,
  type StaffActor,
} from "@/lib/loyalty/admin/coffee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  memberId?: string;
  action?: "add" | "gift" | "coupon" | "undo";
  count?: number;
  requestId?: string;
  confirm?: boolean;
  code?: string;
  entryId?: string;
};

/**
 * Counter actions on a member card, staff only (Admin / Manager / Employee): add cups, redeem the
 * free cup, mark the 10% code used, undo the last action. Answers with the updated card.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as Body | null;
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  if (!memberId || !body?.action) return Response.json({ ok: false, reason: "bad_request" }, { status: 400 });
  const actor: StaffActor = { uid: auth.uid, name: auth.displayName || auth.email, role: auth.role };
  const now = new Date();
  const requestId = typeof body.requestId === "string" ? body.requestId : "";
  try {
    const db = getAdminDb();
    const result =
      body.action === "add"
        ? await addCoffeeCups(db, { memberId, count: Number(body.count), requestId, confirm: body.confirm === true, actor, now })
        : body.action === "gift"
          ? await redeemCoffeeGift(db, { memberId, requestId, actor, now })
          : body.action === "coupon"
            ? await redeemCouponAtCounter(db, { memberId, code: String(body.code ?? ""), requestId, actor, now })
            : body.action === "undo"
              ? await undoCoffeeEntry(db, { memberId, entryId: String(body.entryId ?? ""), actor, now })
              : ({ ok: false, reason: "bad_request" } as const);
    const summary = await scanSummary(db, memberId, auth, new Date());
    return Response.json({ ...result, summary }, { status: result.ok ? 200 : 409 });
  } catch (error) {
    console.error("[loyalty] coffee action failed", { message: error instanceof Error ? error.message : String(error) });
    return Response.json({ ok: false, reason: "server_error" }, { status: 500 });
  }
}
