import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { parseAssistantConfig } from "@/lib/assistant/parse-config";
import { ASSISTANT_DOC_ID } from "@/lib/assistant/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The "Offers" page: the products chosen in the admin as "Recommended (offers)", in the order set
 * there (▲▼). Each entry is an object so a discount price and dates can be added later without
 * changing the page.
 */
export async function GET() {
  try {
    const snap = await getAdminDb().doc(`${COLLECTIONS.assistant}/${ASSISTANT_DOC_ID}`).get();
    const config = parseAssistantConfig(snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
    const offers = [...new Set(config.featuredProductIds.filter((id) => typeof id === "string" && id))].map((productId) => ({ productId }));
    return Response.json({ ok: true, offers }, { headers: { "cache-control": "public, max-age=60, s-maxage=60" } });
  } catch (error) {
    console.error("[catalog/offers] failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, offers: [] }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
