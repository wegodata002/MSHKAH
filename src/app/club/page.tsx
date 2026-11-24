"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import { ClubCard, ClubHero, ClubPerk, formatIlsShort } from "@/features/club/club-ui";
import type { LoyaltyMeResponse } from "@/lib/loyalty/types";

type Mode = "join" | "login";

/**
 * Club home: join (name + email) or log in (email), both with a one-time email code.
 * Joining is free. A visitor who is already an active member goes straight to /club/me.
 */
export default function ClubJoinPage() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const nameId = useId();
  const emailId = useId();
  const [me, setMe] = useState<LoyaltyMeResponse | null>(null);
  const [mode, setMode] = useState<Mode>("join");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  // Until we know whether this device is logged in to the club, show nothing (no form flash).
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/club/me")
      .then((response) => response.json() as Promise<LoyaltyMeResponse>)
      .then((data) => {
        if (!active) return;
        setMe(data);
        // Already a member (e.g. scanned the shared QR at the counter) → straight to the member card.
        if (data.member?.status === "active" || data.member?.status === "suspended") {
          router.replace("/club/me");
          return;
        }
        setChecked(true);
      })
      .catch(() => {
        if (active) setChecked(true);
      });
    return () => {
      active = false;
    };
  }, [router]);

  const settings = me?.settings;
  const enrollmentClosed = settings ? !settings.enrollmentEnabled : false;
  // When sign-up is closed, members can still log in.
  const effectiveMode: Mode = enrollmentClosed ? "login" : mode;
  const canSend = Boolean(email.trim()) && (effectiveMode === "login" || Boolean(name.trim()));
  const ratio = formatIlsShort(settings?.spendPerPointMinor ?? 10000);
  const terms = settings?.[`terms${locale === "en" ? "En" : locale === "ar" ? "Ar" : "He"}` as const] ?? "";

  async function requestCode() {
    if (!canSend) return;
    setSending(true);
    await fetch("/api/club/enroll/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), locale }),
    }).catch(() => undefined);
    setSending(false);
    const target = new URLSearchParams({ email: email.trim() });
    if (effectiveMode === "join" && name.trim()) target.set("name", name.trim());
    router.push(`/club/verify?${target.toString()}`);
  }

  if (!checked) {
    return (
      <>
        <PageHeader />
        <div className="flex min-h-[60vh] items-center justify-center" data-club-checking>
          <Loader2 className="h-6 w-6 animate-spin text-coffee/60" />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader />
      <div className="mx-auto grid max-w-5xl gap-5 px-4 py-6 md:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start lg:py-10">
        <ClubHero badge={t("club.join.hero.badge")}>
          <h1 className="mt-4 font-display text-[28px] font-bold leading-tight md:text-4xl">{t("club2.join.title")}</h1>
          <p className="mt-2 text-sm opacity-85 md:text-base">{t("club2.join.subtitle")}</p>
          <div className="mt-5 grid gap-2.5 sm:grid-cols-3">
            <ClubPerk title={t("club2.perk.free.title")} body={t("club2.perk.free.body")} />
            <ClubPerk title={`${ratio} = ⭐`} body={t("club2.perk.points.body")} />
            <ClubPerk title={t("club2.perk.card.title")} body={t("club2.perk.card.body")} />
          </div>
        </ClubHero>

        <ClubCard>
          {!enrollmentClosed ? (
            <div className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-beige/50 p-1" role="tablist">
              {(["join", "login"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={effectiveMode === m}
                  data-club-tab={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "min-h-11 rounded-xl text-sm font-semibold transition-colors",
                    effectiveMode === m ? "bg-warm-white text-dark-brown shadow-sm" : "text-coffee/60 hover:text-coffee"
                  )}
                >
                  {t(m === "join" ? "club2.tab.join" : "club2.tab.login")}
                </button>
              ))}
            </div>
          ) : (
            <p className="mb-4 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900" role="status">
              {t("club2.closed")}
            </p>
          )}

          <h2 className="text-lg font-bold text-dark-brown">
            {t(effectiveMode === "join" ? "club2.form.joinTitle" : "club2.form.loginTitle")}
          </h2>
          <p className="mt-1 text-sm text-coffee/60">{t("club2.form.hint")}</p>

          <form
            className="mt-4 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void requestCode();
            }}
          >
            {effectiveMode === "join" ? (
              <div>
                <Label htmlFor={nameId}>{t("club2.form.name")}</Label>
                <Input
                  id={nameId}
                  type="text"
                  autoComplete="name"
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 h-12"
                  required
                />
              </div>
            ) : null}
            <div>
              <Label htmlFor={emailId}>{t("club2.form.email")}</Label>
              <Input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="email"
                dir="ltr"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@example.com"
                className="mt-1 h-12"
                required
              />
            </div>
            <Button type="submit" variant="turquoise" size="lg" disabled={sending || !canSend} className="h-12 w-full text-base">
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("club.join.sending")}
                </>
              ) : (
                t("club2.form.send")
              )}
            </Button>
            {effectiveMode === "join" ? <p className="text-center text-xs text-coffee/55">{t("club2.form.terms")}</p> : null}
          </form>

          {terms ? (
            <details className="mt-4 rounded-2xl border border-beige-dark/20 p-3 text-xs leading-relaxed text-coffee/80">
              <summary className="cursor-pointer font-semibold text-dark-brown">{t("club.join.termsTitle")}</summary>
              <div className="mt-2 whitespace-pre-line">{terms}</div>
            </details>
          ) : null}
        </ClubCard>
      </div>
    </>
  );
}
