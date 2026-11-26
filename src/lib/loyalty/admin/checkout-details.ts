import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { cleanDetails, detailsFromOrder, type CheckoutDetails } from "@/lib/customers/checkout-details";
import type { LoyaltyMember } from "@/lib/loyalty/types";

/** Active or suspended: a real club member (not a sign-up that never finished). */
export function isClubMember(status: string | undefined): boolean {
  return status === "active" || status === "suspended";
}

/**
 * The member's last checkout details, kept on the member as `checkoutDetails`: phone always,
 * area/address/link only from a delivery order (a delivery without a link removes the old link).
 * The name is never written: it comes from the club profile.
 */
export function memberCheckoutUpdate(order: {
  orderType: "pickup" | "delivery" | "dine_in";
  customerPhone?: string;
  deliveryZoneId?: string;
  deliveryAddress?: string;
  deliveryLocationUrl?: string;
}): Record<string, unknown> | null {
  const details = detailsFromOrder({
    phone: order.customerPhone,
    orderType: order.orderType,
    zoneId: order.deliveryZoneId,
    address: order.deliveryAddress,
    locationUrl: order.deliveryLocationUrl,
  });
  const update: Record<string, unknown> = {};
  if (details.phone) update["checkoutDetails.phone"] = details.phone;
  if (order.orderType === "delivery" && details.address) {
    update["checkoutDetails.address"] = details.address;
    if (details.zoneId) update["checkoutDetails.zoneId"] = details.zoneId;
    update["checkoutDetails.locationUrl"] = details.locationUrl ?? FieldValue.delete();
  }
  if (!Object.keys(update).length) return null;
  update["checkoutDetails.updatedAt"] = new Date().toISOString();
  return update;
}

export async function saveMemberCheckoutDetails(
  db: Firestore,
  memberId: string,
  order: Parameters<typeof memberCheckoutUpdate>[0]
): Promise<void> {
  const update = memberCheckoutUpdate(order);
  if (update) await db.collection(COLLECTIONS.loyaltyMembers).doc(memberId).update(update);
}

/** What the checkout may fill for the member: profile name, last phone (or the sign-up phone), last delivery. */
export function memberCheckoutDetails(member: Pick<LoyaltyMember, "displayName" | "phone"> & { checkoutDetails?: unknown }): CheckoutDetails {
  const saved = cleanDetails(member.checkoutDetails);
  const profile = cleanDetails({ name: member.displayName, phone: member.phone });
  const out: CheckoutDetails = { ...saved, phone: saved.phone ?? profile.phone };
  delete out.name;
  if (profile.name) out.name = profile.name;
  if (!out.phone) delete out.phone;
  return out;
}
