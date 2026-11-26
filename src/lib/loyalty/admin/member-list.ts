import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { mapOrder } from "@/lib/mappers";
import { normalizeOrderStatus } from "@/lib/orders/status";
import { isUnpaidCardOrder } from "@/lib/loyalty/admin/member-orders";
import { memberCouponViews } from "@/lib/loyalty/admin/coupons";
import { readMemberHistory } from "@/lib/loyalty/admin/members";
import type { LoyaltyCouponView } from "@/lib/loyalty/coupons";
import type { LoyaltyLedgerEntry, LoyaltyMember } from "@/lib/loyalty/types";
import type { Order } from "@/types";
import type { FirestoreOrder } from "@/types/firestore";

/**
 * Admin → Club → Members (Admin only, server only). Members are those who finished joining
 * (active or suspended); sign-ups that never finished are only counted. Name and email go to the
 * admin's screen only.
 */
export type AdminMemberRow = {
  id: string;
  memberNumber: string;
  name: string;
  email: string;
  status: "active" | "suspended";
  joinedAt: string | null;
  balancePoints: number;
  coffeeCups: number;
};

export type AdminMemberCounts = { total: number; joinedThisMonth: number; incomplete: number };

/** "2026-11" in Israel time. */
export function israelMonth(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).format(date);
}

/**
 * A stored date as ISO text. Members written by the app keep ISO strings; a record made by hand in
 * the console (or an old import) may hold a Firestore Timestamp, a Date or milliseconds. Anything
 * unreadable is null, so one odd record never breaks the whole list.
 */
export function isoDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  let date: Date | null = null;
  if (typeof value === "string" || typeof value === "number") date = new Date(value);
  else if (value instanceof Date) date = value;
  else if (typeof value === "object") {
    const v = value as { toDate?: () => Date; seconds?: unknown; _seconds?: unknown };
    if (typeof v.toDate === "function") date = v.toDate();
    else if (typeof v.seconds === "number") date = new Date(v.seconds * 1000);
    else if (typeof v._seconds === "number") date = new Date(v._seconds * 1000);
  }
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

/**
 * "active" | "suspended" for someone who finished joining, null for a sign-up never finished.
 * Read loosely ("Active", " active "): a record that has the activation date is joined even if its
 * status was written differently. "email_verified" / "awaiting_payment" stay unfinished.
 */
export function joinedStatus(m: { status?: unknown; activatedAt?: unknown; [key: string]: unknown }): "active" | "suspended" | null {
  const status = String(m.status ?? "").trim().toLowerCase();
  if (status === "suspended") return "suspended";
  if (status === "active") return "active";
  if (status !== "email_verified" && status !== "awaiting_payment" && isoDate(m.activatedAt)) return "active";
  return null;
}

/** Members (active / suspended) and the counters. Pure. */
export function memberRowsAndCounts(docs: Array<{ id: string } & Record<string, unknown>>, now: Date): { members: AdminMemberRow[]; counts: AdminMemberCounts } {
  const members: AdminMemberRow[] = [];
  let incomplete = 0;
  for (const m of docs) {
    try {
      const status = joinedStatus(m);
      if (!status) {
        incomplete += 1;
        continue;
      }
      members.push({
        id: m.id,
        memberNumber: String(m.memberNumber ?? ""),
        name: String(m.displayName ?? "").trim(),
        email: String(m.email ?? "").trim(),
        status,
        joinedAt: isoDate(m.activatedAt) ?? isoDate(m.createdAt),
        balancePoints: Math.max(0, Math.floor(Number(m.balancePoints) || 0)),
        coffeeCups: Math.max(0, Math.floor(Number(m.coffeeCups) || 0)),
      });
    } catch (error) {
      // One broken record is left out (and logged); the rest are still listed.
      console.error("[admin/club/members] skipped member", m.id, error instanceof Error ? error.message : error);
    }
  }
  const month = israelMonth(now);
  const joinedThisMonth = members.filter((m) => m.joinedAt && israelMonth(new Date(m.joinedAt)) === month).length;
  members.sort((a, b) => String(b.joinedAt ?? "").localeCompare(String(a.joinedAt ?? "")));
  return { members, counts: { total: members.length, joinedThisMonth, incomplete } };
}

