import { NextRequest } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { completeClubJoinPayment } from "@/lib/loyalty/admin/payments";
import { sendClubWelcomeEmail } from "@/lib/loyalty/welcome";

export const runtime = "nodejs";

/**
 * HYP returns here. We VERIFY the redirect server-side, activate the
 * membership atomically, then kick off the welcome email (idempotent via
 * the member's `welcomeEmailStatus` flag; a failed email never undoes
 * the paid membership).
 */
async function handle(url: URL): Promise<Response> {
  const rawQuery = url.searchParams.toString();
  const db = getAdminDb();
  const result = await completeClubJoinPayment(db, {
    rawQuery,
    consentTerms: true,
    consentMarketing: false,
  });
  if (!result.ok) {
    return Response.redirect(
      new URL(`/club/activate?status=${encodeURIComponent(result.code.toLowerCase())}`, url),
      302
    );
  }

  if (!result.alreadyActive) {
    void sendClubWelcomeEmail(db, result.memberId);
  }
  return Response.redirect(new URL(`/club/me?welcome=1`, url), 302);
}

export async function GET(request: NextRequest) {
  return handle(new URL(request.url));
}
export async function POST(request: NextRequest) {
  return handle(new URL(request.url));
}
