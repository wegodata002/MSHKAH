import { getAdminDb } from "@/lib/firebase/admin";
import { listActiveBundles } from "@/lib/bundles/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The bundles on now (Admin → Sales → Bundles), for the offers page, the menu and the waiter screen.
 * Read only; the order route and the card charge read the bundle from the database again.
 */
export async function GET() {
  try {
    const bundles = await listActiveBundles(getAdminDb());
    // A minute at most: "End now" in the admin takes the bundle off the menu within a minute, and an
    // order for a bundle that is over is refused by the server anyway.
    return Response.json({ ok: true, bundles }, { headers: { "cache-control": "public, max-age=30, s-maxage=60" } });
  } catch (error) {
    console.error("[catalog/bundles] failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, bundles: [] }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
