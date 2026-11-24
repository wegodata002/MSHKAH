// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Club sign-up / login code, end to end over an in-memory Firestore that is as strict as the
 * real one where it matters:
 *   - writing `undefined` anywhere throws (Admin SDK default),
 *   - a query that would need a composite index throws (two filters, or a filter + orderBy
 *     on another field), like Firestore's "The query requires an index".
 * The real start/verify routes run on top of it; no network, no real database.
 */

// ── Fake Firestore ────────────────────────────────────────────────────
type Data = Record<string, unknown>;
const store = new Map<string, Map<string, Data>>();
const sentEmails: Array<{ to: string; text: string; kind: string }> = [];
const cookieJar: Array<{ name: string; value: string }> = [];

function assertNoUndefined(value: unknown, path: string) {
  if (value === undefined) {
    throw new Error(`Cannot use "undefined" as a Firestore value (found in field "${path}").`);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) assertNoUndefined(v, path ? `${path}.${k}` : k);
  }
}

function collectionMap(name: string) {
  if (!store.has(name)) store.set(name, new Map());
  return store.get(name)!;
}

function docRef(collection: string, id: string) {
  const ref = {
    id,
    __collection: collection,
    async get() {
      const data = collectionMap(collection).get(id);
      return { id, ref, exists: data !== undefined, data: () => (data ? structuredClone(data) : undefined) };
    },
    async set(data: Data, options?: { merge?: boolean }) {
      assertNoUndefined(data, "");
      const prev = collectionMap(collection).get(id);
      collectionMap(collection).set(id, structuredClone(options?.merge && prev ? { ...prev, ...data } : data));
    },
  };
  return ref;
}

type Filter = { field: string; value: unknown };
function query(collection: string, filters: Filter[], order: string | null, max: number | null) {
  return {
    where(field: string, op: string, value: unknown) {
      if (op !== "==") throw new Error("fake supports == only");
      return query(collection, [...filters, { field, value }], order, max);
    },
    orderBy(field: string) {
      return query(collection, filters, field, max);
    },
    limit(n: number) {
      return query(collection, filters, order, n);
    },
    async get() {
      const fields = new Set(filters.map((f) => f.field));
      const needsComposite = fields.size > 1 || (order !== null && fields.size > 0 && !fields.has(order));
      if (needsComposite) {
        throw new Error(`9 FAILED_PRECONDITION: The query requires an index (${collection}).`);
      }
      let docs = [...collectionMap(collection).entries()].filter(([, d]) => filters.every((f) => d[f.field] === f.value));
      if (order) docs.sort((a, b) => String(b[1][order]).localeCompare(String(a[1][order])));
      if (max !== null) docs = docs.slice(0, max);
      return {
        docs: docs.map(([id, d]) => ({ id, ref: docRef(collection, id), exists: true, data: () => structuredClone(d) })),
      };
    },
  };
}

const fakeDb = {
  collection(name: string) {
    return { doc: (id: string) => docRef(name, id), ...query(name, [], null, null) };
  },
  async runTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    const writes: Array<() => Promise<void>> = [];
    const tx = {
      get: (ref: ReturnType<typeof docRef>) => ref.get(),
      set: (ref: ReturnType<typeof docRef>, data: Data, options?: { merge?: boolean }) => {
        assertNoUndefined(data, "");
        writes.push(() => ref.set(data, options));
      },
    };
    const result = await fn(tx);
    for (const write of writes) await write();
    return result;
  },
};

vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fakeDb }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: (c: { name: string; value: string }) => cookieJar.push(c) }),
}));
vi.mock("@/lib/email/send", () => ({
  sendMishkahEmail: async (input: { to: string; text: string; kind: string }) => {
    sentEmails.push(input);
    return { ok: true };
  },
}));

const { POST: start } = await import("@/app/api/club/enroll/start/route");
const { POST: verify } = await import("@/app/api/club/enroll/verify/route");
const { withoutUndefined, pickNewestActiveToken } = await import("@/lib/loyalty/admin/members");

// ── Helpers ───────────────────────────────────────────────────────────
const EMAIL = "Dana@Example.com";
const call = async (handler: (req: never) => Promise<Response>, body: unknown) => {
  const req = {
    json: async () => body,
    headers: new Headers({ "x-forwarded-for": "10.0.0.1" }),
  };
  const res = await handler(req as never);
  return { status: res.status, body: (await res.json()) as { ok: boolean; reason?: string; member?: { status: string } } };
};
const requestCode = async () => {
  await call(start, { email: EMAIL });
  const mail = sentEmails.filter((m) => m.kind === "loyalty_verification").at(-1);
  const code = mail?.text.match(/\b(\d{6})\b/)?.[1];
  if (!code) throw new Error("no code in the email");
  return code;
};
const members = () => [...collectionMap("loyaltyMembers").values()];
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

