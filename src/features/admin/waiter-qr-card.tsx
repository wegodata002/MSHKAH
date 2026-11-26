"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, Download, Loader2, Lock, Printer, QrCode, RefreshCw } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { AdminCard } from "@/features/admin/components/admin-card";
import { clientAdminFetch, isPermissionDenied } from "@/lib/auth/client-admin-fetch";
import { createQrPngDataUrl } from "@/lib/admin-qr-image";
import { ADMIN_QR_DOWNLOAD_PX, ADMIN_QR_PREVIEW_PX } from "@/lib/admin-qr-links";
import { ADMIN_TRANSLATIONS } from "@/data/admin-translations";

type WaiterQr = { url: string; version: number; createdAt: string; disconnected: number };

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" });
}

/**
 * The printed sheet: the QR large, and what it is for in Hebrew, Arabic and English (whoever reads
 * it in the work area), each line in its own direction. No link text on paper.
 */
export function waiterQrPrintHtml(png: string, version: number): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]!);
  const lines = (["he", "ar", "en"] as const)
    .map((lang) => {
      const tr = ADMIN_TRANSLATIONS[lang];
      const dir = lang === "en" ? "ltr" : "rtl";
      return `<div class="line" lang="${lang}" dir="${dir}"><strong>${esc(tr["admin.waiterQr.printTitle"] ?? "")}</strong><span>${esc(tr["admin.waiterQr.printNote"] ?? "")}</span></div>`;
    })
    .join("");
  return `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${esc(ADMIN_TRANSLATIONS.he["admin.qr.waitersName"] ?? "")}</title>
<style>
@page{size:A4;margin:15mm}
*{box-sizing:border-box}body{margin:0;font-family:Heebo,Cairo,Arial,sans-serif;color:#1a1410;text-align:center}
.sheet{display:flex;flex-direction:column;align-items:center;gap:6mm;padding-top:10mm}
img{width:120mm;height:120mm}
.line{display:flex;flex-direction:column;gap:1mm;text-align:center}
.line strong{font-size:20pt}.line span{font-size:11pt;color:#6B5A52}
.version{font-size:9pt;color:#9a8b80}
@media screen{body{padding:16px;background:#f4efe8}.sheet{max-width:190mm;margin:auto;background:#fff;padding:12mm}}
</style></head><body><div class="sheet"><img src="${png}" alt="QR">${lines}<p class="version" dir="ltr">v${version}</p></div>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)})</script></body></html>`;
}

/**
 * Admin → QR → "Waiters": the QR with the secret link (Admin only). Printed and shown only in the
 * work area: scanning it signs the device in to the waiter screen for 90 days. "Replace QR" makes a
 * new one and disconnects every device that joined with the old one.
 * `allowReplace={false}` (the dashboard): download, print and copy only; replacing is on the QR page.
 */
