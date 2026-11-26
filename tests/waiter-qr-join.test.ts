// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createFakeFirestore } from "./helpers/fake-firestore";
import {
  JOIN_KEY_PATTERN,
  joinKeyHash,
  joinKeyMatches,
  newJoinKey,
  nextWaiterDeviceName,
  waiterJoinUrl,
} from "@/lib/staff/waiter-join";
import { readDeviceSession } from "@/lib/staff/device";
import { parseStaffAdminRequest } from "@/lib/staff/admin-input";
import { handleStaffLogin } from "@/lib/staff/login";

const fake = createFakeFirestore();
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fake.db }));
const devices = await import("@/lib/staff/admin/devices");
const db = fake.db as unknown as Parameters<typeof devices.joinWaiterDevice>[0];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const NOW = new Date("2026-11-26T08:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("waiters' QR secret", () => {
  it("long and random; kept for checking only as a keyed hash", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newJoinKey()));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key).toMatch(JOIN_KEY_PATTERN);
    const key = [...keys][0]!;
    const hash = joinKeyHash(key);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(key);
    expect(joinKeyMatches(key, { keyHash: hash })).toBe(true);
    expect(joinKeyMatches(newJoinKey(), { keyHash: hash })).toBe(false);
    for (const bad of ["", "short", `${key}x`, null, 5, undefined]) expect(joinKeyMatches(bad, { keyHash: hash })).toBe(false);
    expect(joinKeyMatches(key, null)).toBe(false);
  });

  it("link and device names", () => {
    expect(waiterJoinUrl("https://mishkatcafe.dev/", "abc")).toBe("https://mishkatcafe.dev/staff/join?k=abc");
    expect(nextWaiterDeviceName([])).toBe("טלפון מלצרית 1");
    expect(nextWaiterDeviceName(["טלפון מלצרית 1", "טלפון מלצרית 3", "טאבלט בר"])).toBe("טלפון מלצרית 2");
    expect(nextWaiterDeviceName(["טלפון מלצרית 1", "טלפון מלצרית 2"])).toBe("טלפון מלצרית 3");
  });
});

