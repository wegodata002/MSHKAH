// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hashPin, isValidPinFormat, isWeakPin } from "@/lib/staff/pin";
import { readStaffSession, signStaffSession, STAFF_SESSION_TTL_SECONDS } from "@/lib/staff/session";
import { handleStaffLogin, STAFF_LOGIN_LIMITS, type StaffLoginDeps } from "@/lib/staff/login";
import { parseStaffAdminRequest } from "@/lib/staff/admin-input";
import { jerusalemDate, toStaffView, type StaffMemberDoc } from "@/lib/staff/types";
import { readClubSession } from "@/lib/loyalty/session";
import { readTrackingToken } from "@/lib/orders/tracking-token";
import { shouldHideCustomerChrome } from "@/lib/domains/host-routing";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("personal code", () => {
  it("exactly 4 digits", () => {
    expect(isValidPinFormat("4827")).toBe(true);
    for (const bad of ["482", "48270", "48a7", "", " 4827", 4827, null]) expect(isValidPinFormat(bad), String(bad)).toBe(false);
  });

  it("refuses codes too easy to guess", () => {
    for (const weak of ["0000", "7777", "1234", "4321", "0123", "6789", "9876"]) expect(isWeakPin(weak), weak).toBe(true);
    for (const ok of ["4827", "1243", "9090", "1357"]) expect(isWeakPin(ok), ok).toBe(false);
  });

  it("stored as a keyed hash: same code → same hash, never the code itself", () => {
    expect(hashPin("4827")).toBe(hashPin("4827"));
    expect(hashPin("4827")).not.toBe(hashPin("4828"));
    expect(hashPin("4827")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPin("4827")).not.toContain("4827");
  });
});

describe("staff login cookie (12 hours)", () => {
  const now = Date.parse("2026-11-26T08:00:00Z");

  it("round-trips, expires after 12 hours", () => {
    const { value, maxAgeSeconds } = signStaffSession({ staffId: "StaffAbc123", sessionVersion: 3, now });
    expect(maxAgeSeconds).toBe(STAFF_SESSION_TTL_SECONDS);
    expect(STAFF_SESSION_TTL_SECONDS).toBe(12 * 60 * 60);
    expect(readStaffSession(value, now + 1000)).toEqual({ staffId: "StaffAbc123", sessionVersion: 3 });
    expect(readStaffSession(value, now + 12 * 3600 * 1000 + 1)).toBeNull();
  });

  it("rejects anything changed, and never passes as a club cookie or a tracking link", () => {
    const { value } = signStaffSession({ staffId: "StaffAbc123", sessionVersion: 3, now });
    expect(readStaffSession(value.replace(".3.", ".4."), now)).toBeNull(); // version bumped by hand
    expect(readStaffSession(value.replace("StaffAbc123", "StaffXyz789"), now)).toBeNull();
    expect(readStaffSession(`${value.slice(0, -1)}${value.endsWith("A") ? "B" : "A"}`, now)).toBeNull();
    expect(readStaffSession("", now)).toBeNull();
    expect(readClubSession(value)).toBeNull();
    expect(readTrackingToken(value)).toBeNull();
  });
});

