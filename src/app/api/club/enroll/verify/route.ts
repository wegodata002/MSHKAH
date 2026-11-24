import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getAdminDb } from "@/lib/firebase/admin";
import {
  activateMember,
  readLoyaltySettings,
  readMemberByEmail,
  upsertVerifiedMember,
  verifyEnrollmentCode,
} from "@/lib/loyalty/admin/members";
import { signClubSession } from "@/lib/loyalty/session";
import { sendClubWelcomeEmail } from "@/lib/loyalty/welcome";
import { loyaltyLog } from "@/lib/loyalty/admin/log";
import { consumeRateLimit, rateLimitKey } from "@/lib/loyalty/admin/rate-limit";
import { hashEmail } from "@/lib/loyalty/tokens";

export const runtime = "nodejs";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_REGEX = /^\d{6}$/;

/**
 * Verify the one-time code and open a signed session cookie.
 *
 * Error shape:
 *   { ok: false, reason: "mismatch" | "expired" | "throttled" | "used" | "no_token" }
 * We never reveal whether an email is registered; "no_token" is returned the
 * same way as "mismatch" to the UI.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    email?: string;
    code?: string;
    displayName?: string;
    phone?: string;
  } | null;
  const email = body?.email?.trim();
  const code = body?.code?.trim();
  if (!email || !EMAIL_REGEX.test(email) || !code || !CODE_REGEX.test(code)) {
    return Response.json({ ok: false, reason: "mismatch" }, { status: 400 });
  }
  const db = getAdminDb();
  const settings = await readLoyaltySettings(db);
  // Sign-up paused: only existing members (logging in) get through.
  if (!settings.enrollmentEnabled && !(await readMemberByEmail(db, email))) {
    return Response.json({ ok: false, reason: "enrollment_disabled" }, { status: 409 });
  }
  const emailHash = hashEmail(email);
  const bucket = await consumeRateLimit(db, {
    key: rateLimitKey(["enroll-verify", emailHash]),
    windowSeconds: 600,
    limit: 10,
  });
  if (!bucket.ok) {
    return Response.json({ ok: false, reason: "throttled" }, { status: 429 });
  }

  const result = await verifyEnrollmentCode(db, { email, codePlain: code });
  if (!result.ok) {
    loyaltyLog("enroll.verify.fail", { email, reason: result.reason });
    return Response.json({ ok: false, reason: result.reason }, { status: 400 });
  }

  const displayName = body?.displayName?.trim().slice(0, 80) || undefined;
  const existing = await readMemberByEmail(db, email);
  // Joining needs a name; logging in (an existing member) does not.
  if (!existing && !displayName) {
    return Response.json({ ok: false, reason: "name_required" }, { status: 400 });
  }
  // Creates the member, or fills in a missing name on an existing one.
  let member = await upsertVerifiedMember(db, { email, displayName, phone: body?.phone?.slice(0, 40) });

  // Sign-up is free: a verified email becomes an active member right away (also members who
  // started the old paid flow and never paid). Paid and suspended members are left as they are.
  if (member.status === "email_verified" || member.status === "awaiting_payment") {
    member = await activateMember(db, {
      memberId: member.id,
      source: "free",
      paidAmountMinor: 0,
      actor: "self",
      consentTerms: true,
      consentMarketing: false,
    });
    void sendClubWelcomeEmail(db, member.id);
  }

  const session = signClubSession({ emailHash: result.emailHash });
  const jar = await cookies();
  jar.set({
    name: session.cookieName,
    value: session.value,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAgeSeconds,
  });
  loyaltyLog("enroll.verify.ok", { email, memberId: member.id });
  return Response.json({
    ok: true,
    member: {
      id: member.id,
      memberNumber: member.memberNumber,
      status: member.status,
      balancePoints: member.balancePoints,
    },
    expiresAt: session.expiresAt,
  });
}
