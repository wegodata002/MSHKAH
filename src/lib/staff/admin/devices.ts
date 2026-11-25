import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  checkPairing,
  newPairingCode,
  pairingCodeHash,
  PAIRING_CODE_TTL_MS,
  readDeviceSession,
  signDeviceSession,
  toDeviceView,
  type DevicePairingDoc,
  type StaffDeviceDoc,
  type StaffDeviceView,
} from "@/lib/staff/device";

/** Server-only (Admin SDK) fixed devices: pairing, reading the device cookie, list, disconnect. */

const LAST_SEEN_EVERY_MS = 5 * 60 * 1000;

export async function createPairing(db: Firestore, input: { deviceName: string; actor: string; now?: Date }): Promise<{ code: string; expiresAt: string }> {
  const now = input.now ?? new Date();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newPairingCode();
    const ref = db.collection(COLLECTIONS.staffDevicePairings).doc(pairingCodeHash(code));
    const created = await db.runTransaction(async (tx) => {
      const existing = (await tx.get(ref)).data() as DevicePairingDoc | undefined;
      // A code still waiting to be used is never reused for another device.
      if (existing && !existing.used && now.getTime() < existing.expiresAtMs) return false;
      const doc: DevicePairingDoc = {
        deviceName: input.deviceName,
        createdAt: now.toISOString(),
        createdBy: input.actor,
        expiresAtMs: now.getTime() + PAIRING_CODE_TTL_MS,
        used: false,
      };
      tx.set(ref, doc);
      return true;
    });
    if (created) return { code, expiresAt: new Date(now.getTime() + PAIRING_CODE_TTL_MS).toISOString() };
  }
  throw new Error("could not create a pairing code");
}

export type PairResult =
  | { ok: true; cookie: { value: string; maxAgeSeconds: number }; device: StaffDeviceView }
  | { ok: false; code: "INVALID_CODE" | "EXPIRED" | "USED" };

/** The tablet typed a pairing code: link it as a fixed device for 30 days (one use per code). */
export async function pairDevice(db: Firestore, input: { code: string; now?: Date }): Promise<PairResult> {
  const now = input.now ?? new Date();
  const pairingRef = db.collection(COLLECTIONS.staffDevicePairings).doc(pairingCodeHash(input.code));
  const deviceRef = db.collection(COLLECTIONS.staffDevices).doc();
  return db.runTransaction(async (tx) => {
    const pairing = (await tx.get(pairingRef)).data() as DevicePairingDoc | undefined;
    const check = checkPairing(pairing, now.getTime());
    if (!check.ok) return check;
    const session = signDeviceSession({ deviceId: deviceRef.id, sessionVersion: 1, now: now.getTime() });
    const device: StaffDeviceDoc = {
      name: pairing!.deviceName,
      role: "waiter",
      active: true,
      sessionVersion: 1,
      createdAt: now.toISOString(),
      createdBy: pairing!.createdBy,
      expiresAt: session.expiresAt,
      lastSeenAt: now.toISOString(),
    };
    tx.set(deviceRef, device);
    tx.update(pairingRef, { used: true });
    return { ok: true as const, cookie: { value: session.value, maxAgeSeconds: session.maxAgeSeconds }, device: toDeviceView(deviceRef.id, device) };
  });
}

/** The fixed device behind the cookie: still connected (not disconnected, not expired). */
export async function readStaffDevice(db: Firestore, cookieValue: string | null | undefined, now = new Date()): Promise<StaffDeviceView | null> {
  const session = readDeviceSession(cookieValue, now.getTime());
  if (!session) return null;
  const ref = db.collection(COLLECTIONS.staffDevices).doc(session.deviceId);
  const snap = await ref.get();
  const doc = snap.data() as StaffDeviceDoc | undefined;
  if (!doc || !doc.active || doc.sessionVersion !== session.sessionVersion || Date.parse(doc.expiresAt) <= now.getTime()) return null;
  // "Last seen" for the admin list, at most every 5 minutes.
  if (!doc.lastSeenAt || now.getTime() - Date.parse(doc.lastSeenAt) > LAST_SEEN_EVERY_MS) {
    await ref.update({ lastSeenAt: now.toISOString() }).catch(() => undefined);
  }
  return toDeviceView(snap.id, doc);
}

export async function listDevices(db: Firestore): Promise<StaffDeviceView[]> {
  const snap = await db.collection(COLLECTIONS.staffDevices).get();
  return snap.docs
    .map((d) => toDeviceView(d.id, d.data() as StaffDeviceDoc))
    .filter((d) => d.active)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Disconnect: the tablet is signed out on its next request. */
export async function revokeDevice(db: Firestore, deviceId: string): Promise<boolean> {
  const ref = db.collection(COLLECTIONS.staffDevices).doc(deviceId);
  return db.runTransaction(async (tx) => {
    const doc = (await tx.get(ref)).data() as StaffDeviceDoc | undefined;
    if (!doc) return false;
    tx.update(ref, { active: false, sessionVersion: (doc.sessionVersion ?? 1) + 1 });
    return true;
  });
}
