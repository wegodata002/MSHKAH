import { NextRequest } from "next/server";
import { verifyIdToken, getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { FirestoreUser } from "@/types/firestore";
import { canManageUsers } from "./roles";

export interface AuthContext {
  uid: string;
  email: string;
  role: string;
  displayName: string;
}

/**
 * Who is asking, or why not: "unauthorized" = no / bad / expired sign-in, or no active staff user;
 * "unavailable" = the server could not check (Admin key missing, Firestore failing). The two must
 * not be confused: a server failure is not "you have no permission".
 */
export async function resolveAuthFromRequest(
  request: NextRequest
): Promise<{ auth: AuthContext } | { error: "unauthorized" | "unavailable" }> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return { error: "unauthorized" };

  let decoded: Awaited<ReturnType<typeof verifyIdToken>>;
  try {
    decoded = await verifyIdToken(header.slice(7));
  } catch (error) {
    // Firebase rejects the token itself with "auth/…" codes; anything else is the server.
    const code = String((error as { code?: unknown } | null)?.code ?? "");
    return { error: code.startsWith("auth/") ? "unauthorized" : "unavailable" };
  }
  try {
    const snap = await getAdminDb().collection(COLLECTIONS.users).doc(decoded.uid).get();
    if (!snap.exists) return { error: "unauthorized" };
    const user = snap.data() as FirestoreUser;
    if (!user.active) return { error: "unauthorized" };
    return {
      auth: {
        uid: decoded.uid,
        email: decoded.email ?? user.email,
        role: user.role,
        displayName: user.displayName,
      },
    };
  } catch {
    return { error: "unavailable" };
  }
}

export async function getAuthFromRequest(
  request: NextRequest
): Promise<AuthContext | null> {
  const result = await resolveAuthFromRequest(request);
  return "auth" in result ? result.auth : null;
}

export async function requireAdmin(
  request: NextRequest
): Promise<AuthContext | Response> {
  const auth = await getAuthFromRequest(request);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageUsers(auth.role) && auth.role !== "Manager") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return auth;
}

/** Any active staff member (Admin, Manager or Employee). */
export async function requireStaff(
  request: NextRequest
): Promise<AuthContext | Response> {
  const auth = await getAuthFromRequest(request);
  if (!auth) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["Admin", "Manager", "Employee"].includes(auth.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return auth;
}

export async function requireAdminOnly(
  request: NextRequest
): Promise<AuthContext | Response> {
  const result = await resolveAuthFromRequest(request);
  if ("error" in result) {
    return result.error === "unavailable"
      ? Response.json({ error: "UNAVAILABLE", code: "UNAVAILABLE" }, { status: 503 })
      : Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageUsers(result.auth.role)) {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }
  return result.auth;
}