export async function listClubMembers(db: Firestore, now = new Date()) {
  const snap = await db.collection(COLLECTIONS.loyaltyMembers).get();
  return memberRowsAndCounts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })), now);
}

/** Orders that count for the member's totals: not cancelled, not a card order never paid. */
export function isCountedMemberOrder(order: Pick<Order, "status" | "paymentMethod" | "paymentProvider" | "paymentStatus">): boolean {
  return normalizeOrderStatus(order.status) !== "cancelled" && !isUnpaidCardOrder(order);
}

async function memberOrders(db: Firestore, memberId: string): Promise<Order[]> {
  const snap = await db.collection(COLLECTIONS.orders).where("loyalty.memberId", "==", memberId).get();
  return snap.docs
    .map((d) => mapOrder({ id: d.id, ...(d.data() as FirestoreOrder) }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export type WelcomeCodeState = "used" | "active" | "expired" | "none";

export type AdminMemberStats = { orders: number; total: number; welcome: WelcomeCodeState };

export function summarizeMemberOrders(orders: readonly Order[]): { orders: number; total: number } {
  const counted = orders.filter(isCountedMemberOrder);
  return { orders: counted.length, total: Math.round(counted.reduce((s, o) => s + (Number(o.total) || 0), 0) * 100) / 100 };
}

export function welcomeState(code: string | undefined, coupons: readonly LoyaltyCouponView[]): WelcomeCodeState {
  if (!code) return "none";
  return coupons.find((c) => c.code === code)?.state ?? "none";
}

/** For the rows on screen only (30 at a time): orders, total, the 10% code. */
export async function clubMemberStats(db: Firestore, memberIds: readonly string[], now = new Date()): Promise<Record<string, AdminMemberStats>> {
  const out: Record<string, AdminMemberStats> = {};
  await Promise.all(
    memberIds.map(async (id) => {
      const [member, orders, coupons] = await Promise.all([
        db.collection(COLLECTIONS.loyaltyMembers).doc(id).get(),
        memberOrders(db, id),
        memberCouponViews(db, id, now).catch(() => [] as LoyaltyCouponView[]),
      ]);
      const code = (member.data() as Partial<LoyaltyMember> | undefined)?.welcomeCouponCode;
      out[id] = { ...summarizeMemberOrders(orders), welcome: welcomeState(code, coupons) };
    })
  );
  return out;
}

export type AdminMemberOrder = {
  id: string;
  orderNumber: string;
  createdAt: string;
  orderType: string;
  total: number;
  status: string;
  paymentStatus: string;
  counted: boolean;
};

/** One member's details: orders, points history, personal coupons. */
export async function clubMemberDetail(
  db: Firestore,
  memberId: string,
  now = new Date()
): Promise<{ orders: AdminMemberOrder[]; history: LoyaltyLedgerEntry[]; coupons: LoyaltyCouponView[] } | null> {
  const member = await db.collection(COLLECTIONS.loyaltyMembers).doc(memberId).get();
  if (!member.exists) return null;
  const [orders, history, coupons] = await Promise.all([
    memberOrders(db, memberId),
    readMemberHistory(db, memberId, 100),
    memberCouponViews(db, memberId, now).catch(() => [] as LoyaltyCouponView[]),
  ]);
  return {
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      orderType: String(o.orderType ?? "pickup"),
      total: Number(o.total) || 0,
      status: normalizeOrderStatus(o.status),
      paymentStatus: String(o.paymentStatus ?? "pending"),
      counted: isCountedMemberOrder(o),
    })),
    history,
    coupons,
  };
}
