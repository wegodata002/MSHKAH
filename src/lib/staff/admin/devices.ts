import type { Firestore } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/firebase/collections";
import {
  readDeviceSession,
  signDeviceSession,
  toDeviceView,
  type StaffDeviceDoc,
  type StaffDeviceView,
} from "@/lib/staff/device";
import {
  joinKeyHash,
  joinKeyMatches,
  newJoinKey,
  nextWaiterDeviceName,
  WAITER_JOIN_KEY_DOC,
  type WaiterJoinKeyDoc,
} from "@/lib/staff/waiter-join";

/** Server-only (Admin SDK) waiter devices: the QR secret, joining, list, rename, disconnect. */

const LAST_SEEN_EVERY_MS = 5 * 60 * 1000;

function keyRef(db: Firestore) {
  return db.collection(COLLECTIONS.staffJoinKeys).doc(WAITER_JOIN_KEY_DOC);
}

/** The current waiters' QR secret; made the first time the admin opens it. */
export async function getOrCreateWaiterJoinKey(db: Firestore, input: { actor: string; now?: Date }): Promise<{ key: string; version: number; createdAt: string }> {
  const now = input.now ?? new Date();
  return db.runTransaction(async (tx) => {
    const existing = (await tx.get(keyRef(db))).data() as WaiterJoinKeyDoc | undefined;
    if (existing?.key) return { key: existing.key, version: existing.version, createdAt: existing.createdAt };
    const key = newJoinKey();
    const doc: WaiterJoinKeyDoc = { key, keyHash: joinKeyHash(key), version: 1, createdAt: now.toISOString(), createdBy: input.actor };
    tx.set(keyRef(db), doc);
    return { key, version: 1, createdAt: doc.createdAt };
  });
}

/**
 * "Replace QR": a new secret (the printed one stops working) and every device that joined with a
 * QR is disconnected at once. Devices linked earlier with a 6-digit code are not touched.
 */
export async function rotateWaiterJoinKey(
  db: Firestore,
  input: { actor: string; now?: Date }
): Promise<{ key: string; version: number; createdAt: string; disconnected: number }> {
  const now = input.now ?? new Date();
  const next = await db.runTransaction(async (tx) => {
    const existing = (await tx.get(keyRef(db))).data() as WaiterJoinKeyDoc | undefined;
    const key = newJoinKey();
    const doc: WaiterJoinKeyDoc = {
      key,
      keyHash: joinKeyHash(key),
      version: (existing?.version ?? 0) + 1,
      createdAt: now.toISOString(),
      createdBy: input.actor,
    };
    tx.set(keyRef(db), doc);
    return doc;
  });
  const devices = await db.collection(COLLECTIONS.staffDevices).where("source", "==", "qr").get();
  const active = devices.docs.filter((d) => (d.data() as StaffDeviceDoc).active);
  for (let i = 0; i < active.length; i += 400) {
    const batch = db.batch();
    for (const d of active.slice(i, i + 400)) {
      const data = d.data() as StaffDeviceDoc;
      batch.update(d.ref, { active: false, sessionVersion: (data.sessionVersion ?? 1) + 1 });
    }
    await batch.commit();
  }
  return { key: next.key, version: next.version, createdAt: next.createdAt, disconnected: active.length };
}

export type JoinResult =
  | { ok: true; renewed: boolean; cookie: { value: string; maxAgeSeconds: number }; device: StaffDeviceView }
  | { ok: false; code: "INVALID_KEY" };

/**
 * A device scanned the waiters' QR. A device already joined with the current QR gets 90 more days
 * (same name); any other device is added as "טלפון מלצרית N".
 */