export function WaiterQrCard({ index = 0, allowReplace = true }: { index?: number; allowReplace?: boolean }) {
  const t = useT();
  const [qr, setQr] = useState<WaiterQr | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [preview, setPreview] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [printBlocked, setPrintBlocked] = useState(false);

  const load = useCallback(async (action: "waiter-qr" | "rotate-waiter-qr") => {
    const result = await clientAdminFetch<{ qr: WaiterQr }>("/api/admin/staff", { action });
    if (result.ok && result.data) {
      setQr(result.data.qr);
      setState("ready");
      return result.data.qr;
    }
    // No permission only on 401/403; a server failure (no Admin key, 500/503) says "couldn't load".
    setState(isPermissionDenied(result) ? "denied" : "error");
    return null;
  }, []);

  useEffect(() => {
    void load("waiter-qr");
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    setPreview("");
    if (qr) void createQrPngDataUrl(qr.url, ADMIN_QR_PREVIEW_PX).then((url) => !cancelled && setPreview(url));
    return () => {
      cancelled = true;
    };
  }, [qr]);

  const download = async () => {
    if (!qr) return;
    const a = document.createElement("a");
    a.href = await createQrPngDataUrl(qr.url, ADMIN_QR_DOWNLOAD_PX);
    a.download = `mishkah-qr-waiters-${qr.version}.png`;
    a.click();
  };

  // Opened before the QR is drawn, so the browser treats it as the click's own window.
  const print = async () => {
    if (!qr) return;
    setPrintBlocked(false);
    const win = window.open("", "_blank");
    if (!win) {
      setPrintBlocked(true);
      return;
    }
    win.document.write(waiterQrPrintHtml(await createQrPngDataUrl(qr.url, ADMIN_QR_DOWNLOAD_PX), qr.version));
    win.document.close();
  };

  // The secret link itself, to send to one waiter (Admin only: the card has no link otherwise).
  const copyLink = async () => {
    if (!qr) return;
    try {
      await navigator.clipboard.writeText(qr.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const rotate = async () => {
    setBusy(true);
    setNotice(null);
    const next = await load("rotate-waiter-qr");
    setBusy(false);
    setConfirming(false);
    if (next) setNotice(t("admin.waiterQr.replaced").replace("{n}", String(next.disconnected)));
  };

  return (
    <AdminCard title={t("admin.qr.waitersName")} icon={<QrCode className="h-4 w-4 text-turquoise" />} delay={0.08 * index}>
      <div className="flex flex-col items-center gap-4" data-waiter-qr>
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          {t("admin.waiterQr.secretNote")}
        </p>
        {state === "loading" ? (
          <Loader2 className="h-6 w-6 animate-spin text-turquoise" />
        ) : state === "denied" ? (
          <p className="text-sm text-coffee/70" data-waiter-qr-denied>{t("admin.waiterQr.adminOnly")}</p>
        ) : state === "error" || !qr ? (
          <div className="flex flex-col items-center gap-2" data-waiter-qr-error>
            <p className="text-sm text-red-700">{t("admin.waiterQr.loadError")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setState("loading");
                void load("waiter-qr");
              }}
              data-waiter-qr-retry
            >
              {t("admin.action.retry")}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex w-full max-w-[320px] items-center justify-center rounded-2xl border border-beige-dark/20 bg-white p-4 dark:border-white/10">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt={t("admin.qr.waitersName")} className="h-auto w-full min-h-[240px]" data-waiter-qr-image />
              ) : (
                <div className="flex aspect-square w-full min-h-[240px] items-center justify-center text-sm text-coffee/50">{t("admin.qr.generating")}</div>
              )}
            </div>
            <p className="text-xs text-coffee/60" data-waiter-qr-version>
              {t("admin.waiterQr.version").replace("{n}", String(qr.version)).replace("{when}", dateTime(qr.createdAt))}
            </p>
            {notice && (
              <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status" data-waiter-qr-notice>
                {notice}
              </p>
            )}
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
              <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={() => void copyLink()} data-waiter-qr-copy>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? t("admin.qr.copied") : t("admin.qr.copy")}
              </Button>
              <Button type="button" variant="turquoise" className="h-10 rounded-xl" onClick={() => void download()} data-waiter-qr-download>
                <Download className="h-4 w-4" />
                {t("admin.qr.download")}
              </Button>
              <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={() => void print()} data-waiter-qr-print>
                <Printer className="h-4 w-4" />
                {t("admin.waiterQr.print")}
              </Button>
              {allowReplace && !confirming && (
                <Button type="button" variant="outline" className="h-10 rounded-xl border-red-200 text-red-700" onClick={() => setConfirming(true)} data-waiter-qr-replace>
                  <RefreshCw className="h-4 w-4" />
                  {t("admin.waiterQr.replace")}
                </Button>
              )}
            </div>
            <p className="-mt-2 flex items-center gap-1.5 text-xs text-coffee/60" data-waiter-qr-copy-note>
              <Lock className="h-3.5 w-3.5 shrink-0" />
              {t("admin.waiterQr.copyNote")}
            </p>
            {printBlocked && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" data-waiter-qr-print-blocked>{t("admin.qr.tables.popupBlocked")}</p>}
            {allowReplace && confirming && (
              <div className="w-full rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" data-waiter-qr-confirm>
                <p>{t("admin.waiterQr.replaceConfirm")}</p>
                <div className="mt-3 flex gap-2">
                  <Button type="button" size="sm" className="bg-red-600 text-white hover:bg-red-700" disabled={busy} onClick={() => void rotate()} data-waiter-qr-replace-yes>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {t("admin.waiterQr.replaceYes")}
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(false)}>
                    {t("admin.staff.cancel")}
                  </Button>
                </div>
              </div>
            )}
            <Link href="/admin/staff" className="text-sm font-medium text-turquoise underline" data-waiter-qr-devices-link>
              {t("admin.waiterQr.devicesLink")}
            </Link>
          </>
        )}
      </div>
    </AdminCard>
  );
}
