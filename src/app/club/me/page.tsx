"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { ArrowRight, Loader2, LogOut, PartyPopper, QrCode, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import { ClubCard, ClubHero, formatIlsShort } from "@/features/club/club-ui";
import type { LoyaltyMeResponse } from "@/lib/loyalty/types";
import { spendToNextPoint } from "@/lib/loyalty/points-math";

const DATE_LOCALES = { he: "he-IL", ar: "ar", en: "en-GB" } as const;

/**
 * Member page: hello + points (hero), the member card with its QR to show at the counter, and
 * recent activity. The QR encodes only the member number (no email, points or discount).
 */
function ClubMemberContent() {
  const t = useT();
  const { locale } = useLocale();
  const params = useSearchParams();
  const welcome = params?.get("welcome") === "1";
  const [me, setMe] = useState<LoyaltyMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/club/me")
      .then((response) => response.json() as Promise<LoyaltyMeResponse>)
      .then((data) => {
        if (active) setMe(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const member = me?.member ?? null;
  const settings = me?.settings;
  const redemptionReady = Boolean(settings?.redemptionEnabled && settings?.pointValueApproved && settings?.pointValueMinor);
  const estimatedValue = useMemo(() => {
    if (!member || !redemptionReady || !settings?.pointValueMinor) return null;
    return formatIlsShort(member.balancePoints * settings.pointValueMinor);
  }, [member, redemptionReady, settings?.pointValueMinor]);

  useEffect(() => {
    if (!member) {
      setQrDataUrl(null);
      return;
    }
    void QRCode.toDataURL(`MISHKAH:MEMBER:${member.memberNumber}`, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1A1410", light: "#FFFFFF" },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [member]);

  async function signOut() {
    await fetch("/api/club/session", { method: "POST" }).catch(() => undefined);
    window.location.href = "/club";
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-coffee/60" />
      </div>
    );
  }

  // Not logged in to the club on this device (or the old paid flow was never finished).
  if (!member || member.status === "email_verified" || member.status === "awaiting_payment") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-12 text-center">
        <h1 className="font-display text-2xl font-bold text-dark-brown">{t("club.me.notMemberTitle")}</h1>
        <p className="text-sm text-coffee/70">{t("club2.me.notMemberBody")}</p>
        <Link href="/club">
          <Button variant="turquoise" size="lg">
            <Sparkles className="h-4 w-4" /> {t("club2.me.joinOrLogin")}
          </Button>
        </Link>
      </div>
    );
  }

  const name = member.displayName?.trim() || member.email;
  const spendPerPoint = settings?.spendPerPointMinor ?? 10000;
  const ratio = formatIlsShort(spendPerPoint);
  const remaining = spendToNextPoint(member.pointsCarryMinor, spendPerPoint);
  const toNext = formatIlsShort(remaining);
  const progressPercent = Math.round(((spendPerPoint - remaining) / spendPerPoint) * 100);
  const dateLocale = DATE_LOCALES[locale] ?? "he-IL";

  return (
    // Phone order: hero → member card (shown at the counter) → history. Desktop: card on the side.
    <div className="mx-auto grid max-w-5xl gap-5 px-4 py-6 md:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start lg:py-10">
      <div className="space-y-5 lg:col-start-1 lg:row-start-1">
        {welcome ? (
          <p className="flex items-center gap-2 rounded-2xl bg-turquoise/10 p-4 text-sm font-semibold text-turquoise" role="status">
            <PartyPopper className="h-5 w-5 shrink-0" strokeWidth={1.75} />
            {t("club2.me.welcome")}
          </p>
        ) : null}

        <ClubHero badge={t("club.join.hero.badge")}>
          <p className="mt-4 text-sm opacity-85">{t("club2.me.hello")}</p>
          <h1 className="font-display text-[26px] font-bold leading-tight md:text-3xl" data-club-name>
            {name}
          </h1>
          <p className="mt-0.5 text-xs tracking-wide opacity-75">
            {t("club2.me.memberNo").replace("{number}", member.memberNumber)}
          </p>
          <div className="mt-6 flex items-end gap-2">
            <span className="font-display text-5xl font-extrabold leading-none tabular-nums" data-club-points>
              {member.balancePoints}
            </span>
            <span className="pb-1 text-sm opacity-85">{t("club2.me.points")}</span>
          </div>
          {settings?.earnEnabled !== false ? (
            <>
              {/* Progress to the next point (spend carried over between orders). */}
              <div
                className="mt-4 h-2 overflow-hidden rounded-full bg-white/20"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
                aria-label={t("club2.me.toNext").replace("{ils}", toNext)}
              >
                <div className="h-full rounded-full bg-gradient-to-r from-[#E9C46A] to-[#F4D58D]" style={{ width: `${progressPercent}%` }} data-club-progress />
              </div>
              <p className="mt-1.5 text-xs font-semibold opacity-90" data-club-to-next>
                {t("club2.me.toNext").replace("{ils}", toNext)}
              </p>
            </>
          ) : null}
          <p className="mt-1 text-xs opacity-80">
            {settings?.earnEnabled === false ? t("club2.me.earnPaused") : t("club2.me.ratio").replace("{ils}", ratio)}
            {estimatedValue ? ` · ${t("club2.me.value").replace("{value}", estimatedValue)}` : ""}
          </p>
          {member.status === "suspended" ? (
            <p className="mt-3 rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold">{t("club2.me.suspended")}</p>
          ) : null}
        </ClubHero>
      </div>

      <div className="lg:col-start-1 lg:row-start-2">
        <ClubCard>
          <h2 className="font-display text-lg font-bold text-dark-brown">{t("club.me.historyTitle")}</h2>
          {me!.history.length === 0 ? (
            <p className="mt-3 text-sm text-coffee/60">{t("club.me.historyEmpty")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-beige-dark/15" data-club-history>
              {me!.history.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-dark-brown">
                      {t(entry.kind === "welcome" ? "club2.me.kind.welcome" : `club.me.kind.${entry.kind}`)}
                    </p>
                    <p className="text-xs text-coffee/55">
                      {new Date(entry.createdAt).toLocaleDateString(dateLocale, { day: "numeric", month: "numeric", year: "numeric" })}
                      {entry.kind === "adjustment" && entry.reason ? ` · ${entry.reason}` : ""}
                    </p>
                  </div>
                  {entry.kind === "welcome" ? (
                    <span className="text-base" aria-hidden>🎉</span>
                  ) : (
                    <span
                      className={cn(
                        "shrink-0 font-bold tabular-nums",
                        entry.points > 0 ? "text-emerald-700" : entry.points < 0 ? "text-red-700" : "text-coffee/60"
                      )}
                    >
                      {entry.points > 0 ? `+${entry.points}` : entry.points}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ClubCard>
      </div>

      <div className="max-lg:row-start-2 lg:col-start-2 lg:row-start-1">
        <ClubCard className="bg-[linear-gradient(160deg,#fffaf2,#f6ecdf)]">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-dark-brown">
            <QrCode className="h-5 w-5 text-turquoise" strokeWidth={1.75} />
            {t("club2.me.cardTitle")}
          </h2>
          <div className="mt-4 flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm">
            {qrDataUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={qrDataUrl} alt={t("club.me.qrAlt")} className="h-32 w-32 shrink-0 rounded-lg" data-club-qr />
            ) : (
              <div className="h-32 w-32 shrink-0 animate-pulse rounded-lg bg-beige/50" />
            )}
            <div className="min-w-0">
              <p className="font-semibold text-dark-brown">{t("club2.me.cardHint")}</p>
              <p className="mt-1 font-mono text-sm tracking-wider text-coffee/70" dir="ltr">
                {member.memberNumber}
              </p>
            </div>
          </div>
        </ClubCard>
      </div>

      {/* Last on phones; under the member card on desktop. */}
      <div className="lg:col-start-2 lg:row-start-2 lg:self-start">
        <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <Link href="/" className="flex-1">
            <Button variant="outline" className="h-11 w-full">
              <ArrowRight className="h-4 w-4" /> {t("club.me.backToStore")}
            </Button>
          </Link>
          <Button variant="ghost" onClick={() => void signOut()} className="h-11 flex-1 text-coffee/60">
            <LogOut className="h-4 w-4" /> {t("club.me.signOut")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ClubMemberCardPage() {
  return (
    <>
      <PageHeader />
      <Suspense
        fallback={
          <div className="flex min-h-[60vh] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-coffee/60" />
          </div>
        }
      >
        <ClubMemberContent />
      </Suspense>
    </>
  );
}