export async function joinWaiterDevice(
  db: Firestore,
  input: { key: unknown; deviceCookie?: string | null; now?: Date }
): Promise<JoinResult> {
  const now = input.now ?? new Date();
  const session = readDeviceSession(input.deviceCookie, now.getTime());
  return db.runTransaction(async (tx) => {
    const keyDoc = (await tx.get(keyRef(db))).data() as WaiterJoinKeyDoc | undefined;
    if (!joinKeyMatches(input.key, keyDoc)) return { ok: false as const, code: "INVALID_KEY" as const };

    // Scanned again on a device that is still connected with this QR: renew it.
    if (session) {
      const ref = db.collection(COLLECTIONS.staffDevices).doc(session.deviceId);
      const doc = (await tx.get(ref)).data() as StaffDeviceDoc | undefined;
      if (
        doc &&
        doc.active &&
        doc.source === "qr" &&
        doc.joinVersion === keyDoc!.version &&
        doc.sessionVersion === session.sessionVersion &&
        Date.parse(doc.expiresAt) > now.getTime()
      ) {
        const cookie = signDeviceSession({ deviceId: ref.id, sessionVersion: doc.sessionVersion, now: now.getTime() });
        tx.update(ref, { expiresAt: cookie.expiresAt, lastSeenAt: now.toISOString() });
        return {
          ok: true as const,
          renewed: true,
          cookie: { value: cookie.value, maxAgeSeconds: cookie.maxAgeSeconds },
          device: toDeviceView(ref.id, { ...doc, expiresAt: cookie.expiresAt, lastSeenAt: now.toISOString() }),
        };
      }
    }

    const connected = await tx.get(db.collection(COLLECTIONS.staffDevices).where("active", "==", true));
    const name = nextWaiterDeviceName(connected.docs.map((d) => String((d.data() as StaffDeviceDoc).name ?? "")));
    const ref = db.collection(COLLECTIONS.staffDevices).doc();
    const cookie = signDeviceSession({ deviceId: ref.id, sessionVersion: 1, now: now.getTime() });
    const doc: StaffDeviceDoc = {
      name,
      role: "waiter",
      active: true,
      sessionVersion: 1,
      createdAt: now.toISOString(),
      createdBy: "waiter-qr",
      expiresAt: cookie.expiresAt,
      lastSeenAt: now.toISOString(),
      source: "qr",
      joinVersion: keyDoc!.version,
    };
    tx.set(ref, doc);
    return { ok: true as const, renewed: false, cookie: { value: cookie.value, maxAgeSeconds: cookie.maxAgeSeconds }, device: toDeviceView(ref.id, doc) };
  });
}

/** The device behind the cookie: still connected (not disconnected, not expired). */
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

/** Connected devices (not disconnected, not past their end date), newest first. */
export async function listDevices(db: Firestore, now = new Date()): Promise<StaffDeviceView[]> {
  const snap = await db.collection(COLLECTIONS.staffDevices).where("active", "==", true).get();
  return snap.docs
    .map((d) => toDeviceView(d.id, d.data() as StaffDeviceDoc))
    .filter((d) => Date.parse(d.expiresAt) > now.getTime())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Rename a connected device (its actions from now on carry the new name). */
export async function renameDevice(db: Firestore, deviceId: string, name: string): Promise<boolean> {
  const ref = db.collection(COLLECTIONS.staffDevices).doc(deviceId);
  return db.runTransaction(async (tx) => {
    const doc = (await tx.get(ref)).data() as StaffDeviceDoc | undefined;
    if (!doc || !doc.active) return false;
    tx.update(ref, { name });
    return true;
  });
}

/** Disconnect: the device is signed out on its next request. */
export async function revokeDevice(db: Firestore, deviceId: string): Promise<boolean> {
  const ref = db.collection(COLLECTIONS.staffDevices).doc(deviceId);
  return db.runTransaction(async (tx) => {
    const doc = (await tx.get(ref)).data() as StaffDeviceDoc | undefined;
    if (!doc) return false;
    tx.update(ref, { active: false, sessionVersion: (doc.sessionVersion ?? 1) + 1 });
    return true;
  });
}
