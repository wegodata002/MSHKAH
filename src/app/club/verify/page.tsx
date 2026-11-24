"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, MailCheck } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { ClubCard } from "@/features/club/club-ui";

type VerifyError =
  | "mismatch"
  | "expired"
  | "throttled"
  | "used"
  | "no_token"
  | "enrollment_disabled"
  | "name_required"
  | "server_error";

/**
 * Enter the emailed code. Joining is free, so a correct code goes straight to the member page
 * (new members land with ?welcome=1). `useSearchParams` needs the Suspense wrapper below.
 */
function ClubVerifyContent() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const email = params?.get("email") ?? "";
  const name = params?.get("name") ?? "";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<VerifyError | null>(null);

  async function submit() {
    if (!email.trim() || code.trim().length !== 6) return;
    setBusy(true);
    setError(null);
    const response = await fetch("/api/club/enroll/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), code: code.trim(), displayName: name || undefined, locale }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as
      | { ok: true; member?: { status?: string } }
      | { ok: false; reason: VerifyError }
      | null;
    setBusy(false);
    if (data?.ok) {
      router.replace(name ? "/club/me?welcome=1" : "/club/me");
      return;
    }
    // No answer, or an answer without a reason (network / server failure) is not a wrong code.
    setError(data && !data.ok && data.reason ? data.reason : "server_error");
  }

  async function resend() {
    if (!email.trim() || busy) return;
    setBusy(true);
    await fetch("/api/club/enroll/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), locale }),
    }).catch(() => undefined);
    setBusy(false);
    setResent(true);
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 px-4 py-8 md:px-6">
      <ClubCard>
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-turquoise/10 text-turquoise">
          <MailCheck className="h-6 w-6" strokeWidth={1.75} />
        </span>
        <h1 className="mt-3 font-display text-2xl font-bold text-dark-brown">{t("club2.verify.title")}</h1>
        <p className="mt-1 text-sm text-coffee/65">
          {t("club.verify.subtitle").replace("{email}", "")}
          <span dir="ltr" className="font-semibold text-dark-brown">{email}</span>
        </p>
        <form
          className="mt-5 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            value={code}
            maxLength={6}
            aria-label={t("club2.verify.codeLabel")}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="••••••"
            className="h-14 text-center text-2xl font-bold tracking-[0.5em]"
          />
          <Button type="submit" variant="turquoise" size="lg" disabled={busy || code.length !== 6} className="h-12 w-full text-base">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("club.verify.verifying")}
              </>
            ) : (
              t("club2.verify.submit")
            )}
          </Button>
        </form>
        {error ? (
          <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert">
            {t(
              error === "name_required" || error === "server_error"
                ? `club2.verify.err.${error}`
                : `club.verify.err.${error}`
            )}
          </p>
        ) : null}
        {resent && !error ? (
          <p className="mt-3 rounded-2xl bg-turquoise/10 p-3 text-sm text-turquoise" role="status">
            {t("club2.verify.resent")}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
          <button type="button" onClick={() => void resend()} disabled={busy} className="min-h-11 font-semibold text-turquoise disabled:opacity-50">
            {t("club.verify.resend")}
          </button>
          <Link href="/club" className="min-h-11 content-center text-coffee/60 hover:text-coffee">
            {t("club2.verify.changeEmail")}
          </Link>
        </div>
      </ClubCard>
    </div>
  );
}

function ClubVerifyFallback() {
  return (
    <div className="mx-auto flex max-w-md items-center justify-center px-4 py-10">
      <Loader2 className="h-6 w-6 animate-spin text-coffee/60" />
    </div>
  );
}

export default function ClubVerifyPage() {
  return (
    <>
      <PageHeader />
      <Suspense fallback={<ClubVerifyFallback />}>
        <ClubVerifyContent />
      </Suspense>
    </>
  );
}