describe("joining, renewing, replacing (in-memory database)", () => {
  beforeEach(() => fake.reset());

  it("first view makes the QR once; the same QR is shown again (re-download)", async () => {
    const a = await devices.getOrCreateWaiterJoinKey(db, { actor: "admin@x", now: NOW });
    const b = await devices.getOrCreateWaiterJoinKey(db, { actor: "admin@x", now: NOW });
    expect(b).toEqual(a);
    expect(a.version).toBe(1);
    const stored = fake.get("staffJoinKeys", "waiter")!;
    expect(stored.keyHash).toBe(joinKeyHash(a.key));
  });

  it("scan → connected for 90 days as 'טלפון מלצרית N'; a wrong or missing key connects nothing", async () => {
    const { key } = await devices.getOrCreateWaiterJoinKey(db, { actor: "admin", now: NOW });
    expect(await devices.joinWaiterDevice(db, { key: newJoinKey(), now: NOW })).toEqual({ ok: false, code: "INVALID_KEY" });
    expect(await devices.joinWaiterDevice(db, { key: undefined, now: NOW })).toEqual({ ok: false, code: "INVALID_KEY" });

    const one = await devices.joinWaiterDevice(db, { key, now: NOW });
    const two = await devices.joinWaiterDevice(db, { key, now: NOW });
    expect(one.ok && two.ok).toBe(true);
    if (!one.ok || !two.ok) return;
    expect([one.device.name, two.device.name]).toEqual(["טלפון מלצרית 1", "טלפון מלצרית 2"]);
    expect(one.device.source).toBe("qr");
    expect(Date.parse(one.device.expiresAt) - NOW.getTime()).toBe(90 * DAY);
    expect(one.cookie.maxAgeSeconds).toBe(90 * 24 * 60 * 60);
    const seen = await devices.readStaffDevice(db, one.cookie.value, NOW);
    expect(seen?.name).toBe("טלפון מלצרית 1");
  });

  it("scanning again on the same device renews it (same device, same name, 90 days from now)", async () => {
    const { key } = await devices.getOrCreateWaiterJoinKey(db, { actor: "admin", now: NOW });
    const first = await devices.joinWaiterDevice(db, { key, now: NOW });
    if (!first.ok) throw new Error("join");
    const later = new Date(NOW.getTime() + 30 * DAY);
    const again = await devices.joinWaiterDevice(db, { key, deviceCookie: first.cookie.value, now: later });
    if (!again.ok) throw new Error("renew");
    expect(again.renewed).toBe(true);
    expect(again.device.id).toBe(first.device.id);
    expect(again.device.name).toBe("טלפון מלצרית 1");
    expect(Date.parse(again.device.expiresAt) - later.getTime()).toBe(90 * DAY);
    expect(readDeviceSession(again.cookie.value, later.getTime())?.deviceId).toBe(first.device.id);
    expect((await devices.listDevices(db, later)).length).toBe(1);
  });

  it("Replace QR: the old QR stops working and every QR device is disconnected; old code devices are kept", async () => {
    const { key: oldKey } = await devices.getOrCreateWaiterJoinKey(db, { actor: "admin", now: NOW });
    const a = await devices.joinWaiterDevice(db, { key: oldKey, now: NOW });
    const b = await devices.joinWaiterDevice(db, { key: oldKey, now: NOW });
    if (!a.ok || !b.ok) throw new Error("join");
    // A tablet linked earlier with a 6-digit code.
    fake.put("staffDevices", "OldTablet0001", {
      name: "טאבלט בר",
      role: "waiter",
      active: true,
      sessionVersion: 1,
      createdAt: NOW.toISOString(),
      createdBy: "admin",
      expiresAt: new Date(NOW.getTime() + 10 * DAY).toISOString(),
      lastSeenAt: null,
    });

    const next = await devices.rotateWaiterJoinKey(db, { actor: "admin", now: NOW });
    expect(next.version).toBe(2);
    expect(next.key).not.toBe(oldKey);
    expect(next.disconnected).toBe(2);
    expect(await devices.readStaffDevice(db, a.cookie.value, NOW)).toBeNull();
    expect(await devices.readStaffDevice(db, b.cookie.value, NOW)).toBeNull();
    expect(await devices.joinWaiterDevice(db, { key: oldKey, now: NOW })).toEqual({ ok: false, code: "INVALID_KEY" });
    // An old QR device scanning the new QR is added again (its old sign-in is not renewed).
    const back = await devices.joinWaiterDevice(db, { key: next.key, deviceCookie: a.cookie.value, now: NOW });
    expect(back.ok && !back.renewed && back.device.name === "טלפון מלצרית 1").toBe(true);
    expect((await devices.listDevices(db, NOW)).map((d) => d.name).sort()).toEqual(["טאבלט בר", "טלפון מלצרית 1"]);
  });

  it("rename and disconnect one device", async () => {
    const { key } = await devices.getOrCreateWaiterJoinKey(db, { actor: "admin", now: NOW });
    const a = await devices.joinWaiterDevice(db, { key, now: NOW });
    if (!a.ok) throw new Error("join");
    expect(await devices.renameDevice(db, a.device.id, "טאבלט קופה")).toBe(true);
    expect((await devices.readStaffDevice(db, a.cookie.value, NOW))?.name).toBe("טאבלט קופה");
    expect(await devices.revokeDevice(db, a.device.id)).toBe(true);
    expect(await devices.readStaffDevice(db, a.cookie.value, NOW)).toBeNull();
    expect(await devices.renameDevice(db, a.device.id, "x")).toBe(false);
    expect(await devices.listDevices(db, NOW)).toEqual([]);
  });

  it("a device past its 90 days is no longer connected or listed", async () => {
    const { key } = await devices.getOrCreateWaiterJoinKey(db, { actor: "admin", now: NOW });
    const a = await devices.joinWaiterDevice(db, { key, now: NOW });
    if (!a.ok) throw new Error("join");
    const after = new Date(NOW.getTime() + 91 * DAY);
    expect(await devices.readStaffDevice(db, a.cookie.value, after)).toBeNull();
    expect(await devices.listDevices(db, after)).toEqual([]);
  });
});

