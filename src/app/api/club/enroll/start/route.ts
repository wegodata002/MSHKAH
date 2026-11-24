import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { sendMishkahEmail } from "@/lib/email/send";
import { clubEmailLocale, renderClubVerificationCodeEmail } from "@/lib/email/loyalty-templates";
import { WELCOME_COUPON_PERCENT } from "@/lib/loyalty/coupons";
import {
  CODE_TTL_MINUTES,
  SEND_RATE_LIMIT_PER_HOUR,
  generateCode,
  hashEmail,
  normaliseEmail,
} from "@/lib/loyalty/tokens";
import { createEnrollmentToken, readLoyaltySettings, readMemberByEmail } from "@/lib/loyalty/admin/members";
import { consumeRateLimit, rateLimitKey } from "@/lib/loyalty/admin/rate-limit";
import { loyaltyLog } from "@/lib/loyalty/admin/log";

export const runtime = "nodejs";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Request a verification code for an email address.
 *
 * Spec constraints driving this handler:
 *   - "הודעות שאינן חושפות אם כתובת מסוימת רשומה" → we always answer 200 with
 *     the same shape even when the email is malformed or enrollment is closed.
 *   - "הגבלת ניסיונות ושליחה חוזרת בצד השרת, הגנה מפני הצפת מיילים" → per-email
 *     and per-IP rate limits, both consumed server-side.
 *   - "שמור רק גיבוב של הסוד ואכוף תפוגה ושימוש יחיד" → the token row stores
 *     only `codeHash`, with TTL and single-use flag.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { email?: string; locale?: string } | null;
  const email = body?.email?.trim();
  const locale = clubEmailLocale(body?.locale);
  const uniformResponse = () =>
    Response.json({ ok: true, minutesValid: CODE_TTL_MINUTES });

  if (!email || !EMAIL_REGEX.test(email)) {
    // We still shape the response so an attacker can't tell apart "no" from "yes".
    return uniformResponse();
  }

  const db = getAdminDb();
  const settings = await readLoyaltySettings(db);
  const existing = await readMemberByEmail(db, email);
  // Sign-up paused: existing members can still log in; new emails are dropped silently (no leak).
  if (!settings.enrollmentEnabled && !existing) {
    return uniformResponse();
  }

  const emailHash = hashEmail(email);
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const perEmail = await consumeRateLimit(db, {
    key: rateLimitKey(["enroll-start", "email", emailHash]),
    windowSeconds: 3600,
    limit: SEND_RATE_LIMIT_PER_HOUR,
  });
  const perIp = await consumeRateLimit(db, {
    key: rateLimitKey(["enroll-start", "ip", ip]),
    windowSeconds: 3600,
    limit: SEND_RATE_LIMIT_PER_HOUR * 3,
  });
  if (!perEmail.ok || !perIp.ok) {
    loyaltyLog("enroll.verify.throttled", { email, ip });
    // Deliberately keep the uniform response: never confirm throttling.
    return uniformResponse();
  }

  const code = generateCode();
  await createEnrollmentToken(db, { email, codePlain: code });
  // Someone joining is told a 10% code follows; a member logging in is not.
  const joining = !existing || existing.status === "email_verified" || existing.status === "awaiting_payment";
  const content = renderClubVerificationCodeEmail({
    code,
    minutesValid: CODE_TTL_MINUTES,
    locale,
    welcomeCouponPercent: joining && settings.welcomeCouponEnabled ? WELCOME_COUPON_PERCENT : undefined,
  });
  // Fire the email in the background; a Brevo hiccup must never block the
  // response and never leak into a different HTTP status code (which would
  // tell an attacker the address is valid).
  await sendMishkahEmail({
    to: normaliseEmail(email),
    subject: content.subject,
    html: content.html,
    text: content.text,
    kind: "loyalty_verification",
  }).catch((error) => {
    console.error("[loyalty] verification email send failed", {
      code: "EMAIL_FAILED",
      message: error instanceof Error ? error.message : "unknown",
    });
  });
  loyaltyLog("enroll.start", { email });
  return uniformResponse();
}
