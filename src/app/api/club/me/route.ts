import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getAdminDb } from "@/lib/firebase/admin";
import { CLUB_COOKIE_NAME, readClubSession } from "@/lib/loyalty/session";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { readLoyaltySettings, readMemberHistory } from "@/lib/loyalty/admin/members";
import { ensureWelcomeCoupon, memberCouponViews } from "@/lib/loyalty/admin/coupons";
import { signMemberCard } from "@/lib/loyalty/card-link";
import { clubHintCookie, CLUB_HINT_COOKIE } from "@/lib/loyalty/club-hint";
import type {
  LoyaltyMeResponse,
  LoyaltyMember,
} from "@/lib/loyalty/types";

export const runtime = "nodejs";

const HINT_MAX_AGE = 60 * 60 * 24 * 182;

export async function GET(_request: NextRequest) {
  const jar = await cookies();
  const session = readClubSession(jar.get(CLUB_COOKIE_NAME)?.value);
  const db = getAdminDb();
  const settings = await readLoyaltySettings(db);
  const publicSettings = {
    enrollmentEnabled: settings.enrollmentEnabled,
    earnEnabled: settings.earnEnabled,
    redemptionEnabled: settings.redemptionEnabled,
    joinFeeMinor: settings.joinFeeMinor,
    spendPerPointMinor: settings.spendPerPointMinor,
    pointValueMinor: settings.pointValueMinor,
    redemptionMinPoints: settings.redemptionMinPoints,
    redemptionMaxPoints: settings.redemptionMaxPoints,
    pointValueApproved: settings.pointValueApproved,
    termsHe: settings.termsHe,
    termsAr: settings.termsAr,
    termsEn: settings.termsEn,
  };
  // The header's "My card" marker follows the real session.
  const clearHint = () => {
    if (jar.get(CLUB_HINT_COOKIE)) jar.set(clubHintCookie(0));
  };
  if (!session) {
    clearHint();
    const response: LoyaltyMeResponse = { member: null, settings: publicSettings, history: [] };
    return Response.json(response);
  }
  const snap = await db
    .collection(COLLECTIONS.loyaltyMembers)
    .where("emailHash", "==", session.emailHash)
    .limit(1)
    .get();
  const doc = snap.docs[0];
  if (!doc) {
    clearHint();
    const response: LoyaltyMeResponse = { member: null, settings: publicSettings, history: [] };
    return Response.json(response);
  }
  const member = { id: doc.id, ...(doc.data() as Omit<LoyaltyMember, "id">) };
  const isMember = member.status === "active" || member.status === "suspended";
  if (isMember) jar.set(clubHintCookie(HINT_MAX_AGE));
  else clearHint();

  // Members who joined before welcome codes existed get one on their first visit here
  // (30 days from now, no email), only while they have no completed order since joining.
  const now = new Date();
  if (
    member.status === "active" &&
    settings.welcomeCouponEnabled &&
    !member.welcomeCouponCode &&
    !member.welcomeCouponSkippedAt
  ) {
    await ensureWelcomeCoupon(db, member.id, { now, requireNoPurchase: true }).catch((error) =>
      console.error("[loyalty] welcome coupon (existing member) failed", {
        message: error instanceof Error ? error.message : String(error),
      })
    );
  }

  const [history, coupons] = await Promise.all([
    readMemberHistory(db, member.id, 30),
    isMember ? memberCouponViews(db, member.id, now).catch(() => []) : Promise.resolve([]),
  ]);
  const response: LoyaltyMeResponse = {
    member: {
      id: member.id,
      memberNumber: member.memberNumber,
      displayName: member.displayName,
      email: member.email,
      status: member.status,
      balancePoints: member.balancePoints,
      pointsCarryMinor: member.pointsCarryMinor ?? 0,
      joinedAt: member.activatedAt,
      cardToken: isMember ? signMemberCard(member.id) : undefined,
    },
    settings: publicSettings,
    history: history.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      points: entry.points,
      source: entry.source,
      reason: entry.reason,
      orderId: entry.orderId,
      createdAt: entry.createdAt,
    })),
    coupons,
  };
  return Response.json(response);
}
