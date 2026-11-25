/**
 * Server secrets (signing / hashing keys). Development and tests may use a fixed fallback; production
 * (NODE_ENV=production: Vercel Production and Preview, `next start`) never does. A missing or short
 * secret there fails the request with a clear log line instead of silently using a value that is
 * public in this repository.
 */
export const MIN_SECRET_LENGTH = 32;

export class MissingSecretError extends Error {
  constructor(public readonly secretName: string, reason: "missing" | "too_short") {
    super(
      `[config] Server secret ${secretName} is ${reason === "missing" ? "not set" : `shorter than ${MIN_SECRET_LENGTH} characters`}. ` +
        `Set it in Vercel → Project → Settings → Environment Variables (Production and Preview) and redeploy.`
    );
    this.name = "MissingSecretError";
  }
}

const logged = new Set<string>();

export function requireServerSecret(
  name: string,
  devFallback: string,
  env: Record<string, string | undefined> = process.env
): string {
  const value = env[name]?.trim() ?? "";
  if (env.NODE_ENV !== "production") return value || devFallback;
  if (value.length >= MIN_SECRET_LENGTH) return value;
  const error = new MissingSecretError(name, value ? "too_short" : "missing");
  if (!logged.has(name)) {
    logged.add(name);
    console.error(error.message);
  }
  throw error;
}
