"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Delete, Loader2, QrCode } from "lucide-react";
import { AppLogo } from "@/components/brand/app-logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import { staffAudience, type StaffRole } from "@/lib/staff/types";
import { CourierDeliveries } from "@/features/staff/courier-deliveries";
import { WaiterTables } from "@/features/staff/waiter-tables";

type Member = { name: string; role: StaffRole; worksToday: boolean };
type State = { kind: "checking" } | { kind: "pin" } | { kind: "in"; member: Member } | { kind: "device"; name: string };

const PIN_LENGTH = 4;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;

function PinPad({ audience, onSignedIn }: { audience: StaffRole; onSignedIn: (member: Member) => void }) {
  const t = useT();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (code: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/staff/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: code, for: audience }),
        });
        const data = (await res.json().catch(() => null)) as
          | { ok?: boolean; name?: string; role?: StaffRole; code?: string; attemptsLeft?: number; retryAfterSeconds?: number }
          | null;
        if (res.ok && data?.ok && data.name && data.role) {
          const me = (await fetch("/api/staff/me", { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as { member?: Member } | null;
          onSignedIn(me?.member ?? { name: data.name, role: data.role, worksToday: false });
          return;
        }
        if (data?.code === "WRONG_PIN") setError(t("staff.wrongPin").replace("{n}", String(data.attemptsLeft ?? 0)));
        else if (data?.code === "BLOCKED") setError(t("staff.blocked").replace("{min}", String(Math.max(1, Math.ceil((data.retryAfterSeconds ?? 900) / 60)))));
        else setError(t("staff.error"));
      } catch {
        setError(t("staff.error"));
      } finally {
        setPin("");
        setBusy(false);
      }
    },
    [audience, onSignedIn, t]
  );

  // The typed digits also live in a ref: the code is sent from here, never from inside a state
  // update (React may run those twice), so each code is sent and counted exactly once.
  const pinRef = useRef("");
  const press = useCallback(
    (key: string) => {
      if (busy) return;
      if (key === "back") {
        pinRef.current = pinRef.current.slice(0, -1);
        setPin(pinRef.current);
        return;
      }
      if (pinRef.current.length >= PIN_LENGTH) return;
      setError(null);
      pinRef.current += key;
      setPin(pinRef.current);
      if (pinRef.current.length === PIN_LENGTH) {
        const code = pinRef.current;
        pinRef.current = "";
        void submit(code);
      }
    },
    [busy, submit]
  );

  // Physical keyboard too (tablet with a keyboard, desktop).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (/^\d$/.test(event.key)) press(event.key);
      else if (event.key === "Backspace") press("back");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  return (
    <div className="flex flex-col items-center" data-staff-pin>
      <p className="text-lg font-semibold text-dark-brown">{t("staff.enterPin")}</p>
      {/* Here and not at the bottom of the screen, where the accessibility button sits. */}
      <p className="mt-1 text-center text-xs text-coffee/50">{t("staff.staffOnly")}</p>
      <div className="mt-5 flex gap-3" dir="ltr" aria-live="polite" aria-label={t("staff.enterPin")}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "flex h-14 w-12 items-center justify-center rounded-2xl border-2 bg-warm-white text-2xl font-bold",
              i < pin.length ? "border-turquoise text-dark-brown" : "border-beige-dark/40 text-transparent"
            )}
          >
            •
          </span>
        ))}
      </div>
      <p className={cn("mt-4 min-h-[1.5rem] text-center text-sm", error ? "text-red-600" : "text-coffee/50")} role={error ? "alert" : undefined} data-staff-error={error ? "" : undefined}>
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("staff.checking")}
          </span>
        ) : (
          error ?? ""
        )}
      </p>
      <div className="mt-3 grid w-full max-w-[18rem] grid-cols-3 gap-3" dir="ltr">
        {KEYS.map((key, i) =>
          key === "" ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              disabled={busy}
              onClick={() => press(key)}
              aria-label={key === "back" ? t("staff.backspace") : key}
              data-key={key}
              className="flex h-16 items-center justify-center rounded-2xl border border-beige-dark/30 bg-warm-white text-2xl font-semibold text-dark-brown shadow-soft transition active:scale-95 disabled:opacity-50"
            >
              {key === "back" ? <Delete className="h-6 w-6" strokeWidth={1.75} /> : key}
            </button>
          )
        )}
      </div>
    </div>
  );
}

/** Waiters: no code. This device is not connected yet — scan the waiters' QR in the work area. */
function ScanWaiterQr() {
  const t = useT();
  return (
    <div className="flex max-w-sm flex-col items-center text-center" data-waiter-scan-qr>
      <QrCode className="h-12 w-12 text-turquoise" strokeWidth={1.5} />
      <h1 className="mt-3 font-display text-xl font-bold text-dark-brown">{t("waiter.join.scanTitle")}</h1>
      <p className="mt-2 text-sm text-coffee/65">{t("waiter.join.scanHint")}</p>
    </div>
  );
}

/**
 * /staff — couriers: the personal-code keypad, then their deliveries. Waiters (/staff?for=waiter): a
 * device that joined with the waiters' QR opens the tables screen; any other device is asked to scan
 * that QR (waiters have no code).
 */
export function StaffScreen() {
  const t = useT();
  const { dir } = useLocale();
  const params = useSearchParams();
  const forParam = params.get("for");
  // /staff and /staff?for=courier: the couriers' QR; /staff?for=waiter: the waiters' QR.
  const audience = staffAudience(forParam);
  const [state, setState] = useState<State>({ kind: "checking" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/staff/me", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { member?: Member; device?: { name: string } }) : null))
      .then((data) => {
        if (cancelled) return;
        // Couriers: signed in with their code. Waiters: a connected device. Otherwise the start screen.
        if (audience === "courier" && data?.member?.role === "courier") setState({ kind: "in", member: data.member });
        else if (audience === "waiter" && data?.device) setState({ kind: "device", name: data.device.name });
        else setState({ kind: "pin" });
      })
      .catch(() => !cancelled && setState({ kind: "pin" }));
    return () => {
      cancelled = true;
    };
  }, [audience]);

  const title = t(audience === "waiter" ? "staff.title.waiter" : "staff.title.courier");
  const fullScreen = state.kind === "device" || state.kind === "in";

  return (
    <div dir={dir} className="flex min-h-dvh flex-col bg-cream" data-staff>
      <header className="flex items-center justify-between gap-3 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <AppLogo size="sm" href={null} className="h-10 w-auto" />
          <span className="font-display text-base font-bold text-dark-brown">{title}</span>
        </div>
        <LanguageSwitcher compact />
      </header>
      <main
        className={cn(
          "flex flex-1 flex-col items-center px-4 py-8",
          // The courier and waiter screens start at the top; the keypad sits in the middle.
          fullScreen ? "justify-start py-4" : "justify-center"
        )}
      >
        {state.kind === "checking" ? (
          <Loader2 className="h-8 w-8 animate-spin text-turquoise" aria-label={t("staff.checking")} />
        ) : state.kind === "in" && state.member.role === "courier" ? (
          <CourierDeliveries name={state.member.name} onSignedOut={() => setState({ kind: "pin" })} />
        ) : state.kind === "device" ? (
          <WaiterTables onSignedOut={() => setState({ kind: "pin" })} />
        ) : audience === "waiter" ? (
          <ScanWaiterQr />
        ) : (
          <PinPad audience="courier" onSignedIn={(member) => setState({ kind: "in", member })} />
        )}
      </main>
    </div>
  );
}
