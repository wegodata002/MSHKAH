"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import QRCode from "qrcode";
import { ArrowLeft, ArrowRight, Loader2, PartyPopper, QrCode, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import { ClubCard, ClubHero, formatIlsShort } from "@/features/club/club-ui";
import { ClubCoupons } from "@/features/club/club-coupons";
import { ClubCoffeeCard } from "@/features/club/club-coffee-card";
import type { LoyaltyMeResponse } from "@/lib/loyalty/types";
import { spendToNextPoint } from "@/lib/loyalty/points-math";
import { coffeeCardView } from "@/lib/loyalty/coffee";

const DATE_LOCALES = { he: "he-IL", ar: "ar", en: "en-GB" } as const;
/** How often the open page checks for new cups / points (only while it is visible). */
const CLUB_LIVE_INTERVAL_MS = 10_000;

type LiveAnswer = { ok: boolean; balancePoints?: number; coffeeCups?: number; pointsCarryMinor?: number; status?: string };

/**
 * Member page (compact): points (hero) + "Order" button, the member card with its QR, the coffee
 * card, perks, recent activity; "Sign out" as a small link at the end.
 *
 * Desktop: the cards flow into two self-balancing columns (no gaps). Phone: one column, same order.
 * The QR is a signed link (/club/card?c=…) that shows nothing by itself: whoever scans it lands on
 * their own card. While the page is visible it checks every 10 s for new cups / points (added at
 * the counter) and updates by itself.
 */
function ClubMemberContent() {
  const t = useT();
  const { locale } = useLocale();
  const params = useSearchParams();
  const welcome = params?.get("welcome") === "1";
  const [me, setMe] = useState<LoyaltyMeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  // Just-added cups glow for a moment; the points number too when it changes.
  const [glowFrom, setGlowFrom] = useState<number | null>(null);
  const [pointsFlash, setPointsFlash] = useState(false);
  const latest = useRef<LoyaltyMeResponse | null>(null);
  latest.current = me;

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
  const memberId = member && (member.status === "active" || member.status === "suspended") ? member.id : null;

  // Live updates: a light check every 10 s while the page is visible (and right away when the
  // customer comes back to it); the full card is reloaded only when something changed.
  useEffect(() => {
    if (!memberId) return;
    let stopped = false;
    let busy = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const check = async () => {
      if (stopped || busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const live = (await fetch("/api/club/me/live", { cache: "no-store" }).then((r) => r.json())) as LiveAnswer;
        const current = latest.current?.member;
        if (!live?.ok || !current || stopped) return;
        const changed =
          live.balancePoints !== current.balancePoints ||
          live.coffeeCups !== (current.coffeeCups ?? 0) ||
          live.pointsCarryMinor !== (current.pointsCarryMinor ?? 0) ||
          live.status !== current.status;
        if (!changed) return;
        const full = (await fetch("/api/club/me", { cache: "no-store" }).then((r) => r.json())) as LoyaltyMeResponse;
        if (stopped || !full?.member) return;
        const before = coffeeCardView(current.coffeeCups ?? 0).filled;
        const after = coffeeCardView(full.member.coffeeCups ?? 0).filled;
        if (after > before) {
          setGlowFrom(before);
          timers.push(setTimeout(() => setGlowFrom(null), 3500));
        }
        if (full.member.balancePoints !== current.balancePoints) {
          setPointsFlash(true);
          timers.push(setTimeout(() => setPointsFlash(false), 2500));
        }
        setMe(full);
      } catch {
        // Offline for a moment: try again next time.
      } finally {
        busy = false;
      }
    };
    const interval = setInterval(() => void check(), CLUB_LIVE_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      clearInterval(interval);
      timers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [memberId]);

  const settings = me?.settings;
  const redemptionReady = Boolean(settings?.redemptionEnabled && settings?.pointValueApproved && settings?.pointValueMinor);
  const estimatedValue = useMemo(() => {
    if (!member || !redemptionReady || !settings?.pointValueMinor) return null;
    return formatIlsShort(member.balancePoints * settings.pointValueMinor);
  }, [member, redemptionReady, settings?.pointValueMinor]);

  const cardToken = member?.cardToken ?? null;
  useEffect(() => {
    if (!cardToken) {
      setQrDataUrl(null);
      return;
    }
    void QRCode.toDataURL(`${window.location.origin}/club/card?c=${encodeURIComponent(cardToken)}`, {
      width: 240,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#1A1410", light: "#FFFFFF" },
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [cardToken]);

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
  const earnOn = settings?.earnEnabled !== false;
  // The arrow points the way the text reads.
  const OrderArrow = locale === "en" ? ArrowRight : ArrowLeft;

  return (
    <div className="mx-auto max-w-4xl px-4 py-4 md:px-6 lg:py-8">
      {welcome ? (
        <p className="mb-3 flex items-center gap-2 rounded-2xl bg-turquoise/10 p-3 text-sm font-semibold text-turquoise" role="status">
          <PartyPopper className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {t("club2.me.welcome")}
        </p>
      ) : null}

      {/* Cards flow into two self-balancing columns on desktop (no gaps), one column on phones. */}
      <div className="columns-1 gap-4 lg:columns-2 [&>*]:mb-3 [&>*]:break-inside-avoid lg:[&>*]:mb-4" data-club-cards>
        {/* Points + "Order" stay together. */}
        <div className="space-y-3">
          <ClubHero badge={t("club.join.hero.badge")} compact>
            <div className="mt-2.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <h1 className="font-display text-xl font-bold leading-tight">
                <span className="text-sm font-normal opacity-85">{t("club2.me.hello")} </span>
                <span data-club-name>{name}</span>
              </h1>
              <span className="text-[11px] tracking-wide opacity-75">
                {t("club2.me.memberNo").replace("{number}", member.memberNumber)}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="flex shrink-0 items-baseline gap-1.5">
                <span
                  className={cn(
                    "font-display text-[32px] font-extrabold leading-none tabular-nums transition-colors duration-700",
                    pointsFlash && "text-[#F4D58D]"
                  )}
                  data-club-points
                >
                  {member.balancePoints}
                </span>
                <span className="text-xs opacity-85">{t("club2.me.points")}</span>
              </div>
              {earnOn ? (
                // Progress to the next point (spend carried over between orders).
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/20"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progressPercent}
                  aria-label={t("club2.me.toNext").replace("{ils}", toNext)}
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#E9C46A] to-[#F4D58D] transition-[width] duration-700"
                    style={{ width: `${progressPercent}%` }}
                    data-club-progress
                  />
                </div>
              ) : null}
            </div>
            <p className="mt-2 text-xs opacity-90">
              {earnOn ? (
                <>
                  <span className="font-semibold" data-club-to-next>
                    {t("club2.me.toNext").replace("{ils}", toNext)}
                  </span>
                  {" · "}
                  {t("club2.me.ratio").replace("{ils}", ratio)}
                </>
              ) : (
                t("club2.me.earnPaused")
              )}
              {estimatedValue ? ` · ${t("club2.me.value").replace("{value}", estimatedValue)}` : ""}
            </p>
            {member.status === "suspended" ? (
              <p className="mt-2 rounded-lg bg-white/15 px-2.5 py-1.5 text-xs font-semibold">{t("club2.me.suspended")}</p>
            ) : null}
          </ClubHero>

          <Link
            href="/catalog"
            className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-turquoise text-base font-bold text-warm-white shadow-sm transition-colors hover:bg-turquoise/90"
            data-club-order
          >
            {t("club4.me.order")}
            <OrderArrow className="h-4 w-4" strokeWidth={2.25} />
          </Link>
        </div>

        <ClubCard compact className="bg-[linear-gradient(160deg,#fffaf2,#f6ecdf)]">
          <h2 className="flex items-center gap-1.5 font-display text-base font-bold text-dark-brown">
            <QrCode className="h-4 w-4 text-turquoise" strokeWidth={1.75} />
            {t("club2.me.cardTitle")}
          </h2>
          <div className="mt-2.5 flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
            {qrDataUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={qrDataUrl} alt={t("club.me.qrAlt")} className="h-24 w-24 shrink-0 rounded-md" data-club-qr />
            ) : (
              <div className="h-24 w-24 shrink-0 animate-pulse rounded-md bg-beige/50" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-dark-brown">{t("club2.me.cardHint")}</p>
              <p className="mt-0.5 font-mono text-xs tracking-wider text-coffee/70" dir="ltr">
                {member.memberNumber}
              </p>
            </div>
          </div>
        </ClubCard>

        {settings?.coffeeCardEnabled ? <ClubCoffeeCard cups={member.coffeeCups ?? 0} glowFrom={glowFrom} /> : null}

        {me!.coupons && me!.coupons.length > 0 ? <ClubCoupons coupons={me!.coupons} /> : null}

        <ClubCard compact>
          <h2 className="font-display text-base font-bold text-dark-brown">{t("club.me.historyTitle")}</h2>
          {me!.history.length === 0 ? (
            <p className="mt-2 text-sm text-coffee/60">{t("club.me.historyEmpty")}</p>
          ) : (
            <ul className="mt-1 divide-y divide-beige-dark/15" data-club-history>
              {me!.history.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-dark-brown">
                      {t(entry.kind === "welcome" ? "club2.me.kind.welcome" : `club.me.kind.${entry.kind}`)}
                    </p>
                    <p className="text-[11px] text-coffee/55">
                      {new Date(entry.createdAt).toLocaleDateString(dateLocale, { day: "numeric", month: "numeric", year: "numeric" })}
                      {entry.kind === "adjustment" && entry.reason ? ` · ${entry.reason}` : ""}
                    </p>
                  </div>
                  {entry.kind === "welcome" ? (
                    <span className="text-sm" aria-hidden>🎉</span>
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

      {/* Small, at the very end, under all the cards. */}
      <div className="mt-1 text-center">
        <button
          type="button"
          onClick={() => void signOut()}
          className="min-h-10 px-3 text-[13px] text-coffee/55 underline-offset-2 hover:text-coffee hover:underline"
          data-club-signout
        >
          {t("club.me.signOut")}
        </button>
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
