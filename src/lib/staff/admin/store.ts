import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { rateLimitKey } from "@/lib/loyalty/admin/rate-limit";
import { hashPin } from "@/lib/staff/pin";
import { readStaffSession } from "@/lib/staff/session";
import { STAFF_LOGIN_LIMITS } from "@/lib/staff/login";
import { jerusalemDate, toStaffView, type StaffMemberDoc, type StaffMemberView, type StaffRole } from "@/lib/staff/types";

/** Server-only access to `staffMembers` (Admin SDK). The browser never reads this collection. */

function staffCol(db: Firestore) {
  return db.collection(COLLECTIONS.staffMembers);
}

export async function listStaff(db: Firestore): Promise<StaffMemberView[]> {
  const snap = await staffCol(db).get();
  return snap.docs
    .map((doc) => toStaffView(doc.id, doc.data() as StaffMemberDoc))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name, "he"));
}

/** Is this code already someone else's? (codes are unique: sign-in is by code alone) */
async function pinInUse(db: Firestore, pinHash: string, exceptId?: string): Promise<boolean> {
  const snap = await staffCol(db).where("pinHash", "==", pinHash).limit(2).get();
  return snap.docs.some((doc) => doc.id !== exceptId);
}

export type StaffWriteResult = { ok: true; member: StaffMemberView } | { ok: false; code: "PIN_IN_USE" | "NOT_FOUND" };

export async function createStaff(
  db: Firestore,
  input: { name: string; phone: string; role: StaffRole; pin: string; actor: string }
): Promise<StaffWriteResult> {
  const pinHash = hashPin(input.pin);
  if (await pinInUse(db, pinHash)) return { ok: false, code: "PIN_IN_USE" };
  const now = new Date().toISOString();
  const doc: StaffMemberDoc = {
    name: input.name,
    phone: input.phone,
    role: input.role,
    active: true,
    pinHash,
    pinSetAt: now,
    sessionVersion: 1,
    workingDate: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: input.actor,
  };
  const ref = await staffCol(db).add(doc);
  return { ok: true, member: toStaffView(ref.id, doc) };
}

export async function updateStaff(
  db: Firestore,
  input: { id: string; name?: string; phone?: string; role?: StaffRole; active?: boolean; worksToday?: boolean; actor: string }
): Promise<StaffWriteResult> {
  const ref = staffCol(db).doc(input.id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, code: "NOT_FOUND" as const };
    const current = snap.data() as StaffMemberDoc;
    const patch: Partial<StaffMemberDoc> = { updatedAt: new Date().toISOString(), updatedBy: input.actor };
    if (input.name !== undefined) patch.name = input.name;
    if (input.phone !== undefined) patch.phone = input.phone;
    if (input.role !== undefined) patch.role = input.role;
    if (input.active !== undefined && input.active !== current.active) {
      patch.active = input.active;
      // Disabled: every open login of this member ends now.
      if (!input.active) patch.sessionVersion = (current.sessionVersion ?? 1) + 1;
    }
    if (input.worksToday !== undefined) patch.workingDate = input.worksToday ? jerusalemDate() : null;
    tx.update(ref, patch);
    return { ok: true as const, member: toStaffView(ref.id, { ...current, ...patch }) };
  });
}

/** New code: replaces the old one and ends every open login of this member. */
export async function setStaffPin(db: Firestore, input: { id: string; pin: string; actor: string }): Promise<StaffWriteResult> {
  const pinHash = hashPin(input.pin);
  if (await pinInUse(db, pinHash, input.id)) return { ok: false, code: "PIN_IN_USE" };
  const ref = staffCol(db).doc(input.id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, code: "NOT_FOUND" as const };
    const current = snap.data() as StaffMemberDoc;
    const now = new Date().toISOString();
    const patch: Partial<StaffMemberDoc> = {
      pinHash,
      pinSetAt: now,
      sessionVersion: (current.sessionVersion ?? 1) + 1,
      updatedAt: now,
      updatedBy: input.actor,
    };
    tx.update(ref, patch);
    return { ok: true as const, member: toStaffView(ref.id, { ...current, ...patch }) };
  });
}

