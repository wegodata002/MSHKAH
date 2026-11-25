import { getAdminDb } from "@/lib/firebase/admin";
import { getPopularity } from "@/lib/catalog/admin/popularity-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Most popular" for the menu, the home page and the assistant: product ids, best sellers first
 * (last 30 days, or all time when there were few sales). Only the order — never quantities or revenue.
 */
export async function GET() {
  try {
    const { ranking, period } = await getPopularity(getAdminDb());
    return Response.json(
      { ok: true, productIds: ranking, period },
      // Browsers and the CDN may keep it 10 minutes; the ranking itself changes at most every 6 hours.
      { headers: { "cache-control": "public, max-age=600, s-maxage=600" } }
    );
  } catch (error) {
    console.error("[catalog/popular] failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, productIds: [] }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