describe("sign-in with the code", () => {
  function deps(state: { failures: number; blockedFor?: number | null }, member: Awaited<ReturnType<StaffLoginDeps["findActiveByPinHash"]>> = null) {
    const calls: string[] = [];
    const d: StaffLoginDeps = {
      blockedFor: async () => state.blockedFor ?? (state.failures >= STAFF_LOGIN_LIMITS.perIp ? 600 : null),
      recordFailure: async () => {
        calls.push("fail");
        state.failures += 1;
        return Math.max(0, STAFF_LOGIN_LIMITS.perIp - state.failures);
      },
      clearFailures: async () => {
        calls.push("clear");
        state.failures = 0;
      },
      findActiveByPinHash: async (h) => (member && h === hashPin("4827") ? member : null),
      hashPin,
    };
    return { d, calls };
  }

  it("right code → signed in, wrong-code count cleared", async () => {
    const state = { failures: 2 };
    const { d, calls } = deps(state, { id: "StaffAbc123", name: "סמיר", role: "courier", sessionVersion: 3 });
    const result = await handleStaffLogin({ pin: "4827" }, "1.2.3.4", d);
    expect(result).toEqual({ status: 200, body: { ok: true, name: "סמיר", role: "courier" }, session: { staffId: "StaffAbc123", sessionVersion: 3 } });
    expect(calls).toEqual(["clear"]);
  });

  it("5 wrong codes → blocked; tries left counted down", async () => {
    const state = { failures: 0 };
    const { d } = deps(state, { id: "StaffAbc123", name: "x", role: "waiter", sessionVersion: 1 });
    const answers = [];
    for (let i = 0; i < 6; i++) answers.push(await handleStaffLogin({ pin: "1111" }, "ip", d));
    expect(answers.slice(0, 4).map((a) => (a.body as { attemptsLeft?: number }).attemptsLeft)).toEqual([4, 3, 2, 1]);
    expect(answers[4]).toMatchObject({ status: 429, body: { code: "BLOCKED" } });
    // Blocked now: even the right code is not checked.
    expect(await handleStaffLogin({ pin: "4827" }, "ip", d)).toMatchObject({ status: 429, body: { code: "BLOCKED", retryAfterSeconds: 600 } });
    expect(STAFF_LOGIN_LIMITS.windowSeconds).toBe(15 * 60);
  });

  it("disabled member's code is answered like a wrong code", async () => {
    const { d } = deps({ failures: 0 }, null);
    expect(await handleStaffLogin({ pin: "4827" }, "ip", d)).toMatchObject({ status: 401, body: { code: "WRONG_PIN" } });
  });

  it("each QR signs in its own role only: the other role's code is refused, not counted, not cleared", async () => {
    const state = { failures: 2 };
    const waiter = deps(state, { id: "StaffWait001", name: "רנא", role: "waiter", sessionVersion: 1 });
    expect(await handleStaffLogin({ pin: "4827", for: "courier" }, "ip", waiter.d)).toEqual({ status: 403, body: { ok: false, code: "WRONG_ROLE", role: "waiter" } });
    // No "for" = the plain /staff link = the couriers' entrance.
    expect(await handleStaffLogin({ pin: "4827" }, "ip", waiter.d)).toMatchObject({ status: 403, body: { code: "WRONG_ROLE" } });
    expect(waiter.calls).toEqual([]);
    expect(state.failures).toBe(2);
    expect(await handleStaffLogin({ pin: "4827", for: "waiter" }, "ip", waiter.d)).toMatchObject({ status: 200, body: { role: "waiter" } });

    const courier = deps({ failures: 0 }, { id: "StaffCour001", name: "סמיר", role: "courier", sessionVersion: 1 });
    expect(await handleStaffLogin({ pin: "4827", for: "waiter" }, "ip", courier.d)).toEqual({ status: 403, body: { ok: false, code: "WRONG_ROLE", role: "courier" } });
    expect(await handleStaffLogin({ pin: "4827", for: "courier" }, "ip", courier.d)).toMatchObject({ status: 200 });
    // A wrong code still counts at either entrance.
    expect(await handleStaffLogin({ pin: "1111", for: "waiter" }, "ip", courier.d)).toMatchObject({ status: 401, body: { code: "WRONG_PIN" } });
  });

  it("the screen sends its entrance and shows the wrong-role message in three languages", () => {
    const screen = readFileSync(resolve(process.cwd(), "src/features/staff/staff-screen.tsx"), "utf8");
    expect(screen).toContain("JSON.stringify({ pin: code, for: audience })");
    expect(screen).toContain('data.member.role === audience');
    expect(screen).toContain('data?.device && audience === "waiter"');
    const ui = readFileSync(resolve(process.cwd(), "src/data/ui-translations-seed.ts"), "utf8");
    for (const key of ["staff.wrongRole.waiter", "staff.wrongRole.courier"]) expect(ui.split(`"${key}":`).length - 1).toBe(3);
  });

  it("bad input is refused without counting or looking up", async () => {
    const { d, calls } = deps({ failures: 0 });
    for (const body of [{ pin: "12" }, { pin: 1234 }, null, "1234"]) {
      expect((await handleStaffLogin(body, "ip", d)).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });
});

describe("admin Staff page requests", () => {
  it("create: name, phone, role and a non-trivial 4-digit code", () => {
    expect(parseStaffAdminRequest({ action: "create", name: "  סמיר   ח. ", phone: "+972 50-123-4567", role: "courier", pin: "4827" })).toEqual({
      ok: true,
      request: { action: "create", name: "סמיר ח.", phone: "0501234567", role: "courier", pin: "4827" },
    });
    expect(parseStaffAdminRequest({ action: "create", name: "x", phone: "0501234567", role: "courier", pin: "1234" })).toEqual({ ok: false, error: "PIN_WEAK" });
    expect(parseStaffAdminRequest({ action: "create", name: "x", phone: "050", role: "courier", pin: "4827" })).toEqual({ ok: false, error: "PHONE" });
    expect(parseStaffAdminRequest({ action: "create", name: "", phone: "0501234567", role: "courier", pin: "4827" })).toEqual({ ok: false, error: "NAME" });
    expect(parseStaffAdminRequest({ action: "create", name: "x", phone: "0501234567", role: "manager", pin: "4827" })).toEqual({ ok: false, error: "ROLE" });
  });

  it("update / set-pin / unknown", () => {
    expect(parseStaffAdminRequest({ action: "update", id: "StaffAbc123", active: false, worksToday: true })).toEqual({
      ok: true,
      request: { action: "update", id: "StaffAbc123", active: false, worksToday: true },
    });
    expect(parseStaffAdminRequest({ action: "update", id: "../x" })).toEqual({ ok: false, error: "ID" });
    expect(parseStaffAdminRequest({ action: "set-pin", id: "StaffAbc123", pin: "48" })).toEqual({ ok: false, error: "PIN_FORMAT" });
    expect(parseStaffAdminRequest({ action: "drop" })).toEqual({ ok: false, error: "ACTION" });
  });

  it("the page never receives the code or its hash; 'working today' resets each day", () => {
    const doc: StaffMemberDoc = {
      name: "סמיר", phone: "0501234567", role: "courier", active: true, pinHash: hashPin("4827"), pinSetAt: "2026-11-26T08:00:00.000Z",
      sessionVersion: 2, workingDate: "2026-11-26", createdAt: "", updatedAt: "", updatedBy: "admin",
    };
    const view = toStaffView("StaffAbc123", doc, new Date("2026-11-26T09:00:00Z"));
    expect(JSON.stringify(view)).not.toContain(doc.pinHash!);
    expect(view).toMatchObject({ hasPin: true, worksToday: true });
    expect(toStaffView("StaffAbc123", doc, new Date("2026-11-27T09:00:00Z")).worksToday).toBe(false);
    expect(toStaffView("StaffAbc123", { ...doc, role: "waiter" }, new Date("2026-11-26T09:00:00Z")).worksToday).toBe(false);
    // Jerusalem day: 23:30 UTC on the 26th is already the 27th there.
    expect(jerusalemDate(new Date("2026-11-26T23:30:00Z"))).toBe("2026-11-27");
  });
});

describe("wiring", () => {
  it("staff pages have no shop chrome; admin API is Admin only; nav entry; staff collection is server only", () => {
    expect(shouldHideCustomerChrome("/staff", "mishkatcafe.dev")).toBe(true);
    expect(shouldHideCustomerChrome("/staffing", "mishkatcafe.dev")).toBe(false);
    expect(read("src/app/api/admin/staff/route.ts")).toMatch(/requireAdminOnly\(request\)/);
    expect(read("src/features/admin/admin-nav-config.ts")).toMatch(/segment: "staff", labelKey: "admin\.staff\.title", icon: IdCard, adminOnly: true/);
    expect(read("firestore.rules")).not.toMatch(/staffMembers/);
    expect(read("firestore.rules")).not.toMatch(/match \/\{document=\*\*\}/);
    expect(read("src/app/staff/page.tsx")).toMatch(/robots: \{ index: false, follow: false \}/);
  });

  it("translations in three languages", () => {
    const ui = read("src/data/ui-translations-seed.ts");
    const admin = read("src/data/admin-translations.ts");
    for (const key of ["staff.enterPin", "staff.wrongPin", "staff.blocked", "staff.logout"]) expect(ui.split(`"${key}":`).length - 1, key).toBe(3);
    for (const key of ["admin.staff.title", "admin.staff.error.PIN_IN_USE", "admin.qr.couriersName", "admin.qr.waitersName"]) {
      expect(admin.split(`"${key}":`).length - 1, key).toBe(3);
    }
  });
});