describe("waiters have no code; couriers keep theirs", () => {
  it("Staff page: a waiter is created without a code; a courier still needs one", () => {
    expect(parseStaffAdminRequest({ action: "create", name: "רנא", phone: "0501234567", role: "waiter" })).toEqual({
      ok: true,
      request: { action: "create", name: "רנא", phone: "0501234567", role: "waiter" },
    });
    expect(parseStaffAdminRequest({ action: "create", name: "סאמי", phone: "0501234567", role: "courier" })).toEqual({ ok: false, error: "PIN_FORMAT" });
  });

  it("an old waiter code at the keypad is a wrong code", async () => {
    const res = await handleStaffLogin({ pin: "4821", for: "waiter" }, "1.1.1.1", {
      blockedFor: async () => null,
      recordFailure: async () => 4,
      clearFailures: async () => {},
      // The store no longer returns waiters (see findActiveStaffByPinHash).
      findActiveByPinHash: async () => null,
      hashPin: (pin) => pin,
    });
    expect(res.status).toBe(401);
    const store = read("src/lib/staff/admin/store.ts");
    expect(store).toContain('(d.data() as StaffMemberDoc).role !== "waiter"');
    expect(store).toContain('if (data.role === "waiter") return null;');
    expect(store).toContain('return { ok: false as const, code: "WAITER_NO_PIN" as const }');
  });
});

describe("wiring", () => {
  it("the join page takes the secret off the address bar first and never sends it to other sites", () => {
    const screen = read("src/features/staff/waiter-join-screen.tsx");
    const replaceAt = screen.indexOf('window.history.replaceState(null, "", "/staff/join")');
    expect(replaceAt).toBeGreaterThan(0);
    expect(replaceAt).toBeLessThan(screen.indexOf('fetch("/api/staff/device/join"'));
    expect(screen).toContain('router.replace("/staff?for=waiter")');
    const page = read("src/app/staff/join/page.tsx");
    expect(page).toContain('referrer: "no-referrer"');
    expect(page).toContain("robots: { index: false, follow: false }");
  });

  it("the secret QR is on the QR page only, behind the admin-only API", () => {
    const qr = read("src/features/admin/qr-links-admin.tsx");
    expect(qr).toContain("<QrLinksGrid withWaiters />");
    expect(qr).toContain("{withWaiters ? <WaiterQrCard index={links.length} /> : null}");
    expect(read("src/features/admin/admin-dashboard.tsx")).toContain("<QrLinksGrid />");
    const card = read("src/features/admin/waiter-qr-card.tsx");
    expect(card).toContain('clientAdminFetch<{ qr: WaiterQr }>("/api/admin/staff", { action })');
    expect(card).toContain("data-waiter-qr-replace-yes");
    // Server only: no browser rule opens the secret.
    expect(read("firestore.rules")).not.toContain("staffJoinKeys");
  });

  it("every new text exists in Hebrew, Arabic and English", async () => {
    const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
    const { UI_TRANSLATIONS_SEED } = await import("@/data/ui-translations-seed");
    for (const [source, prefix] of [[ADMIN_TRANSLATIONS, "admin.waiterQr."], [ADMIN_TRANSLATIONS, "admin.devices."], [UI_TRANSLATIONS_SEED, "waiter.join."]] as const) {
      const keys = (m: Record<string, string>) => Object.keys(m).filter((k) => k.startsWith(prefix)).sort();
      expect(keys(source.he).length).toBeGreaterThan(0);
      expect(keys(source.ar)).toEqual(keys(source.he));
      expect(keys(source.en)).toEqual(keys(source.he));
    }
    expect(ADMIN_TRANSLATIONS.he["admin.staff.waiterNoCode"]).toBeTruthy();
  });
});
