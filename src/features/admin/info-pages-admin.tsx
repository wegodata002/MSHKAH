"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Eye, EyeOff, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/components/providers/locale-provider";
import { useInfoPages } from "@/hooks/useInfoPages";
import { publishInfoPage, saveInfoPageDraft, unpublishInfoPage } from "@/services/infoPagesService";
import {
  checkPublish,
  INFO_LANGS,
  INFO_PAGE_IDS,
  INFO_PAGE_PATHS,
  placeholdersIn,
  textBlocks,
  textHasContent,
  tidyCopy,
  type InfoPageCopy,
  type InfoPageId,
  type InfoPageText,
} from "@/lib/info-pages/content";
import { AdminToastStack, createToast, type AdminToast } from "@/features/admin/components/admin-toast";
import { AdminPageHeader } from "./components/admin-page-header";
import { cn, formatDate } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/types";

const LANG_LABEL: Record<Locale, string> = { he: "עברית", ar: "العربية", en: "English" };
const card = "rounded-2xl bg-warm-white p-5 shadow-soft dark:bg-white/5";

/** Plain preview of one language, the same blocks the site draws. */
function Preview({ id, text, lang }: { id: InfoPageId; text: InfoPageText; lang: Locale }) {
  const render = (body: string) =>
    textBlocks(body).map((block, i) =>
      block.kind === "heading" ? (
        <h3 key={i} className="mt-4 font-semibold first:mt-0">{block.text}</h3>
      ) : block.kind === "list" ? (
        <ul key={i} className="mt-2 list-disc ps-5 text-sm">{block.items.map((item, j) => <li key={j}>{item}</li>)}</ul>
      ) : (
        <p key={i} className="mt-2 whitespace-pre-line text-sm">{block.text}</p>
      )
    );
  return (
    <div className="rounded-xl border border-beige-dark/30 p-4" dir={lang === "en" ? "ltr" : "rtl"} data-info-preview>
      {id === "faq"
        ? text.items.map((item, i) => (
            <div key={i} className="mt-3 first:mt-0">
              <p className="font-semibold">{item.q}</p>
              {render(item.a)}
            </div>
          ))
        : render(text.body)}
    </div>
  );
}

/**
 * Admin → Info pages: FAQ, accessibility statement, terms of use and privacy policy, in Hebrew,
 * Arabic and English. "Save draft" keeps the edits; "Publish" shows them on the site (footer link
 * appears). Pages start from a first draft written in code; nothing is on the site before Publish.
 */
