// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MissingSecretError, requireServerSecret } from "@/lib/server-secrets";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const STRONG = "x".repeat(48);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("server secrets", () => {
  it("development and tests: fixed fallback when not set", () => {
    expect(requireServerSecret("A_SECRET", "dev-value", { NODE_ENV: "development" })).toBe("dev-value");
    expect(requireServerSecret("A_SECRET", "dev-value", { NODE_ENV: "test" })).toBe("dev-value");
    expect(requireServerSecret("A_SECRET", "dev-value", { NODE_ENV: "development", A_SECRET: "set" })).toBe("set");
  });

  it("production: uses the configured value", () => {
    expect(requireServerSecret("A_SECRET", "dev-value", { NODE_ENV: "production", A_SECRET: ` ${STRONG} ` })).toBe(STRONG);
  });

  it("production: missing or short → clear error in the log, never the fallback", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => requireServerSecret("MISSING_ONE", "dev-value", { NODE_ENV: "production" })).toThrow(MissingSecretError);
    expect(() => requireServerSecret("MISSING_ONE", "dev-value", { NODE_ENV: "production", MISSING_ONE: "   " })).toThrow(/MISSING_ONE is not set/);
    expect(() => requireServerSecret("SHORT_ONE", "dev-value", { NODE_ENV: "production", SHORT_ONE: "abc" })).toThrow(/SHORT_ONE is shorter than 32/);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("MISSING_ONE is not set"));
    // Logged once per secret, not on every request.
    expect(log.mock.calls.filter(([m]) => String(m).includes("MISSING_ONE")).length).toBe(1);
  });

  it("club session, card QR, tracking links and sign-up codes all go through it (no hard-coded fallback in production)", () => {
    const session = read("src/lib/loyalty/session.ts");
    expect(session).toMatch(/requireServerSecret\("LOYALTY_SESSION_SECRET", "mishkah-dev-session"\)/);
    expect(session).not.toMatch(/process\.env\.LOYALTY_/);
    const tokens = read("src/lib/loyalty/tokens.ts");
    expect(tokens).toMatch(/requireServerSecret\("LOYALTY_TOKEN_PEPPER", "mishkah-dev-pepper"\)/);
    expect(tokens).not.toMatch(/process\.env\.LOYALTY_/);
  });
});

describe("a missing secret never fails an order that is already saved or paid", () => {
  it("tracking link is left out instead", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOYALTY_SESSION_SECRET", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { tryCreateTrackingToken, createTrackingToken } = await import("@/lib/orders/tracking-token");
    expect(() => createTrackingToken("AbCdEfGhIjKlMnOpQrSt")).toThrow(MissingSecretError);
    expect(tryCreateTrackingToken("AbCdEfGhIjKlMnOpQrSt")).toBeNull();
    vi.stubEnv("LOYALTY_SESSION_SECRET", STRONG);
    expect(tryCreateTrackingToken("AbCdEfGhIjKlMnOpQrSt")).toMatch(/^AbCdEfGhIjKlMnOpQrSt\.[A-Za-z0-9_-]{22}$/);
  });

  it("order create, card-payment return and the email use the safe version", () => {
    expect(read("src/app/api/orders/create/route.ts")).toMatch(/tryCreateTrackingToken\(result\.body\.id\)/);
    expect(read("src/lib/payments/hyp/process.ts")).toMatch(/tryCreateTrackingToken\(payment\.orderId\)/);
    expect(read("src/lib/email/notifications/customer-payment.ts")).toMatch(/tryCreateTrackingToken\(orderId\)/);
  });
});
