"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Delete, Loader2, Tablet } from "lucide-react";
import { AppLogo } from "@/components/brand/app-logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import { staffAudience, type StaffRole } from "@/lib/staff/types";
import { CourierDeliveries } from "@/features/staff/courier-deliveries";
import { WaiterTables } from "@/features/staff/waiter-tables";

type Member = { name: string; role: StaffRole; worksToday: boolean };
type State = { kind: "checking" } | { kind: "pin" } | { kind: "pair" } | { kind: "in"; member: Member } | { kind: "device"; name: string };

const PIN_LENGTH = 4;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;

/** "This code belongs to a waiter. Use the waiters' QR." (and the reverse). */
const WRONG_ROLE_KEY: Record<StaffRole, string> = { waiter: "staff.wrongRole.waiter", courier: "staff.wrongRole.courier" };

function PinPad({ audience, notice, onSignedIn }: { audience: StaffRole; notice?: string | null; onSignedIn: (member: Member) => void }) {
  const t = useT();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(notice ?? null);

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
        if (data?.code === "WRONG_ROLE" && data.role) setError(t(WRONG_ROLE_KEY[data.role]));
        else if (data?.code === "WRONG_PIN") setError(t("staff.wrongPin").replace("{n}", String(data.attemptsLeft ?? 0)));
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

/** A cafe tablet: type the one-time code from Admin → Staff → Fixed devices (6 digits, 10 minutes). */
function PairDevice({ onPaired, onBack }: { onPaired: (name: string) => void; onBack: () => void }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/device/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; code?: string; device?: { name: string } } | null;
      if (res.ok && data?.ok && data.device) return onPaired(data.device.name);
      setError(
        t(
          data?.code === "EXPIRED"
            ? "device.pair.expired"
            : data?.code === "USED"
              ? "device.pair.used"
              : data?.code === "BLOCKED"
                ? "device.pair.blocked"
                : data?.code === "INVALID_CODE"
                  ? "device.pair.invalid"
                  : "staff.error"
        )
      );
    } catch {
      setError(t("staff.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex w-full max-w-sm flex-col items-center text-center" data-pair-device>
      <Tablet className="h-10 w-10 text-turquoise" strokeWidth={1.5} />
      <h1 className="mt-3 font-display text-xl font-bold text-dark-brown">{t("device.pair.title")}</h1>
      <p className="mt-1 text-sm text-coffee/60">{t("device.pair.hint")}</p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        dir="ltr"
        aria-label={t("device.pair.code")}
        placeholder="000000"
        className="mt-5 h-14 w-56 rounded-2xl border-2 border-beige-dark/40 bg-warm-white text-center text-2xl font-bold tracking-[0.35em] text-dark-brown focus:border-turquoise focus:outline-none"
        data-pair-code
      />
      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert" data-pair-error>
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="mt-5 flex h-12 w-56 items-center justify-center gap-2 rounded-xl bg-turquoise font-bold text-warm-white disabled:opacity-50"
        data-pair-submit
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {t("device.pair.submit")}
      </button>
      <button type="button" onClick={onBack} className="mt-3 text-sm text-coffee/60 underline">
        {t("device.pair.back")}
      </button>
    </form>
  );
}

/**
 * /staff — where the "Couriers" and "Waiters" QR codes lead. Without a valid code nothing is shown but
 * the keypad. A fixed cafe tablet (paired from the admin) opens the waiter screen without a code.
 */
export function StaffScreen() {
  const t = useT();
  const { dir } = useLocale();
  const params = useSearchParams();
  const forParam = params.get("for");
  // /staff and /staff?for=courier: the couriers' QR; /staff?for=waiter: the waiters' QR.
  const audience = staffAudience(forParam);
  const [state, setState] = useState<State>({ kind: "checking" });
  /** Signed in here as the other role: shown above the keypad instead of opening the other screen. */
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/staff/me", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { member?: Member; device?: { name: string } }) : null))
      .then((data) => {
        if (cancelled) return;
        if (data?.member && data.member.role === audience) setState({ kind: "in", member: data.member });
        else if (data?.device && audience === "waiter") setState({ kind: "device", name: data.device.name });
        else {
          if (data?.member) setNotice(t(WRONG_ROLE_KEY[data.member.role]));
          setState({ kind: "pin" });
        }
      })
      .catch(() => !cancelled && setState({ kind: "pin" }));
    return () => {
      cancelled = true;
    };
  }, [audience, t]);

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
        ) : state.kind === "in" || state.kind === "device" ? (
          <WaiterTables onSignedOut={() => setState({ kind: "pin" })} />
        ) : state.kind === "pair" ? (
          <PairDevice onPaired={(name) => setState({ kind: "device", name })} onBack={() => setState({ kind: "pin" })} />
        ) : (
          <div className="flex flex-col items-center">
            <PinPad
              audience={audience}
              notice={notice}
              onSignedIn={(member) => {
                setNotice(null);
                setState({ kind: "in", member });
              }}
            />
            {audience === "waiter" && (
              <button type="button" onClick={() => setState({ kind: "pair" })} className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-turquoise underline" data-pair-link>
                <Tablet className="h-4 w-4" />
                {t("device.pair.link")}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
