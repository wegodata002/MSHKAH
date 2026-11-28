"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Search, Square, Trash2, X } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminPageHeader } from "@/features/admin/components/admin-page-header";
import { AdminModal, AdminModalBody, AdminModalFooter, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { useAllProducts } from "@/hooks/useProducts";
import { clientAdminFetch, isPermissionDenied } from "@/lib/auth/client-admin-fetch";
import { getLocalizedName } from "@/lib/i18n/localized-content";
import { applySale, isoToIsraelLocal, israelLocalToIso, saleUntilText, type SaleKind } from "@/lib/sales/sale-price";
import type { SaleError, SaleRecord, SaleStatus } from "@/lib/sales/admin";
import { cn, formatPrice } from "@/lib/utils";
import type { Product } from "@/types";
import { FreeDeliveryFields } from "@/features/admin/free-delivery-fields";

type Item = SaleRecord & { status: SaleStatus };
type Filter = "all" | SaleStatus;
type Form = { name: { he: string; ar: string; en: string }; kind: SaleKind; value: string; starts: string; ends: string; productIds: string[]; freeDelivery: boolean; freeDeliveryMin: string };

const KINDS: SaleKind[] = ["percent", "amount", "price"];
const LANGS = [
  { id: "he", label: "עברית", dir: "rtl" },
  { id: "ar", label: "العربية", dir: "rtl" },
  { id: "en", label: "English", dir: "ltr" },
] as const;
const STATUS_STYLE: Record<SaleStatus, string> = {
  active: "bg-emerald-50 text-emerald-800",
  scheduled: "bg-sky-50 text-sky-800",
  ended: "bg-stone-100 text-stone-600",
};

function emptyForm(): Form {
  const start = new Date();
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 7 * 86400_000);
  return { name: { he: "", ar: "", en: "" }, kind: "percent", value: "", starts: isoToIsraelLocal(start.toISOString()), ends: isoToIsraelLocal(end.toISOString()), productIds: [], freeDelivery: false, freeDeliveryMin: "" };
}

/** "−20%", "−₪5" or "₪10" for the list. */
function discountText(sale: Pick<SaleRecord, "kind" | "value">): string {
  return sale.kind === "percent" ? `‎${sale.value}%` : sale.kind === "amount" ? `‎−${formatPrice(sale.value)}` : formatPrice(sale.value);
}

/**
 * Admin → Sales (Admin only). Choose products, a discount (% / ₪ off / a new price) and the dates.
 * Saved and priced on the server, which copies the sale onto the products; "End now" and "Delete"
 * take it off the products at once. One sale per product at a time (overlaps are refused).
 */
