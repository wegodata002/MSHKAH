"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, Printer, UtensilsCrossed } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { createQrPngDataUrl } from "@/lib/admin-qr-image";
import { tableQrUrl } from "@/lib/admin-qr-links";
import { tableAreaName, tableDisplayName, tablesByArea, type DineInTable } from "@/lib/fulfillment/settings";

const PREVIEW_PX = 240;
const LABELED_PX = 1024;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** The table's QR with its name under it ("שולחן 4 · פנים" + "Scan to order"), as a PNG. */
export async function labeledTableQrPng(url: string, title: string, subtitle: string, rtl: boolean): Promise<string> {
  const qr = await loadImage(await createQrPngDataUrl(url, LABELED_PX));
  const pad = Math.round(LABELED_PX * 0.06);
  const textArea = Math.round(LABELED_PX * 0.3);
  const canvas = document.createElement("canvas");
  canvas.width = LABELED_PX + pad * 2;
  canvas.height = LABELED_PX + pad * 2 + textArea;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(qr, pad, pad, LABELED_PX, LABELED_PX);
  ctx.fillStyle = "#1A1410";
  ctx.textAlign = "center";
  ctx.direction = rtl ? "rtl" : "ltr";
  const centerX = canvas.width / 2;
  ctx.font = `bold ${Math.round(LABELED_PX * 0.1)}px "Heebo", "Cairo", Arial, sans-serif`;
  ctx.fillText(title, centerX, LABELED_PX + pad + textArea * 0.45);
  ctx.font = `${Math.round(LABELED_PX * 0.055)}px "Heebo", "Cairo", Arial, sans-serif`;
  ctx.fillStyle = "#6B5A52";
  ctx.fillText(subtitle, centerX, LABELED_PX + pad + textArea * 0.8);
  return canvas.toDataURL("image/png");
}

/** Print page: 6 tables per A4 sheet, with cut lines. Opened in a new window and printed from there. */
export function tablesPrintHtml(cards: { title: string; subtitle: string; png: string }[], dir: "rtl" | "ltr", pageTitle: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const items = cards
    .map((c) => `<figure><img src="${c.png}" alt="${esc(c.title)}"><figcaption>${esc(c.title)}</figcaption></figure>`)
    .join("");
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(pageTitle)}</title>
<style>
@page{size:A4;margin:10mm}
*{box-sizing:border-box}body{margin:0;font-family:Heebo,Cairo,Arial,sans-serif;color:#1a1410}
.sheet{display:grid;grid-template-columns:1fr 1fr;gap:6mm}
figure{margin:0;height:88mm;border:1px dashed #b8ab9b;border-radius:3mm;display:flex;flex-direction:column;align-items:center;justify-content:center;page-break-inside:avoid;padding:3mm}
figure img{height:76mm;width:auto}
figcaption{display:none}
@media screen{body{padding:16px;background:#f4efe8}.sheet{max-width:190mm;margin:auto;background:#fff;padding:10mm}}
</style></head><body><div class="sheet">${items}</div>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)})</script></body></html>`;
}

function TableQrCard({ table }: { table: DineInTable }) {
  const t = useT();
  const { locale, dir } = useLocale();
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const url = tableQrUrl(table.id);

  useEffect(() => {
    let cancelled = false;
    void createQrPngDataUrl(url, PREVIEW_PX).then((png) => !cancelled && setPreview(png));
    return () => {
      cancelled = true;
    };
  }, [url]);

  const download = async () => {
    setBusy(true);
    try {
      const png = await labeledTableQrPng(url, tableDisplayName(table, locale), t("admin.qr.tables.scanToOrder"), dir === "rtl");
      const a = document.createElement("a");
      a.href = png;
      a.download = `mishkah-qr-table-${table.id}.png`;
      a.click();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-xl bg-white p-3 text-center shadow-soft dark:bg-white/10" data-table-qr={table.id}>
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt={tableDisplayName(table, locale)} className="mx-auto h-28 w-28" />
      ) : (
        <div className="mx-auto h-28 w-28 animate-pulse rounded bg-beige/50" />
      )}
      <p className="mt-2 text-sm font-bold text-dark-brown dark:text-warm-white">{tableDisplayName(table, locale)}</p>
      <p className="truncate text-[10px] text-coffee/50" dir="ltr" title={url}>
        {url.replace(/^https?:\/\//, "")}
      </p>
      <Button type="button" size="sm" variant="outline" className="mt-2 w-full" disabled={busy} onClick={() => void download()}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        PNG
      </Button>
    </li>
  );
}

/**
 * Admin QR page: one QR per table, exactly the tables saved in the settings ("Order options"),
 * read only. Each downloads as a PNG with its name; "Print all tables" makes an A4 sheet.
 */
export function TableQrSection() {
  const t = useT();
  const { locale, dir } = useLocale();
  const { settings, loading } = useSettings();
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState(false);
  const dineIn = settings?.fulfillment.dineIn;
  const groups = tablesByArea(dineIn?.tables ?? []);
  const all = groups.flatMap((g) => g.tables);

  const printAll = async () => {
    setPrinting(true);
    setPrintError(false);
    // Open the window first (inside the click), then fill it: browsers block windows opened later.
    const win = window.open("", "_blank");
    try {
      if (!win) {
        setPrintError(true);
        return;
      }
      const cards = await Promise.all(
        all.map(async (table) => {
          const title = tableDisplayName(table, locale);
          return { title, subtitle: "", png: await labeledTableQrPng(tableQrUrl(table.id), title, t("admin.qr.tables.scanToOrder"), dir === "rtl") };
        })
      );
      win.document.open();
      win.document.write(tablesPrintHtml(cards, dir === "rtl" ? "rtl" : "ltr", t("admin.qr.tables.title")));
      win.document.close();
    } finally {
      setPrinting(false);
    }
  };

  return (
    <section className="space-y-4" data-table-qr-section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold text-dark-brown dark:text-warm-white">
            <UtensilsCrossed className="h-5 w-5 text-turquoise" />
            {t("admin.qr.tables.title")}
            {all.length > 0 && <span className="text-sm font-normal text-coffee/55">· {t("admin.qr.tables.count").replace("{n}", String(all.length))}</span>}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-coffee/60">{t("admin.qr.tables.hint")}</p>
        </div>
        {all.length > 0 && (
          <Button type="button" onClick={() => void printAll()} disabled={printing} data-print-tables>
            {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
            {t("admin.qr.tables.printAll")}
          </Button>
        )}
      </div>
      {printError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{t("admin.qr.tables.popupBlocked")}</p>}
      {dineIn && !dineIn.enabled && all.length > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" data-dine-in-off>{t("admin.qr.tables.off")}</p>
      )}

      {loading && !settings ? (
        <Loader2 className="h-6 w-6 animate-spin text-turquoise" />
      ) : all.length === 0 ? (
        <p className="rounded-xl border border-dashed border-beige-dark/40 p-6 text-center text-sm text-coffee/60" data-no-tables>
          {t("admin.qr.tables.none")}
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.area}>
            <p className="mb-2 text-sm font-semibold text-coffee/70">{tableAreaName(group.area, locale)}</p>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" data-table-group={group.area}>
              {group.tables.map((table) => (
                <TableQrCard key={table.id} table={table} />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
