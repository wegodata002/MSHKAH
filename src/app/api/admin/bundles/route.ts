import { NextRequest } from "next/server";
import { requireAdminOnly } from "@/lib/auth/verify-admin";
import { getAdminDb } from "@/lib/firebase/admin";
import { endOrDeleteBundle, listBundles, parseBundleInput, saveBundle } from "@/lib/bundles/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store, private" };
const ID = /^[A-Za-z0-9_-]{6,128}$/;

/**
 * Admin → Sales → Bundles (Admin only): POST { action: "list" | "create" | "update" | "end" | "delete", … }.
 * The bundle is checked against the catalog here; the browser never writes a bundle.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminOnly(request);
  if (auth instanceof Response) return auth;
  const body = (await request.json().catch(() => null)) as { action?: unknown; id?: unknown; bundle?: unknown } | null;
  const id = typeof body?.id === "string" && ID.test(body.id) ? body.id : null;
  try {
    const db = getAdminDb();
    if (body?.action === "list") return Response.json({ ok: true, bundles: await listBundles(db) }, { headers: NO_STORE });
    if (body?.action === "create" || (body?.action === "update" && id)) {
      const parsed = parseBundleInput(body.bundle);
      if (!parsed.ok) return Response.json({ ok: false, code: "VALIDATION", error: parsed.error }, { status: 400, headers: NO_STORE });
      const saved = await saveBundle(db, parsed.input, { id: body.action === "update" ? id : null, actor: auth.uid });
      return saved.ok
        ? Response.json({ ok: true, bundle: saved.bundle }, { headers: NO_STORE })
        : Response.json({ ok: false, code: "VALIDATION", error: saved.error }, { status: saved.error.code === "NOT_FOUND" ? 404 : 409, headers: NO_STORE });
    }
    if ((body?.action === "end" || body?.action === "delete") && id) {
      const done = await endOrDeleteBundle(db, id, body.action);
      return done.ok
        ? Response.json({ ok: true }, { headers: NO_STORE })
        : Response.json({ ok: false, code: "VALIDATION", error: done.error }, { status: done.error.code === "NOT_FOUND" ? 404 : 409, headers: NO_STORE });
    }
    return Response.json({ ok: false, code: "VALIDATION", error: { code: "ACTION" } }, { status: 400, headers: NO_STORE });
  } catch (error) {
    console.error("[admin/bundles] failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "UNAVAILABLE", code: "UNAVAILABLE" }, { status: 500, headers: NO_STORE });
  }
}
