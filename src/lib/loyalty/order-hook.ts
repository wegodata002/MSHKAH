import type { Firestore } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { awardOrderPoints, readLoyaltySettings } from "@/lib/loyalty/admin/members";
import { hashEmail } from "@/lib/loyalty/tokens";
import { qualifyingAmountMinor, toMinor } from "@/lib/loyalty/points-math";
import type { FirestoreOrder } from "@/types/firestore";

/**
 * Called from the post-paid pipeline. The function:
 *   1. Opens the paid order
 *   2. Looks up the member by email
 *   3. Writes an idempotent `earn:<orderId>` ledger entry
 *   4. Updates the member balance in the same transaction (see members.ts)
 *
 * Any failure is logged and swallowed so a Brevo / email outage never
 * rolls back the payment (same contract as print and admin-email tasks).
 */
/**
 * Which club member gets the points for an order. The member identified on the server when the
 * order was created (club session) comes first; older orders, and orders without a session,
 * fall back to matching the order email. No email and no member id → nobody.
 */
export async function loyaltyMemberIdForOrder(
  order: { loyalty?: { memberId?: string | null } | null; customerEmail?: string | null },
  findMemberIdByEmailHash: (emailHash: string) => Promise<string | null>
): Promise<string | null> {
  const fromSession = order.loyalty?.memberId?.trim();
  if (fromSession) return fromSession;
  const email = order.customerEmail?.trim();
  if (!email) return null;
  return findMemberIdByEmailHash(hashEmail(email));
}

export async function awardLoyaltyPointsForOrder(
  orderId: string,
  db: Firestore = getAdminDb()
): Promise<{ ok: boolean; status: "awarded" | "skipped" | "no_member" | "disabled" | "error" }> {
  try {
    const settings = await readLoyaltySettings(db);
    if (!settings.earnEnabled) return { ok: true, status: "disabled" };

    const orderSnap = await db.collection(COLLECTIONS.orders).doc(orderId).get();
    if (!orderSnap.exists) return { ok: true, status: "skipped" };
    const order = orderSnap.data() as FirestoreOrder & {
      customerEmail?: string | null;
      loyalty?: {
        memberId?: string | null;
        joinFeePortionMinor?: number;
        redeemedValueMinor?: number;
      } | null;
    };
    const memberId = await loyaltyMemberIdForOrder(order, async (emailHash) => {
      const memberSnap = await db
        .collection(COLLECTIONS.loyaltyMembers)
        .where("emailHash", "==", emailHash)
        .limit(1)
        .get();
      return memberSnap.docs[0]?.id ?? null;
    });
    if (!memberId) return { ok: true, status: "no_member" };

    const paidTotal = Number(order.total) || 0;
    const qualifying = qualifyingAmountMinor({
      paidAmountMinor: toMinor(paidTotal),
      joinFeePortionMinor: order.loyalty?.joinFeePortionMinor ?? 0,
      redeemedValueMinor: order.loyalty?.redeemedValueMinor ?? 0,
    });
    if (qualifying <= 0) return { ok: true, status: "skipped" };

    const result = await awardOrderPoints(db, {
      memberId,
      orderId,
      qualifyingAmountMinor: qualifying,
    });
    return { ok: true, status: result ? "awarded" : "skipped" };
  } catch (error) {
    console.error("[loyalty] award failed", {
      orderId,
      message: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, status: "error" };
  }
}