export async function findActiveStaffByPinHash(db: Firestore, pinHash: string) {
  const snap = await staffCol(db).where("pinHash", "==", pinHash).limit(2).get();
  const doc = snap.docs.find((d) => (d.data() as StaffMemberDoc).active);
  if (!doc) return null;
  const data = doc.data() as StaffMemberDoc;
  return { id: doc.id, name: data.name, role: data.role, sessionVersion: data.sessionVersion ?? 1 };
}

/** The signed-in staff member behind the cookie: still active and the login not ended since. */
export async function readStaffMember(db: Firestore, cookieValue: string | null | undefined) {
  const session = readStaffSession(cookieValue);
  if (!session) return null;
  const snap = await staffCol(db).doc(session.staffId).get();
  if (!snap.exists) return null;
  const data = snap.data() as StaffMemberDoc;
  if (!data.active || (data.sessionVersion ?? 1) !== session.sessionVersion) return null;
  return toStaffView(snap.id, data);
}

// ---- wrong-code counting (per address and for all addresses together) ----

function failureKeys(ip: string) {
  return {
    ip: rateLimitKey(["staff-login", "ip", ip || "unknown"]),
    all: rateLimitKey(["staff-login", "all"]),
  };
}

type Bucket = { windowStartMs?: number; count?: number };

function waitSeconds(bucket: Bucket | undefined, limit: number, now: number): number | null {
  const start = Number(bucket?.windowStartMs ?? 0);
  const windowEnd = start + STAFF_LOGIN_LIMITS.windowSeconds * 1000;
  if (!start || now >= windowEnd) return null;
  return Number(bucket?.count ?? 0) >= limit ? Math.max(1, Math.ceil((windowEnd - now) / 1000)) : null;
}

export async function staffLoginBlockedFor(db: Firestore, ip: string, now = Date.now()): Promise<number | null> {
  const keys = failureKeys(ip);
  const col = db.collection(COLLECTIONS.loyaltyRateLimit);
  const [ipSnap, allSnap] = await Promise.all([col.doc(keys.ip).get(), col.doc(keys.all).get()]);
  const waits = [
    waitSeconds(ipSnap.data() as Bucket | undefined, STAFF_LOGIN_LIMITS.perIp, now),
    waitSeconds(allSnap.data() as Bucket | undefined, STAFF_LOGIN_LIMITS.all, now),
  ].filter((w): w is number => w !== null);
  return waits.length ? Math.max(...waits) : null;
}

/** Count one wrong code; answers the tries this address has left in the window. */
export async function recordStaffLoginFailure(db: Firestore, ip: string, now = Date.now()): Promise<number> {
  const keys = failureKeys(ip);
  const col = db.collection(COLLECTIONS.loyaltyRateLimit);
  const bump = async (key: string) =>
    db.runTransaction(async (tx) => {
      const ref = col.doc(key);
      const bucket = (await tx.get(ref)).data() as Bucket | undefined;
      const start = Number(bucket?.windowStartMs ?? 0);
      const open = start > 0 && now - start < STAFF_LOGIN_LIMITS.windowSeconds * 1000;
      const count = open ? Number(bucket?.count ?? 0) + 1 : 1;
      tx.set(ref, { windowStartMs: open ? start : now, count, updatedAt: new Date(now).toISOString() });
      return count;
    });
  const [ipCount] = await Promise.all([bump(keys.ip), bump(keys.all)]);
  return Math.max(0, STAFF_LOGIN_LIMITS.perIp - ipCount);
}

export async function clearStaffLoginFailures(db: Firestore, ip: string): Promise<void> {
  await db.collection(COLLECTIONS.loyaltyRateLimit).doc(failureKeys(ip).ip).delete().catch(() => undefined);
}
