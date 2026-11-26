// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/** Admin-only API: a server failure is 503 UNAVAILABLE, never 401 "no permission". */
const state = { verify: (async () => ({ uid: "U1" })) as (t: string) => Promise<{ uid: string; email?: string }>, user: { active: true, role: "Admin", email: "a@x.com", displayName: "A" } as Record<string, unknown> | null, dbFails: false };
vi.mock("@/lib/firebase/admin", () => ({
  verifyIdToken: (t: string) => state.verify(t),
  getAdminDb: () => {
    if (state.dbFails) throw new Error("Firebase Admin credentials missing.");
    return { collection: () => ({ doc: () => ({ get: async () => ({ exists: state.user !== null, data: () => state.user }) }) }) };
  },
}));
const { requireAdminOnly } = await import("@/lib/auth/verify-admin");
const req = (auth?: string) => new NextRequest("http://localhost/api/admin/x", { method: "POST", headers: auth ? { authorization: auth } : {} });
const status = async (r: unknown) => (r instanceof Response ? { status: r.status, body: await r.json() } : "ok");

beforeEach(() => {
  state.verify = async () => ({ uid: "U1" });
  state.user = { active: true, role: "Admin", email: "a@x.com", displayName: "A" };
  state.dbFails = false;
});

describe("requireAdminOnly", () => {
  it("Admin: passes", async () => expect(await status(await requireAdminOnly(req("Bearer t")))).toBe("ok"));

  it("no sign-in, a rejected token (auth/…), no user, inactive: 401; not an Admin: 403", async () => {
    expect(await status(await requireAdminOnly(req()))).toMatchObject({ status: 401 });
    state.verify = async () => {
      throw Object.assign(new Error("expired"), { code: "auth/id-token-expired" });
    };
    expect(await status(await requireAdminOnly(req("Bearer t")))).toMatchObject({ status: 401 });
    state.verify = async () => ({ uid: "U1" });
    state.user = null;
    expect(await status(await requireAdminOnly(req("Bearer t")))).toMatchObject({ status: 401 });
    state.user = { active: false, role: "Admin" };
    expect(await status(await requireAdminOnly(req("Bearer t")))).toMatchObject({ status: 401 });
    state.user = { active: true, role: "Manager" };
    expect(await status(await requireAdminOnly(req("Bearer t")))).toMatchObject({ status: 403 });
  });

  it("no Admin key (verify throws without an auth/ code) or the database failing: 503 UNAVAILABLE", async () => {
    state.verify = async () => {
      throw new Error("Firebase Admin credentials missing.");
    };
    expect(await status(await requireAdminOnly(req("Bearer t")))).toEqual({ status: 503, body: { error: "UNAVAILABLE", code: "UNAVAILABLE" } });
    state.verify = async () => ({ uid: "U1" });
    state.dbFails = true;
    expect(await status(await requireAdminOnly(req("Bearer t")))).toMatchObject({ status: 503 });
  });
});
