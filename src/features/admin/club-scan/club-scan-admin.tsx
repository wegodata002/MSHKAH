"use client";

import { useState } from "react";
import { Camera, Coffee, Gift, Loader2, Minus, Plus, RotateCcw, Search, Ticket } from "lucide-react";
import { AdminPageHeader } from "@/features/admin/components/admin-page-header";
import { AdminCard } from "@/features/admin/components/admin-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { COFFEE_MAX_ADD, type ScanSummary } from "@/lib/loyalty/coffee";
import { CoffeeStamps } from "@/features/club/club-coffee-card";
import { QrCamera } from "@/features/admin/club-scan/qr-camera";
import { cn } from "@/lib/utils";

const DATE_LOCALES = { he: "he-IL", ar: "ar-u-nu-latn", en: "en-GB" } as const;

type ActionAnswer = { ok: boolean; reason?: string; secondsAgo?: number; summary?: ScanSummary };

function requestId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Staff "scan card" screen (Admin / Manager / Employee): camera or member number → name, member
 * number, masked email; coffee cups (+ cups, free cup), the 10% code "used", history with undo.
 */
export function ClubScanAdmin() {
  const t = useT();
  const { locale } = useLocale();
  const [camera, setCamera] = useState(false);
  const [number, setNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "ok" } | null>(null);
  const [count, setCount] = useState(1);
  const [recent, setRecent] = useState<{ secondsAgo: number; id: string } | null>(null);
  const [confirmCoupon, setConfirmCoupon] = useState<string | null>(null);

  const dateLocale = DATE_LOCALES[locale] ?? "he-IL";
  const fmt = (iso: string, withTime = true) =>
    new Date(iso).toLocaleString(dateLocale, {
      day: "numeric",
      month: "numeric",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : { year: "numeric" }),
      timeZone: "Asia/Jerusalem",
    });

  async function lookup(input: { qr?: string; memberNumber?: string }) {
    setLoading(true);
    setMessage(null);
    setRecent(null);
    setConfirmCoupon(null);
    const result = await clientAdminFetch<{ summary: ScanSummary }>("/api/admin/club/scan", input);
    setLoading(false);
    if (result.ok && result.data?.summary) {
      setSummary(result.data.summary);
      setCount(1);
      return;
    }
    setSummary(null);
    setMessage({ text: t(result.status === 404 ? "club3.scan.notFound" : "club3.scan.error"), tone: "error" });
  }

  async function act(body: Record<string, unknown>, okKey: string) {
    if (!summary) return;
    setBusy(true);
    setMessage(null);
    const result = await clientAdminFetch<ActionAnswer>("/api/admin/club/coffee", { memberId: summary.member.id, ...body });
    setBusy(false);
    const answer = (result.data ?? {}) as ActionAnswer;
    if (answer.summary) setSummary(answer.summary);
    if (result.ok && answer.ok) {
      setRecent(null);
      setConfirmCoupon(null);
      setMessage({ text: t(okKey), tone: "ok" });
      return;
    }
    if (answer.reason === "recent") {
      setRecent({ secondsAgo: answer.secondsAgo ?? 0, id: String(body.requestId) });
      return;
    }
    setMessage({ text: t(`club3.scan.err.${answer.reason ?? "error"}`, t("club3.scan.error")), tone: "error" });
  }

  const addCups = (confirm = false, id = requestId()) =>
    act({ action: "add", count, requestId: id, confirm }, "club3.scan.added");

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t("club3.scan.title")} subtitle={t("club3.scan.subtitle")} />

      <AdminCard>
        {camera ? (
          <QrCamera
            onResult={(text) => {
              setCamera(false);
              void lookup({ qr: text });
            }}
            onClose={() => setCamera(false)}
          />
        ) : null}
        <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center", camera && "mt-3")}>
          {!camera ? (
            <Button type="button" onClick={() => setCamera(true)} className="h-12 rounded-xl text-base" data-scan-camera>
              <Camera className="h-5 w-5" /> {t("club3.scan.camera")}
            </Button>
          ) : null}
          <span className="text-center text-sm text-coffee/50">{t("club3.scan.or")}</span>
          <form
            className="flex flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (number.trim()) void lookup({ memberNumber: number });
            }}
          >
            <Input
              value={number}
              onChange={(event) => setNumber(event.target.value.toUpperCase())}
              placeholder="M-1234-ABCD"
              dir="ltr"
              autoCapitalize="characters"
              autoComplete="off"
              aria-label={t("club3.scan.memberNumber")}
              className="h-12 font-mono text-base tracking-wider"
              data-scan-number
            />
            <Button type="submit" variant="outline" className="h-12 rounded-xl" disabled={loading || !number.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {t("club3.scan.find")}
            </Button>
          </form>
        </div>
        {message ? (
          <p
            className={cn(
              "mt-3 rounded-xl p-3 text-sm font-semibold",
              message.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
            )}
            role={message.tone === "ok" ? "status" : "alert"}
            data-scan-message={message.tone}
          >
            {message.text}
          </p>
        ) : null}
      </AdminCard>

      {summary ? (
        <>
          <AdminCard>
            <div className="flex flex-wrap items-baseline justify-between gap-2" data-scan-member>
              <div>
                <p className="text-2xl font-bold text-dark-brown" data-scan-name>
                  {summary.member.name || "—"}
                </p>
                <p className="mt-0.5 text-sm text-coffee/65" dir="ltr">
                  <span className="font-mono">{summary.member.memberNumber}</span> · {summary.member.maskedEmail}
                </p>
              </div>
              {summary.member.status !== "active" ? (
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
                  {t("club3.scan.inactive")}
                </span>
              ) : null}
            </div>
          </AdminCard>

          {summary.coffee.enabled ? (
            <AdminCard>
              <h2 className="flex items-center gap-2 text-lg font-bold text-dark-brown">
                <Coffee className="h-5 w-5 text-turquoise" /> {t("club3.coffee.title")}
              </h2>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <CoffeeStamps cups={summary.coffee.cups} size="lg" />
                <span className="text-sm font-semibold text-coffee/70" data-scan-cups={summary.coffee.cups}>
                  {t("club3.scan.cups").replace("{n}", String(summary.coffee.cups))}
                </span>
              </div>

              {summary.coffee.giftReady ? (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void act({ action: "gift", requestId: requestId() }, "club3.scan.giftDone")}
                  className="mt-4 h-12 w-full rounded-xl bg-[#E9C46A] text-base font-bold text-dark-brown hover:bg-[#E2B94F] sm:w-auto"
                  data-scan-gift
                >
                  <Gift className="h-5 w-5" /> {t("club3.scan.redeemGift")}
                </Button>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="flex items-center rounded-xl border border-beige-dark/30">
                  <button
                    type="button"
                    className="flex h-12 w-12 items-center justify-center text-coffee disabled:opacity-40"
                    onClick={() => setCount((c) => Math.max(1, c - 1))}
                    disabled={count <= 1}
                    aria-label="−"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-8 text-center text-lg font-bold tabular-nums" data-scan-count>
                    {count}
                  </span>
                  <button
                    type="button"
                    className="flex h-12 w-12 items-center justify-center text-coffee disabled:opacity-40"
                    onClick={() => setCount((c) => Math.min(COFFEE_MAX_ADD, c + 1))}
                    disabled={count >= COFFEE_MAX_ADD}
                    aria-label="+"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <Button
                  type="button"
                  disabled={busy || summary.member.status !== "active"}
                  onClick={() => void addCups()}
                  className="h-12 rounded-xl text-base"
                  data-scan-add
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-5 w-5" />}
                  {count === 1 ? t("club3.scan.addOne") : t("club3.scan.addMany").replace("{n}", String(count))}
                </Button>
              </div>

              {recent ? (
                <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm" role="alert" data-scan-recent>
                  <p className="font-semibold text-amber-900">
                    {t("club3.scan.recent").replace("{s}", String(recent.secondsAgo))}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" disabled={busy} onClick={() => void addCups(true, recent.id)} data-scan-recent-yes>
                      {t("club3.scan.recentYes")}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setRecent(null)}>
                      {t("club3.scan.cancel")}
                    </Button>
                  </div>
                </div>
              ) : null}
            </AdminCard>
          ) : null}

          {summary.coupons.length > 0 ? (
            <AdminCard>
              {summary.coupons.map((coupon) => (
                <div key={coupon.code} className="flex flex-wrap items-center justify-between gap-3" data-scan-coupon>
                  <div>
                    <p className="flex items-center gap-2 font-bold text-dark-brown">
                      <Ticket className="h-5 w-5 text-turquoise" />
                      {t("club3.scan.couponAvailable").replace("{percent}", String(coupon.percent))}
                    </p>
                    <p className="mt-0.5 text-sm text-coffee/65">
                      <span className="font-mono" dir="ltr">
                        {coupon.code}
                      </span>{" "}
                      · {t("club2.coupon.validUntil").replace("{date}", fmt(coupon.expiresAt, false))}
                    </p>
                  </div>
                  {confirmCoupon === coupon.code ? (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => void act({ action: "coupon", code: coupon.code, requestId: requestId() }, "club3.scan.couponDone")}
                        data-scan-coupon-confirm
                      >
                        {t("club3.scan.couponConfirm")}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setConfirmCoupon(null)}>
                        {t("club3.scan.cancel")}
                      </Button>
                    </div>
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setConfirmCoupon(coupon.code)} data-scan-coupon-use>
                      {t("club3.scan.couponUse")}
                    </Button>
                  )}
                </div>
              ))}
            </AdminCard>
          ) : null}

          <AdminCard title={t("club3.scan.history")}>
            {summary.history.length === 0 ? (
              <p className="text-sm text-coffee/60">{t("club3.scan.historyEmpty")}</p>
            ) : (
              <ul className="divide-y divide-beige-dark/15" data-scan-history>
                {summary.history.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm" data-scan-entry={entry.kind}>
                    <span className="w-24 shrink-0 tabular-nums text-coffee/60" dir="ltr">
                      {fmt(entry.createdAt)}
                    </span>
                    <span className={cn("flex-1 font-semibold text-dark-brown", entry.undoneAt && "text-coffee/40 line-through")}>
                      {entry.kind === "cups"
                        ? t("club3.scan.h.cups").replace("{n}", String(entry.cups))
                        : entry.kind === "gift"
                          ? t("club3.scan.h.gift")
                          : t("club3.scan.h.coupon").replace("{code}", entry.couponCode ?? "")}
                    </span>
                    <span className="text-coffee/60">
                      {entry.actorName} ({t(`club3.scan.role.${entry.actorRole}`, entry.actorRole)})
                    </span>
                    {entry.undoneAt ? (
                      <span className="rounded-full bg-coffee/10 px-2 py-0.5 text-xs font-bold text-coffee/60">{t("club3.scan.undone")}</span>
                    ) : null}
                    {entry.canUndo ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void act({ action: "undo", entryId: entry.id }, "club3.scan.undoDone")}
                        className="text-red-700"
                        data-scan-undo
                      >
                        <RotateCcw className="h-4 w-4" /> {t("club3.scan.undo")}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </>
      ) : null}
    </div>
  );
}