beforeEach(() => {
  store.clear();
  sentEmails.length = 0;
  cookieJar.length = 0;
  // Sign-up open, as on the live site.
  collectionMap("loyaltySettings").set("app", { enrollmentEnabled: true, earnEnabled: true });
});

// ── Tests ─────────────────────────────────────────────────────────────
describe("club code: send → verify → member → active (strict fake Firestore)", () => {
  it("the right code joins a new member (name, no phone) and opens a session", async () => {
    const code = await requestCode();
    const res = await call(verify, { email: EMAIL, code, displayName: "דנה כהן" });
    expect(res.body).toMatchObject({ ok: true, member: { status: "active" } });
    expect(res.status).toBe(200);
    expect(cookieJar).toHaveLength(1);
    const [member] = members();
    expect(member).toMatchObject({ displayName: "דנה כהן", email: "dana@example.com", status: "active", joinFeeSource: "free" });
    expect("phone" in member).toBe(false);
    expect("joinFeePaymentId" in member).toBe(false);
  });

  it("an existing member logs in with only the email (no name)", async () => {
    await call(verify, { email: EMAIL, code: await requestCode(), displayName: "דנה" });
    const res = await call(verify, { email: EMAIL, code: await requestCode() });
    expect(res.body.ok).toBe(true);
    expect(members()).toHaveLength(1);
  });

  it("a wrong code says mismatch, and the right code still works afterwards", async () => {
    const code = await requestCode();
    expect((await call(verify, { email: EMAIL, code: wrongCode(code), displayName: "דנה" })).body).toEqual({ ok: false, reason: "mismatch" });
    expect((await call(verify, { email: EMAIL, code, displayName: "דנה" })).body.ok).toBe(true);
  });

  it("only the newest code counts after a resend", async () => {
    const first = await requestCode();
    const second = await requestCode();
    if (first !== second) {
      expect((await call(verify, { email: EMAIL, code: first, displayName: "דנה" })).body.reason).toBe("mismatch");
    }
    expect((await call(verify, { email: EMAIL, code: second, displayName: "דנה" })).body.ok).toBe(true);
  });

  it("an expired code says expired", async () => {
    const code = await requestCode();
    for (const token of collectionMap("loyaltyEnrollmentTokens").values()) {
      token.expiresAt = new Date(Date.now() - 60_000).toISOString();
    }
    expect((await call(verify, { email: EMAIL, code, displayName: "דנה" })).body.reason).toBe("expired");
  });

  it("a used code cannot be used again", async () => {
    const code = await requestCode();
    expect((await call(verify, { email: EMAIL, code, displayName: "דנה" })).body.ok).toBe(true);
    const again = await call(verify, { email: EMAIL, code, displayName: "דנה" });
    expect(again.body.ok).toBe(false);
    expect(["no_token", "used"]).toContain(again.body.reason);
  });

  it("5 wrong tries lock the code", async () => {
    const code = await requestCode();
    for (let i = 0; i < 5; i++) await call(verify, { email: EMAIL, code: wrongCode(code), displayName: "דנה" });
    expect((await call(verify, { email: EMAIL, code, displayName: "דנה" })).body.ok).toBe(false);
  });

  it("a crash on our side answers server_error (500), not mismatch", async () => {
    const code = await requestCode();
    const original = fakeDb.runTransaction;
    fakeDb.runTransaction = async () => {
      throw new Error("boom");
    };
    try {
      const res = await call(verify, { email: EMAIL, code, displayName: "דנה" });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ ok: false, reason: "server_error" });
    } finally {
      fakeDb.runTransaction = original;
    }
  });
});

describe("helpers", () => {
  it("withoutUndefined drops only undefined", () => {
    expect(withoutUndefined({ a: 1, b: undefined, c: null, d: "" })).toEqual({ a: 1, c: null, d: "" });
  });

  it("pickNewestActiveToken skips used/expired and takes the latest", () => {
    const doc = (status: string, createdAt: string) => ({ data: () => ({ status, createdAt }) });
    const docs = [doc("active", "2026-01-01T10:00:00Z"), doc("used", "2026-01-01T12:00:00Z"), doc("active", "2026-01-01T11:00:00Z")];
    expect(pickNewestActiveToken(docs)).toBe(docs[2]);
    expect(pickNewestActiveToken([doc("expired", "x")])).toBeUndefined();
  });
});

describe("verify page", () => {
  it("a failed request shows the temporary-error message, not 'wrong code'", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/club/verify/page.tsx"), "utf8");
    expect(page).toMatch(/: "server_error"\);/);
    expect(page).not.toMatch(/: "mismatch"\);/);
  });
});
