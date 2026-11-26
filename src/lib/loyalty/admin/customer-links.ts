import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { phoneKey } from "@/lib/customers/identity";
import { joinedStatus } from "@/lib/loyalty/admin/member-list";

/**
 * Admin → Customers: which customer is a club member (Admin only, server only). Only the member id
 * and status go to the screen (for the badge and the link to Club → Members), no member data.
 *
 * A customer is matched to a member, strongest first:
 *   1. an order of this customer made as that member (`order.customerId` + `order.loyalty.memberId`);
 *   2. the member's `linkedCustomerId`;
 *   3. the same email;
 *   4. the same phone, only when exactly one member has that phone (a family may share one).
 * Members who never finished joining are left out.
 */
export type CustomerMemberLink = { memberId: string; status: "active" | "suspended" };

type MemberIn = { id: string; status?: unknown; activatedAt?: unknown; email?: unknown; phone?: unknown; linkedCustomerId?: unknown };
type CustomerIn = { id: string; email?: unknown; phone?: unknown; phoneKey?: unknown };
type OrderIn = { customerId?: unknown; memberId?: unknown };

const emailKey = (v: unknown) => String(v ?? "").trim().toLowerCase();
/** 9–10 digits starting with 0, or "" (too short to trust). */
const phoneDigits = (v: unknown) => {
  const d = phoneKey(String(v ?? ""));
  return /^0\d{8,9}$/.test(d) ? d : "";
};

/** Pure. */
export function matchCustomersToMembers(members: readonly MemberIn[], customers: readonly CustomerIn[], orders: readonly OrderIn[]): Record<string, CustomerMemberLink> {
  const joined = new Map<string, CustomerMemberLink>();
  for (const m of members) {
    const status = joinedStatus(m);
    if (status) joined.set(m.id, { memberId: m.id, status });
  }
  const byOrder = new Map<string, string>();
  for (const o of orders) {
    const customerId = String(o.customerId ?? "");
    const memberId = String(o.memberId ?? "");
    if (customerId && joined.has(memberId) && !byOrder.has(customerId)) byOrder.set(customerId, memberId);
  }
  const byLinked = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string | null>(); // null: more than one member has this phone
  for (const m of members) {
    if (!joined.has(m.id)) continue;
    const linked = String(m.linkedCustomerId ?? "");
    if (linked) byLinked.set(linked, m.id);
    const email = emailKey(m.email);
    if (email) byEmail.set(email, m.id);
    const phone = phoneDigits(m.phone);
    if (phone) byPhone.set(phone, byPhone.has(phone) ? null : m.id);
  }
  const out: Record<string, CustomerMemberLink> = {};
  for (const c of customers) {
    const email = emailKey(c.email);
    const phone = phoneDigits(c.phoneKey) || phoneDigits(c.phone);
    const memberId =
      byOrder.get(c.id) ?? byLinked.get(c.id) ?? (email ? byEmail.get(email) : undefined) ?? (phone ? byPhone.get(phone) ?? undefined : undefined);
    const link = memberId ? joined.get(memberId) : undefined;
    if (link) out[c.id] = link;
  }
  return out;
}

export async function customerMemberLinks(db: Firestore): Promise<Record<string, CustomerMemberLink>> {
  const [memberSnap, customerSnap] = await Promise.all([db.collection(COLLECTIONS.loyaltyMembers).get(), db.collection(COLLECTIONS.customers).get()]);
  const members = memberSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as MemberIn);
  const customers = customerSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as CustomerIn);
  // The orders made as a member: one query per finished member (a café's club is small).
  const orders: OrderIn[] = [];
  await Promise.all(
    members
      .filter((m) => joinedStatus(m))
      .map(async (m) => {
        const snap = await db.collection(COLLECTIONS.orders).where("loyalty.memberId", "==", m.id).get();
        for (const d of snap.docs) orders.push({ customerId: (d.data() as { customerId?: unknown }).customerId, memberId: m.id });
      })
  );
  return matchCustomersToMembers(members, customers, orders);
}
