"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, QrCode } from "lucide-react";
import { AppLogo } from "@/components/brand/app-logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useLocale, useT } from "@/components/providers/locale-provider";

type State = { kind: "joining" } | { kind: "error"; code: "INVALID_KEY" | "BLOCKED" | "ERROR" };

/**
 * /staff/join?k=… — where the waiters' QR leads. The secret is taken off the address bar right
 * away (so it is not left in the history), sent once to the server, and the device opens the
 * tables screen signed in for 90 days. No code, no "who is working now".
 */
export function WaiterJoinScreen() {
  const t = useT();
  const { dir } = useLocale();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "joining" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const key = new URLSearchParams(window.location.search).get("k") ?? "";
    window.history.replaceState(null, "", "/staff/join");
    if (!key) {
      setState({ kind: "error", code: "INVALID_KEY" });
      return;
    }
    void (async () => {
      try {
        const res = await fetch("/api/staff/device/join", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
          cache: "no-store",
          referrerPolicy: "no-referrer",
        });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; code?: string } | null;
        if (res.ok && data?.ok) {
          router.replace("/staff?for=waiter");
          return;
        }
        setState({ kind: "error", code: data?.code === "INVALID_KEY" ? "INVALID_KEY" : data?.code === "BLOCKED" ? "BLOCKED" : "ERROR" });
      } catch {
        setState({ kind: "error", code: "ERROR" });
      }
    })();
  }, [router]);

  return (
    <div dir={dir} className="flex min-h-dvh flex-col bg-cream" data-staff-join>
      <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <AppLogo size="sm" href={null} className="h-10 w-auto" />
          <span className="font-display text-base font-bold text-dark-brown">{t("staff.title.waiter")}</span>
        </div>
        <LanguageSwitcher compact />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
        {state.kind === "joining" ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-turquoise" />
            <p className="mt-4 font-semibold text-dark-brown">{t("waiter.join.connecting")}</p>
          </>
        ) : (
          <div className="max-w-sm" role="alert" data-join-error={state.code}>
            <QrCode className="mx-auto h-10 w-10 text-coffee/40" strokeWidth={1.5} />
            <p className="mt-4 font-semibold text-dark-brown">
              {t(state.code === "INVALID_KEY" ? "waiter.join.invalid" : state.code === "BLOCKED" ? "waiter.join.blocked" : "staff.error")}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