export function InfoPagesAdmin() {
  const t = useT();
  const { pages, loading } = useInfoPages();
  const [pageId, setPageId] = useState<InfoPageId>("faq");
  const [lang, setLang] = useState<Locale>("he");
  const [edits, setEdits] = useState<Partial<Record<InfoPageId, InfoPageCopy>>>({});
  const [busy, setBusy] = useState<null | "save" | "publish" | "unpublish">(null);
  const [preview, setPreview] = useState(false);
  const [toasts, setToasts] = useState<AdminToast[]>([]);
  const pushToast = (message: string, type: "success" | "error" = "success") =>
    setToasts((current) => [...current, createToast(message, type)]);

  const page = pages?.[pageId];
  const draft = edits[pageId] ?? page?.draft ?? null;
  const dirty = Boolean(edits[pageId]);
  const text = draft?.[lang];
  const placeholders = text ? placeholdersIn(text) : [];
  const check = draft ? checkPublish(pageId, tidyCopy(pageId, draft)) : null;
  const differsFromSite = useMemo(
    () => Boolean(page?.published && draft && JSON.stringify(tidyCopy(pageId, draft)) !== JSON.stringify(page.published)),
    [page, draft, pageId]
  );

  const update = (next: InfoPageText) => {
    if (!draft) return;
    setEdits((current) => ({ ...current, [pageId]: { ...draft, [lang]: next } }));
  };
  const setItem = (index: number, patch: Partial<{ q: string; a: string }>) => {
    if (!text) return;
    update({ ...text, items: text.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
  };
  const moveItem = (index: number, by: -1 | 1) => {
    if (!text) return;
    const items = [...text.items];
    const [moved] = items.splice(index, 1);
    items.splice(index + by, 0, moved!);
    update({ ...text, items });
  };

  const run = async (kind: "save" | "publish" | "unpublish") => {
    if (!draft) return;
    setBusy(kind);
    try {
      if (kind === "save") {
        await saveInfoPageDraft(pageId, draft);
        pushToast(t("admin.infoPages.saved"));
      } else if (kind === "unpublish") {
        await unpublishInfoPage(pageId);
        pushToast(t("admin.infoPages.unpublished"));
      } else {
        const result = await publishInfoPage(pageId, draft);
        if (!result.ok) {
          pushToast(t(result.reason === "EMPTY_HEBREW" ? "admin.infoPages.needHebrew" : "admin.infoPages.needPlaceholders"), "error");
          return;
        }
        pushToast(t("admin.infoPages.published"));
      }
      if (kind !== "unpublish") setEdits((current) => ({ ...current, [pageId]: undefined }));
    } catch {
      pushToast(t("admin.infoPages.saveError"), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t("admin.infoPages.title")} subtitle={t("admin.infoPages.subtitle")} />

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("admin.infoPages.title")}>
        {INFO_PAGE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pageId === id}
            onClick={() => setPageId(id)}
            className={cn(
              "flex h-11 items-center gap-2 rounded-full border-2 px-4 text-sm font-semibold",
              pageId === id ? "border-turquoise bg-turquoise text-warm-white" : "border-beige-dark/30 text-dark-brown dark:text-warm-white"
            )}
            data-info-tab={id}
          >
            {t(`admin.infoPages.page.${id}`)}
            {pages?.[id].published ? <span className="h-2 w-2 rounded-full bg-emerald-400" aria-label={t("admin.infoPages.live")} /> : null}
            {edits[id] ? <span className="text-xs opacity-80">•</span> : null}
          </button>
        ))}
      </div>

      {loading || !draft || !text ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-turquoise" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className={cn(card, "space-y-4 lg:col-span-2")}>
            <div className="flex gap-2 rounded-xl bg-beige/25 p-1">
              {INFO_LANGS.map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setLang(value)}
                  className={cn("flex-1 rounded-lg px-3 py-2 text-sm", lang === value && "bg-warm-white font-semibold text-turquoise shadow-sm")}
                  data-info-lang={value}
                >
                  {LANG_LABEL[value]}
                  {!textHasContent(pageId, draft[value]) ? " ⚠" : ""}
                </button>
              ))}
            </div>

            {placeholders.length > 0 && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status" data-info-placeholders>
                {t("admin.infoPages.placeholdersNote")} {placeholders.join(" · ")}
              </p>
            )}

            {pageId === "faq" ? (
              <div className="space-y-4">
                <p className="text-xs text-coffee/60">{t("admin.infoPages.faqLiveNote")}</p>
                {text.items.map((item, index) => (
                  <div key={index} className="space-y-2 rounded-xl border border-beige-dark/25 p-3" data-faq-row>
                    <div className="flex items-center gap-2">
                      <Input
                        dir={lang === "en" ? "ltr" : "rtl"}
                        value={item.q}
                        onChange={(e) => setItem(index, { q: e.target.value })}
                        placeholder={t("admin.infoPages.question")}
                        aria-label={t("admin.infoPages.question")}
                      />
                      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" disabled={index === 0} onClick={() => moveItem(index, -1)} aria-label={t("admin.infoPages.moveUp")}>
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" disabled={index === text.items.length - 1} onClick={() => moveItem(index, 1)} aria-label={t("admin.infoPages.moveDown")}>
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11 shrink-0 text-red-600"
                        onClick={() => update({ ...text, items: text.items.filter((_, i) => i !== index) })}
                        aria-label={t("admin.infoPages.removeQuestion")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea
                      dir={lang === "en" ? "ltr" : "rtl"}
                      value={item.a}
                      onChange={(e) => setItem(index, { a: e.target.value })}
                      placeholder={t("admin.infoPages.answer")}
                      aria-label={t("admin.infoPages.answer")}
                      rows={3}
                    />
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={() => update({ ...text, items: [...text.items, { q: "", a: "" }] })} data-faq-add>
                  <Plus className="me-1.5 h-4 w-4" /> {t("admin.infoPages.addQuestion")}
                </Button>
              </div>
            ) : (
              <div>
                <Label htmlFor="info-body">{t("admin.infoPages.body")}</Label>
                <Textarea
                  id="info-body"
                  dir={lang === "en" ? "ltr" : "rtl"}
                  value={text.body}
                  onChange={(e) => update({ ...text, body: e.target.value })}
                  rows={22}
                  className="mt-1 font-mono text-sm"
                  data-info-body-input
                />
              </div>
            )}
            <p className="text-xs text-coffee/60">{t("admin.infoPages.formatHint")}</p>

            <Button type="button" variant="ghost" onClick={() => setPreview((v) => !v)} className="px-0">
              {preview ? <EyeOff className="me-1.5 h-4 w-4" /> : <Eye className="me-1.5 h-4 w-4" />}
              {t("admin.infoPages.preview")}
            </Button>
            {preview ? <Preview id={pageId} text={text} lang={lang} /> : null}
          </div>

          <div className={cn(card, "h-fit space-y-4")}>
            <div>
              <p className="text-sm font-semibold">{t("admin.infoPages.status")}</p>
              <p className="mt-1 text-sm text-coffee/70" data-info-status>
                {page?.published
                  ? `${t("admin.infoPages.live")}${page.publishedAt ? ` · ${formatDate(page.publishedAt)}` : ""}`
                  : t("admin.infoPages.notLive")}
              </p>
              {differsFromSite || (dirty && page?.published) ? <p className="mt-1 text-xs text-amber-700">{t("admin.infoPages.unpublishedChanges")}</p> : null}
              {check?.ok && check.missing.length ? (
                <p className="mt-1 text-xs text-coffee/60">
                  {t("admin.infoPages.missingLangs").replace("{langs}", check.missing.map((l) => LANG_LABEL[l]).join(", "))}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Button type="button" variant="outline" disabled={busy !== null || !dirty} onClick={() => void run("save")} data-info-save>
                {busy === "save" ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {t("admin.infoPages.saveDraft")}
              </Button>
              <Button type="button" variant="turquoise" disabled={busy !== null || !check?.ok} onClick={() => void run("publish")} data-info-publish>
                {busy === "publish" ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {t("admin.infoPages.publish")}
              </Button>
              {check && !check.ok ? (
                <p className="text-xs text-red-700" data-info-blocked>
                  {t(check.reason === "EMPTY_HEBREW" ? "admin.infoPages.needHebrew" : "admin.infoPages.needPlaceholders")}
                </p>
              ) : null}
              {page?.published ? (
                <>
                  <Button asChild variant="ghost">
                    <a href={INFO_PAGE_PATHS[pageId]} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="me-1.5 h-4 w-4" /> {t("admin.infoPages.viewOnSite")}
                    </a>
                  </Button>
                  <Button type="button" variant="ghost" className="text-red-700" disabled={busy !== null} onClick={() => void run("unpublish")} data-info-unpublish>
                    {t("admin.infoPages.unpublish")}
                  </Button>
                </>
              ) : null}
            </div>
            <p className="text-xs leading-relaxed text-coffee/55">{t("admin.infoPages.legalNote")}</p>
          </div>
        </div>
      )}
      <AdminToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
