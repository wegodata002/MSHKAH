import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { renderClubWelcomeEmail } from "@/lib/email/loyalty-templates";
import { sendMishkahEmail } from "@/lib/email/send";
import { getPublicSiteUrl } from "@/lib/email/config";
import { readLoyaltySettings, setWelcomeEmailStatus } from "@/lib/loyalty/admin/members";
import { fromMinor } from "@/lib/loyalty/points-math";
import { loyaltyLog } from "@/lib/loyalty/admin/log";
import type { LoyaltyMember } from "@/lib/loyalty/types";

/**
 * Welcome email after a member becomes active (free sign-up, or the older paid flow).
 * Idempotent via the member's `welcomeEmailStatus`; a failed email never undoes the membership.
 */
export async function sendClubWelcomeEmail(db: Firestore, memberId: string): Promise<void> {
  try {
    const memberSnap = await db.collection(COLLECTIONS.loyaltyMembers).doc(memberId).get();
    if (!memberSnap.exists) return;
    const member = { id: memberId, ...(memberSnap.data() as Omit<LoyaltyMember, "id">) };
    if (member.welcomeEmailStatus === "sent") return;
    const settings = await readLoyaltySettings(db);
    const content = renderClubWelcomeEmail({
      memberNumber: member.memberNumber,
      displayName: member.displayName,
      spendPerPointIls: fromMinor(settings.spendPerPointMinor),
      joinFeeIls: fromMinor(member.joinFeePaidMinor || 0),
      accountUrl: `${getPublicSiteUrl()}/club/me`,
      showMarketingConsent: !member.consentMarketing,
    });
    const email = await sendMishkahEmail({
      to: member.email,
      subject: content.subject,
      html: content.html,
      text: content.text,
      kind: "loyalty_welcome",
    });
    await setWelcomeEmailStatus(db, memberId, email.ok ? "sent" : "failed");
    loyaltyLog(email.ok ? "email.welcome.sent" : "email.welcome.failed", { memberId });
  } catch (error) {
    console.error("[loyalty] welcome email dispatch failed", {
      memberId,
      message: error instanceof Error ? error.message : "unknown",
    });
    await setWelcomeEmailStatus(db, memberId, "failed").catch(() => undefined);
  }
}
