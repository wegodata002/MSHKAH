"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { canManageUsers } from "@/lib/auth/roles";
import { clientAdminFetch, isPermissionDenied } from "@/lib/auth/client-admin-fetch";
import type { CustomerMemberLink } from "@/lib/loyalty/admin/customer-links";

export type CustomerMemberLinksState = "loading" | "ready" | "denied" | "failed";

/**
 * Admin → Customers: customer id → club member (id + status), matched on the server (see
 * customer-links.ts). Admin only: for anyone else nothing is asked ("denied"). "denied" = no
 * permission (not an Admin, or 401/403); "failed" = the server could not load (with `retry`).
 */
export function useCustomerMemberLinks(): { links: Record<string, CustomerMemberLink>; state: CustomerMemberLinksState; retry: () => void } {
  const { user, firebaseUser, loading } = useAuth();
  const isAdmin = Boolean(user && canManageUsers(user.role));
  const [links, setLinks] = useState<Record<string, CustomerMemberLink>>({});
  const [state, setState] = useState<CustomerMemberLinksState>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (loading || !firebaseUser || !isAdmin) return;
    let cancelled = false;
    setState("loading");
    void clientAdminFetch<{ links: Record<string, CustomerMemberLink> }>("/api/admin/club/members", { action: "customer-links" }).then((result) => {
      if (cancelled) return;
      if (result.ok && result.data?.links) {
        setLinks(result.data.links);
        setState("ready");
      } else {
        setState(isPermissionDenied(result) ? "denied" : "failed");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loading, firebaseUser, isAdmin, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!loading && !isAdmin) return { links: {}, state: "denied", retry };
  return { links: isAdmin ? links : {}, state, retry };
}