export function SalesAdmin() {
  const t = useT();
  const { locale } = useLocale();
  const { firebaseUser, loading: authLoading } = useAuth();
  const { products } = useAllProducts();
  const [items, setItems] = useState<Item[] | null>(null);
  const [loadError, setLoadError] = useState<"denied" | "failed" | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [lang, setLang] = useState<"he" | "ar" | "en">("he");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ item: Item; mode: "end" | "delete" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const nameOf = useCallback((id: string) => {
    const p = byId.get(id);
    return p ? getLocalizedName(p, locale) : id;
  }, [byId, locale]);

  const load = useCallback(async () => {
    setLoadError(null);
    const result = await clientAdminFetch<{ sales: Item[] }>("/api/admin/sales", { action: "list" });
    if (result.ok && result.data) setItems(result.data.sales);
    else setLoadError(isPermissionDenied(result) ? "denied" : "failed");
  }, []);
  useEffect(() => {
    if (authLoading || !firebaseUser) return;
    void load();
  }, [load, authLoading, firebaseUser]);

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, scheduled: 0, ended: 0 };
    for (const s of items ?? []) {
      c.all += 1;
      c[s.status] += 1;
    }
    return c;
  }, [items]);
  const shown = (items ?? []).filter((s) => filter === "all" || s.status === filter);

  const errorText = (error: SaleError | { code?: string } | undefined): string => {
    const code = error?.code ?? "";
    const e = error as SaleError;
    if (e?.code === "OVERLAP") return t("admin.sales.error.OVERLAP").replace("{sale}", e.saleName).replace("{products}", e.products.join(", "));
    if (e?.code === "NOT_LOWER") return t("admin.sales.error.NOT_LOWER").replace("{products}", e.products.join(", "));
    if (e?.code === "FREE_DELIVERY_MIN") return t("admin.bundles.error.FREE_DELIVERY_MIN");
    if (e?.code === "TOO_MANY_PRODUCTS") return t("admin.sales.error.TOO_MANY_PRODUCTS").replace("{max}", String(e.max));
    const known = ["NAME", "KIND", "VALUE", "DATES", "NO_PRODUCTS", "PRODUCT_NOT_FOUND", "NOT_FOUND", "NOT_ACTIVE"];
    return t(known.includes(code) ? `admin.sales.error.${code}` : "admin.sales.error.generic");
  };

  const openCreate = () => {
    setFormError(null);
    setLang("he");
    setSearch("");
    setEditing({ id: null, form: emptyForm() });
  };
  const openEdit = (s: Item) => {
    setFormError(null);
    setLang("he");
    setSearch("");
    setEditing({
      id: s.id,
      form: { name: { ...s.name }, kind: s.kind, value: String(s.value), starts: isoToIsraelLocal(s.startsAt), ends: isoToIsraelLocal(s.endsAt), productIds: [...s.productIds], freeDelivery: s.freeDelivery === true, freeDeliveryMin: s.freeDeliveryMin ? String(s.freeDeliveryMin) : "" },
    });
  };
  const setForm = (patch: Partial<Form>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  // Preview: each chosen product's regular price → sale price (or why it would not go lower).
  const value = Number(editing?.form.value);
  const preview = (editing?.form.productIds ?? []).map((id) => {
    const p = byId.get(id);
    const regular = Number(p?.price);
    const ok = Number.isFinite(value) && value > 0 && Number.isFinite(regular) && regular > 0;
    const price = ok ? applySale(regular, { kind: editing!.form.kind, value }) : NaN;
    return { id, name: nameOf(id), regular, price, lower: ok && price < regular && !(editing!.form.kind !== "percent" && value >= regular) };
  });

  const matches = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    if (!q || !editing) return [] as Product[];
    return products
      .filter((p) => !p.hidden && !p.isTestProduct && !editing.form.productIds.includes(p.id))
      .filter((p) => [p.name_he, p.name_ar, p.name_en].some((n) => (n ?? "").toLocaleLowerCase().includes(q)))
      .slice(0, 8);
  }, [search, products, editing]);

  const save = async () => {
    if (!editing) return;
    const startsAt = israelLocalToIso(editing.form.starts);
    const endsAt = israelLocalToIso(editing.form.ends);
    if (!startsAt || !endsAt) {
      setFormError(t("admin.sales.error.DATES"));
      return;
    }
    setSaving(true);
    setFormError(null);
    const sale = {
      name: editing.form.name,
      kind: editing.form.kind,
      value: Number(editing.form.value),
      startsAt,
      endsAt,
      productIds: editing.form.productIds,
      freeDelivery: editing.form.freeDelivery,
      freeDeliveryMin: editing.form.freeDelivery && editing.form.freeDeliveryMin ? Number(editing.form.freeDeliveryMin) : 0,
    };
    const result = await clientAdminFetch<{ sale?: SaleRecord; error?: SaleError }>("/api/admin/sales", editing.id ? { action: "update", id: editing.id, sale } : { action: "create", sale });
    setSaving(false);
    if (result.ok) {
      setEditing(null);
      setNotice(t("admin.sales.saved"));
      void load();
      return;
    }
    setFormError(isPermissionDenied(result) ? t("admin.sales.adminOnly") : errorText(result.data?.error));
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    const result = await clientAdminFetch<{ error?: SaleError }>("/api/admin/sales", { action: confirm.mode, id: confirm.item.id });
    setBusy(false);
    if (result.ok) {
      setNotice(t(confirm.mode === "end" ? "admin.sales.ended" : "admin.sales.deleted"));
      setConfirm(null);
      void load();
    } else {
      setNotice(isPermissionDenied(result) ? t("admin.sales.adminOnly") : errorText(result.data?.error));
      setConfirm(null);
    }
  };

  const until = (iso: string) => saleUntilText(iso);
  const dateRange = (s: SaleRecord) => `${until(new Date(Date.parse(s.startsAt) + 1).toISOString())} – ${until(s.endsAt)}`;

  return (
    <div className="space-y-5" data-sales-admin>
      <AdminPageHeader
        title={t("admin.sales.title")}
        actions={
          <Button type="button" onClick={openCreate} data-sale-add>
            <Plus className="h-4 w-4" />
            {t("admin.sales.add")}
          </Button>
        }
      />

      {notice && (
        <p className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800" role="status" data-sales-notice>
          {notice}
          <button type="button" onClick={() => setNotice(null)} aria-label={t("admin.sales.cancel")} className="rounded-full p-1 hover:bg-black/5">
            <X className="h-4 w-4" />
          </button>
        </p>
      )}

      <div className="flex flex-wrap gap-2" role="group">
        {(["all", "active", "scheduled", "ended"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn("h-9 rounded-full border px-3 text-sm font-semibold", filter === f ? "border-turquoise bg-turquoise text-warm-white" : "border-beige-dark/40 bg-warm-white text-coffee/70")}
            data-sales-filter={f}
          >
            {t(`admin.sales.filter.${f}`)} · {counts[f]}
          </button>
        ))}
      </div>

      {loadError === "denied" ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900" data-sales-error="denied">{t("admin.sales.adminOnly")}</p>
      ) : loadError === "failed" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" data-sales-error="failed">
          <p>{t("admin.sales.loadError")}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} data-sales-retry>{t("admin.action.retry")}</Button>
        </div>
      ) : items === null ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-turquoise" /></div>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-beige-dark/40 p-6 text-center text-sm text-coffee/60" data-sales-empty>{t("admin.sales.empty")}</p>
      ) : (
        <ul className="space-y-3" data-sales-list>
          {shown.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-warm-white p-4 shadow-soft dark:bg-white/5" data-sale={s.id} data-sale-status={s.status}>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-dark-brown dark:text-warm-white">{s.name[locale] || s.name.he}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[s.status])}>{t(`admin.sales.status.${s.status}`)}</span>
                  <span className="rounded-full bg-[#FBE7E3] px-2 py-0.5 text-[11px] font-bold text-[#9A2B1A]">{t(`admin.sales.kind.${s.kind}`)} · {discountText(s)}</span>
                  {s.freeDelivery && (
                    <span className="rounded-full bg-turquoise/10 px-2 py-0.5 text-[11px] font-semibold text-turquoise" data-sale-free-delivery>
                      🚚 {s.freeDeliveryMin ? t("offers.freeDeliveryFrom").replace("{min}", formatPrice(s.freeDeliveryMin)) : t("offers.freeDelivery")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-coffee/60" dir="ltr" style={{ textAlign: "start" }}>{dateRange(s)}</p>
                <p className="line-clamp-2 text-xs text-coffee/70">{s.productIds.map(nameOf).join(" · ")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {s.status !== "ended" && (
                  <Button type="button" variant="outline" size="sm" onClick={() => openEdit(s)} data-sale-edit>
                    <Pencil className="h-3.5 w-3.5" />
                    {t("admin.sales.edit")}
                  </Button>
                )}
                {s.status === "active" && (
                  <Button type="button" variant="outline" size="sm" className="border-red-200 text-red-700" onClick={() => setConfirm({ item: s, mode: "end" })} data-sale-end>
                    <Square className="h-3.5 w-3.5" />
                    {t("admin.sales.endNow")}
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" className="border-red-200 text-red-700" onClick={() => setConfirm({ item: s, mode: "delete" })} data-sale-delete>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("admin.sales.delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AdminModal open={!!editing} onOpenChange={(next) => !saving && !next && setEditing(null)} size="md">
        <AdminModalHeader onClose={() => setEditing(null)}>
          <AdminModalTitle>{t(editing?.id ? "admin.sales.editTitle" : "admin.sales.add")}</AdminModalTitle>
        </AdminModalHeader>
        {editing && (
          <AdminModalBody className="space-y-4" data-sale-form>
            <div>
              <Label>{t("admin.sales.name")}</Label>
              <div className="mt-1 flex gap-1 rounded-xl bg-beige/25 p-1">
                {LANGS.map((l) => (
                  <button key={l.id} type="button" onClick={() => setLang(l.id)} className={cn("flex-1 rounded-lg px-2 py-1.5 text-xs", lang === l.id && "bg-warm-white font-semibold text-turquoise shadow-sm")}>
                    {l.label}
                  </button>
                ))}
              </div>
              <Input
                value={editing.form.name[lang]}
                onChange={(e) => setForm({ name: { ...editing.form.name, [lang]: e.target.value.slice(0, 80) } })}
                dir={lang === "en" ? "ltr" : "rtl"}
                className="mt-2 h-11"
                data-sale-name={lang}
              />
            </div>

            <fieldset>
              <legend className="text-sm font-medium">{t("admin.sales.kindLabel")}</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {KINDS.map((k) => (
                  <label key={k} className={cn("flex h-10 cursor-pointer items-center gap-2 rounded-full border px-3 text-sm", editing.form.kind === k ? "border-turquoise bg-turquoise/10 font-semibold text-turquoise" : "border-beige-dark/40")}>
                    <input type="radio" name="sale-kind" checked={editing.form.kind === k} onChange={() => setForm({ kind: k })} className="accent-[#007A80]" data-sale-kind={k} />
                    {t(`admin.sales.kind.${k}`)}
                  </label>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={editing.form.value}
                  onChange={(e) => setForm({ value: e.target.value.replace(/[^\d.]/g, "").slice(0, 8) })}
                  inputMode="decimal"
                  dir="ltr"
                  className="h-11 w-32"
                  aria-label={t(`admin.sales.valueLabel.${editing.form.kind}`)}
                  data-sale-value
                />
                <span className="text-sm text-coffee/70">{t(`admin.sales.valueLabel.${editing.form.kind}`)}</span>
              </div>
            </fieldset>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="sale-starts">{t("admin.sales.starts")}</Label>
                <Input id="sale-starts" type="datetime-local" value={editing.form.starts} onChange={(e) => setForm({ starts: e.target.value })} dir="ltr" className="mt-1 h-11" data-sale-starts />
              </div>
              <div>
                <Label htmlFor="sale-ends">{t("admin.sales.ends")}</Label>
                <Input id="sale-ends" type="datetime-local" value={editing.form.ends} onChange={(e) => setForm({ ends: e.target.value })} dir="ltr" className="mt-1 h-11" data-sale-ends />
              </div>
              <p className="text-xs text-coffee/55 sm:col-span-2">{t("admin.sales.israelTime")}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sale-search">{t("admin.sales.products")}</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee/40" />
                <Input id="sale-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("admin.sales.searchProduct")} className="h-11 ps-9" data-sale-search />
              </div>
              {matches.length > 0 && (
                <ul className="max-h-48 overflow-y-auto rounded-xl border border-beige-dark/30" data-sale-matches>
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setForm({ productIds: [...editing.form.productIds, p.id] });
                          setSearch("");
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-beige/30"
                        data-sale-pick={p.id}
                      >
                        <span>{getLocalizedName(p, locale)}</span>
                        <span dir="ltr" className="text-coffee/60">{formatPrice(p.price)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {preview.length > 0 && (
                <ul className="divide-y divide-beige-dark/20 rounded-xl border border-beige-dark/30" data-sale-preview>
                  {preview.map((row) => (
                    <li key={row.id} className={cn("flex items-center justify-between gap-2 px-3 py-2 text-sm", !row.lower && value > 0 && "bg-amber-50")} data-sale-row={row.id} data-lower={row.lower ? "yes" : "no"}>
                      <span className="min-w-0 truncate">{row.name}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {row.lower ? (
                          <>
                            <s dir="ltr" className="text-xs text-coffee/60">{formatPrice(row.regular)}</s>
                            <b dir="ltr" className="text-[#B4331F]">{formatPrice(row.price)}</b>
                          </>
                        ) : value > 0 ? (
                          <span className="text-xs text-amber-800">{t("admin.sales.notLower")}</span>
                        ) : (
                          <span dir="ltr" className="text-xs text-coffee/60">{formatPrice(row.regular)}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => setForm({ productIds: editing.form.productIds.filter((id) => id !== row.id) })}
                          aria-label={t("admin.sales.removeProduct").replace("{name}", row.name)}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-coffee/50 hover:bg-beige/50"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-coffee/55">{t("admin.sales.addonsNote")}</p>
            </div>
            <FreeDeliveryFields
              enabled={editing.form.freeDelivery}
              min={editing.form.freeDeliveryMin}
              onChange={(patch) => setForm(patch)}
              hint={t("admin.sales.freeDeliveryHint")}
            />
            {formError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" data-sale-form-error>{formError}</p>}
          </AdminModalBody>
        )}
        <AdminModalFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(null)}>{t("admin.sales.cancel")}</Button>
          <Button type="button" disabled={saving} onClick={() => void save()} data-sale-save>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("admin.sales.save")}
          </Button>
        </AdminModalFooter>
      </AdminModal>

      <AdminModal open={!!confirm} onOpenChange={(next) => !busy && !next && setConfirm(null)} size="sm">
        <AdminModalHeader onClose={() => setConfirm(null)}>
          <AdminModalTitle>{confirm ? t(confirm.mode === "end" ? "admin.sales.endTitle" : "admin.sales.deleteTitle").replace("{name}", confirm.item.name[locale] || confirm.item.name.he) : ""}</AdminModalTitle>
        </AdminModalHeader>
        <AdminModalBody data-sale-confirm={confirm?.mode}>
          <p className="text-sm text-coffee/80">{t(confirm?.mode === "end" ? "admin.sales.endQuestion" : "admin.sales.deleteQuestion")}</p>
        </AdminModalBody>
        <AdminModalFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm(null)}>{t("admin.sales.cancel")}</Button>
          <Button type="button" className="bg-red-600 text-white hover:bg-red-700" disabled={busy} onClick={() => void runConfirm()} data-sale-confirm-yes>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t(confirm?.mode === "end" ? "admin.sales.endNow" : "admin.sales.delete")}
          </Button>
        </AdminModalFooter>
      </AdminModal>
    </div>
  );
}
