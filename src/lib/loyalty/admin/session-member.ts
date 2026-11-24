import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { readClubSession } from "@/lib/loyalty/session";
import type { LoyaltyMember } from "@/lib/loyalty/types";

/** The club member of a signed session cookie, or null. Never taken from the request body. */
export async function readSessionMember(db: Firestore, cookieValue: string | undefined | null): Promise<LoyaltyMember | null> {
  const session = readClubSession(cookieValue);
  if (!session) return null;
  const snap = await db
    .collection(COLLECTIONS.loyaltyMembers)
    .where("emailHash", "==", session.emailHash)
    .limit(1)
    .get();
  const doc = snap.docs[0];
  return doc ? { id: doc.id, ...(doc.data() as Omit<LoyaltyMember, "id">) } : null;
}
