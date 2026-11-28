"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Search, Square, Trash2, X } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminModal, AdminModalBody, AdminModalFooter, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { ImageUpload } from "@/features/admin/image-upload";
import { FreeDeliveryFields } from "@/features/admin/free-delivery-fields";
import { useAllCategories, useAllProducts } from "@/hooks/useProducts";
import { clientAdminFetch, isPermissionDenied } from "@/lib/auth/client-admin-fetch";
import { getLocalizedName } from "@/lib/i18n/localized-content";
import { isoToIsraelLocal, israelLocalToIso, priceNow, saleUntilText } from "@/lib/sales/sale-price";
import { bundleSeparateRange, MAX_BUNDLE_SLOTS, MAX_SLOT_COUNT, type BundleSlot, type BundleSlotKind } from "@/lib/bundles/bundle";
import type { BundleError, BundleRecord, BundleStatus } from "@/lib/bundles/admin";
import { deleteImageByUrl, uploadBannerImage } from "@/services/storageService";
import { cn, formatPrice } from "@/lib/utils";
import type { Product } from "@/types";

type Item = BundleRecord & { status: BundleStatus };
type Text3 = { he: string; ar: string; en: string };
type SlotForm = { id: string; kind: BundleSlotKind; productId: string; productIds: string[]; categoryId: string; count: string };
type Form = {
  name: Text3;
  description: Text3;
  imageUrl: string;
  price: string;
  starts: string;
  ends: string;
  slots: SlotForm[];
  freeDelivery: boolean;
  freeDeliveryMin: string;
  couponsAllowed: boolean;
};

const KINDS: BundleSlotKind[] = ["fixed", "choice", "category"];
const LANGS = [
  { id: "he", label: "עברית", dir: "rtl" },
  { id: "ar", label: "العربية", dir: "rtl" },
  { id: "en", label: "English", dir: "ltr" },
] as const;
const STATUS_STYLE: Record<BundleStatus, string> = {
  active: "bg-emerald-50 text-emerald-800",
  scheduled: "bg-sky-50 text-sky-800",
  ended: "bg-stone-100 text-stone-600",
};

const newSlotId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emptySlot = (): SlotForm => ({ id: newSlotId(), kind: "choice", productId: "", productIds: [], categoryId: "", count: "1" });

function emptyForm(): Form {
  const start = new Date();
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 7 * 86400_000);
  return {
    name: { he: "", ar: "", en: "" },
    description: { he: "", ar: "", en: "" },
    imageUrl: "",
    price: "",
    starts: isoToIsraelLocal(start.toISOString()),
    ends: isoToIsraelLocal(end.toISOString()),
    slots: [emptySlot()],
    freeDelivery: false,
    freeDeliveryMin: "",
    couponsAllowed: false,
  };
}

function toSlot(s: SlotForm): BundleSlot | null {
  const count = Number(s.count);
  if (!Number.isInteger(count) || count < 1 || count > MAX_SLOT_COUNT) return null;
  if (s.kind === "fixed") return s.productId ? { id: s.id, kind: "fixed", productId: s.productId, quantity: count } : null;
  if (s.kind === "choice") return s.productIds.length > 0 ? { id: s.id, kind: "choice", productIds: s.productIds, choose: count } : null;
  return s.categoryId ? { id: s.id, kind: "category", categoryId: s.categoryId, choose: count } : null;
}

function fromSlot(s: BundleSlot): SlotForm {
  if (s.kind === "fixed") return { id: s.id, kind: "fixed", productId: s.productId, productIds: [], categoryId: "", count: String(s.quantity) };
  if (s.kind === "choice") return { id: s.id, kind: "choice", productId: "", productIds: [...s.productIds], categoryId: "", count: String(s.choose) };
  return { id: s.id, kind: "category", productId: "", productIds: [], categoryId: s.categoryId, count: String(s.choose) };
}

/** Search the menu and pick a product (for a fixed part or a choice list). */
function ProductSearch({ products, exclude, onPick, nameOf }: { products: Product[]; exclude: string[]; onPick: (id: string) => void; nameOf: (id: string) => string }) {
  const t = useT();
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const s = q.trim().toLocaleLowerCase();
    if (!s) return [] as Product[];
    return products
      .filter((p) => !p.hidden && !p.isTestProduct && !exclude.includes(p.id))
      .filter((p) => [p.name_he, p.name_ar, p.name_en].some((n) => (n ?? "").toLocaleLowerCase().includes(s)))
      .slice(0, 8);
  }, [q, products, exclude]);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee/40" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.sales.searchProduct")} className="h-10 ps-9" data-bundle-search />
      {matches.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-auto rounded-xl border border-beige-dark/30 bg-warm-white shadow-lg dark:bg-[#2a211d]">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-beige/40"
                onClick={() => {
                  onPick(p.id);
                  setQ("");
                }}
              >
                <span>{nameOf(p.id)}</span>
                <span className="text-xs text-coffee/60">{formatPrice(p.price)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Admin → Sales → Bundles (Admin only). Several products for one total price, made of up to 6 parts:
 * a fixed product, "choose N from this list", or "choose N from this category". Dates in Israel
 * time, optional free delivery (from a minimum), coupons on the bundle off unless switched on.
 * Saved and checked on the server; the browser never writes a bundle.
 */
export function BundlesAdmin() {
  const t = useT();
  const { locale } = useLocale();
  const { firebaseUser, loading: authLoading } = useAuth();
  const { products } = useAllProducts();
  const { categories } = useAllCategories();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const nameOf = useCallback((id: string) => {
    const p = byId.get(id);
    return p ? getLocalizedName(p, locale) : id;
  }, [byId, locale]);
  const categoryName = useCallback((id: string) => {
    const c = categories.find((x) => x.id === id);
    return c ? (locale === "ar" ? c.name_ar : locale === "en" ? c.name_en : c.name_he) || c.name_he : id;
  }, [categories, locale]);

  const [items, setItems] = useState<Item[] | null>(null);
  const [loadError, setLoadError] = useState<"denied" | "failed" | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [lang, setLang] = useState<"he" | "ar" | "en">("he");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ item: Item; mode: "end" | "delete" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const result = await clientAdminFetch<{ bundles: Item[] }>("/api/admin/bundles", { action: "list" });
    if (result.ok && result.data) setItems(result.data.bundles);
    else setLoadError(isPermissionDenied(result) ? "denied" : "failed");
  }, []);
  useEffect(() => {
    if (authLoading || !firebaseUser) return;
    void load();
  }, [load, authLoading, firebaseUser]);

  const errorText = (error: BundleError | { code?: string } | undefined): string => {
    const e = error as BundleError | undefined;
    if (e?.code === "NOT_LOWER") return t("admin.bundles.error.NOT_LOWER").replace("{price}", formatPrice(e.separately));
    if (e?.code === "SLOT" || e?.code === "SLOT_EMPTY") return t(`admin.bundles.error.${e.code}`).replace("{n}", String(e.index + 1));
    if (e?.code === "PRODUCT_NOT_FOUND") return t("admin.bundles.error.PRODUCT_NOT_FOUND").replace("{products}", e.productIds.map(nameOf).join(", "));
    if (e?.code === "TOO_MANY_SLOTS") return t("admin.bundles.error.TOO_MANY_SLOTS").replace("{max}", String(e.max));
    const known = ["NAME", "PRICE", "DATES", "NO_SLOTS", "FREE_DELIVERY_MIN", "NOT_FOUND", "NOT_ACTIVE"];
    return known.includes(e?.code ?? "") ? t(`admin.bundles.error.${e!.code}`) : t("admin.bundles.error.generic");
  };

  const setForm = (patch: Partial<Form>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));
  const setSlot = (index: number, patch: Partial<SlotForm>) =>
    setEditing((e) => (e ? { ...e, form: { ...e.form, slots: e.form.slots.map((s, i) => (i === index ? { ...s, ...patch } : s)) } } : e));

  const openCreate = () => {
    setFormError(null);
    setLang("he");
    setEditing({ id: null, form: emptyForm() });
  };
  const openEdit = (b: Item) => {
    setFormError(null);
    setLang("he");
    setEditing({
      id: b.id,
      form: {
        name: { ...b.name },
        description: { ...b.description },
        imageUrl: b.imageUrl ?? "",
        price: String(b.price),
        starts: isoToIsraelLocal(b.startsAt),
        ends: isoToIsraelLocal(b.endsAt),
        slots: b.slots.map(fromSlot),
        freeDelivery: b.freeDelivery,
        freeDeliveryMin: b.freeDeliveryMin ? String(b.freeDeliveryMin) : "",
        couponsAllowed: b.couponsAllowed,
      },
    });
  };

  // Preview: what the products cost separately now (cheapest – dearest choice) vs. the bundle price.
  const priced = useMemo(
    () => products.map((p) => ({ id: p.id, categoryId: p.categoryId, priceNow: priceNow(p, Date.now()).price, orderable: p.available !== false && p.active !== false })),
    [products]
  );
  const formSlots = editing ? editing.form.slots.map(toSlot) : [];
  const range = editing && formSlots.length > 0 && formSlots.every(Boolean) ? bundleSeparateRange({ slots: formSlots as BundleSlot[] }, priced) : null;
  const price = Number(editing?.form.price);
  const notLower = !!range && Number.isFinite(price) && price > 0 && price >= range.min;

  const save = async () => {
    if (!editing) return;
    const startsAt = israelLocalToIso(editing.form.starts);
    const endsAt = israelLocalToIso(editing.form.ends);
    if (!startsAt || !endsAt) {
      setFormError(t("admin.bundles.error.DATES"));
      return;
    }
    const slots = editing.form.slots.map(toSlot);
    const bad = slots.findIndex((s) => !s);
    if (bad >= 0) {
      setFormError(t("admin.bundles.error.SLOT").replace("{n}", String(bad + 1)));
      return;
    }
    setSaving(true);
    setFormError(null);
    const f = editing.form;
    const bundle = {
      name: f.name,
      description: f.description,
      imageUrl: f.imageUrl,
      price: Number(f.price),
      startsAt,
      endsAt,
      slots,
      freeDelivery: f.freeDelivery,
      freeDeliveryMin: f.freeDelivery && f.freeDeliveryMin ? Number(f.freeDeliveryMin) : 0,
      couponsAllowed: f.couponsAllowed,
    };
    const result = await clientAdminFetch<{ bundle?: BundleRecord; error?: BundleError }>("/api/admin/bundles", editing.id ? { action: "update", id: editing.id, bundle } : { action: "create", bundle });
    setSaving(false);
    if (result.ok) {
      setEditing(null);
      setNotice(t("admin.bundles.saved"));
      void load();
      return;
    }
    setFormError(isPermissionDenied(result) ? t("admin.sales.adminOnly") : errorText(result.data?.error));
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setBusy(true);
    const result = await clientAdminFetch<{ error?: BundleError }>("/api/admin/bundles", { action: confirm.mode, id: confirm.item.id });
    setBusy(false);
    setConfirm(null);
    if (result.ok) {
      setNotice(t(confirm.mode === "end" ? "admin.bundles.ended" : "admin.bundles.deleted"));
      void load();
    } else setNotice(isPermissionDenied(result) ? t("admin.sales.adminOnly") : errorText(result.data?.error));
  };

  const slotSummary = (s: BundleSlot) =>
    s.kind === "fixed"
      ? `${s.quantity} × ${nameOf(s.productId)}`
      : s.kind === "choice"
        ? t("admin.bundles.summary.choice").replace("{n}", String(s.choose)).replace("{list}", s.productIds.map(nameOf).join(" / "))
        : t("admin.bundles.summary.category").replace("{n}", String(s.choose)).replace("{category}", categoryName(s.categoryId));
  const dateRange = (b: BundleRecord) => `${saleUntilText(new Date(Date.parse(b.startsAt) + 1).toISOString())} – ${saleUntilText(b.endsAt)}`;

  return (
    <div className="space-y-5" data-bundles-admin>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-coffee/70">{t("admin.bundles.intro")}</p>
        <Button type="button" onClick={openCreate} data-bundle-add>
          <Plus className="h-4 w-4" />
          {t("admin.bundles.add")}
        </Button>
      </div>

      {notice && (
        <p className="flex items-center justify-between gap-2 rounded-xl bg-emerald-50 px-4 py-2 text-sm text-emerald-800" role="status" data-bundles-notice>
          {notice}
          <button type="button" onClick={() => setNotice(null)} aria-label={t("admin.sales.cancel")} className="rounded-full p-1 hover:bg-black/5">
            <X className="h-4 w-4" />
          </button>
        </p>
      )}

      {loadError === "denied" ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">{t("admin.sales.adminOnly")}</p>
      ) : loadError === "failed" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          <p>{t("admin.bundles.loadError")}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void load()}>{t("admin.bundles.retry")}</Button>
        </div>
      ) : items === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-coffee/40" />
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-beige-dark/40 p-6 text-center text-sm text-coffee/60" data-bundles-empty>{t("admin.bundles.empty")}</p>
      ) : (
        <ul className="space-y-3" data-bundles-list>
          {items.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-warm-white p-4 shadow-soft dark:bg-white/5" data-bundle={b.id} data-bundle-status={b.status}>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-dark-brown dark:text-warm-white">{b.name[locale] || b.name.he}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[b.status])}>{t(`admin.sales.status.${b.status}`)}</span>
                  <span className="rounded-full bg-[#FBE7E3] px-2 py-0.5 text-[11px] font-bold text-[#9A2B1A]">{formatPrice(b.price)}</span>
                  {b.freeDelivery && (
                    <span className="rounded-full bg-turquoise/10 px-2 py-0.5 text-[11px] font-semibold text-turquoise">
                      🚚 {b.freeDeliveryMin ? t("offers.freeDeliveryFrom").replace("{min}", formatPrice(b.freeDeliveryMin)) : t("offers.freeDelivery")}
                    </span>
                  )}
                  {b.couponsAllowed && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{t("admin.bundles.couponsAllowed")}</span>}
                </div>
                <p className="text-xs text-coffee/60" dir="ltr" style={{ textAlign: "start" }}>{dateRange(b)}</p>
                <p className="line-clamp-2 text-xs text-coffee/70">{b.slots.map(slotSummary).join(" + ")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {b.status !== "ended" && (
                  <Button type="button" variant="outline" size="sm" onClick={() => openEdit(b)} data-bundle-edit>
                    <Pencil className="h-3.5 w-3.5" />
                    {t("admin.sales.edit")}
                  </Button>
                )}
                {b.status === "active" && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirm({ item: b, mode: "end" })} data-bundle-end>
                    <Square className="h-3.5 w-3.5" />
                    {t("admin.sales.endNow")}
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" className="text-red-700" onClick={() => setConfirm({ item: b, mode: "delete" })} data-bundle-delete>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t("admin.sales.delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AdminModal open={!!editing} onOpenChange={(next) => !saving && !next && setEditing(null)} size="lg" preventOverlayClose>
        <AdminModalHeader onClose={() => !saving && setEditing(null)}>
          <AdminModalTitle>{t(editing?.id ? "admin.bundles.editTitle" : "admin.bundles.newTitle")}</AdminModalTitle>
        </AdminModalHeader>
        {editing && (
          <AdminModalBody className="space-y-5" data-bundle-form>
            <div className="space-y-2">
              <div className="flex gap-1" role="tablist">
                {LANGS.map((l) => (
                  <button key={l.id} type="button" role="tab" aria-selected={lang === l.id} onClick={() => setLang(l.id)} className={cn("h-9 rounded-full px-3 text-sm", lang === l.id ? "bg-turquoise text-warm-white" : "bg-beige/50 text-coffee/70")}>
                    {l.label}
                  </button>
                ))}
              </div>
              <Label htmlFor="bundle-name">{t("admin.bundles.name")}</Label>
              <Input
                id="bundle-name"
                dir={LANGS.find((l) => l.id === lang)!.dir}
                value={editing.form.name[lang]}
                onChange={(e) => setForm({ name: { ...editing.form.name, [lang]: e.target.value.slice(0, 80) } })}
                placeholder={lang === "he" ? t("admin.bundles.namePlaceholder") : ""}
                className="h-11"
                data-bundle-name={lang}
              />
              <Label htmlFor="bundle-description">{t("admin.bundles.description")}</Label>
              <Input
                id="bundle-description"
                dir={LANGS.find((l) => l.id === lang)!.dir}
                value={editing.form.description[lang]}
                onChange={(e) => setForm({ description: { ...editing.form.description, [lang]: e.target.value.slice(0, 300) } })}
                className="h-11"
                data-bundle-description={lang}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <div>
                <Label htmlFor="bundle-price">{t("admin.bundles.price")}</Label>
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-sm text-coffee/60">₪</span>
                  <Input id="bundle-price" value={editing.form.price} onChange={(e) => setForm({ price: e.target.value.replace(/[^\d.]/g, "").slice(0, 7) })} inputMode="decimal" dir="ltr" className="h-11 w-28" data-bundle-price />
                </div>
              </div>
              <ImageUpload
                label={t("admin.bundles.image")}
                value={editing.form.imageUrl}
                onChange={(url) => setForm({ imageUrl: url })}
                onUpload={(file, onProgress) => uploadBannerImage(file, `bundle-${editing.id ?? "new"}`, onProgress)}
                onDelete={deleteImageByUrl}
                compact
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="bundle-starts">{t("admin.sales.starts")}</Label>
                <Input id="bundle-starts" type="datetime-local" value={editing.form.starts} onChange={(e) => setForm({ starts: e.target.value })} dir="ltr" className="mt-1 h-11" data-bundle-starts />
              </div>
              <div>
                <Label htmlFor="bundle-ends">{t("admin.sales.ends")}</Label>
                <Input id="bundle-ends" type="datetime-local" value={editing.form.ends} onChange={(e) => setForm({ ends: e.target.value })} dir="ltr" className="mt-1 h-11" data-bundle-ends />
              </div>
              <p className="text-xs text-coffee/55 sm:col-span-2">{t("admin.sales.israelTime")}</p>
            </div>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">{t("admin.bundles.parts")}</legend>
              {editing.form.slots.map((slot, index) => (
                <div key={slot.id} className="space-y-2 rounded-xl border border-beige-dark/30 p-3" data-bundle-slot={index}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-turquoise/10 text-xs font-bold text-turquoise">{index + 1}</span>
                    <select
                      value={slot.kind}
                      onChange={(e) => setSlot(index, { kind: e.target.value as BundleSlotKind })}
                      className="h-10 rounded-lg border border-beige-dark/40 bg-transparent px-2 text-sm"
                      aria-label={t("admin.bundles.partKind")}
                      data-bundle-slot-kind
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k}>{t(`admin.bundles.kind.${k}`)}</option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1 text-sm">
                      {t(slot.kind === "fixed" ? "admin.bundles.quantity" : "admin.bundles.choose")}
                      <Input value={slot.count} onChange={(e) => setSlot(index, { count: e.target.value.replace(/\D/g, "").slice(0, 2) })} inputMode="numeric" dir="ltr" className="h-10 w-16" data-bundle-slot-count />
                    </label>
                    {editing.form.slots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setForm({ slots: editing.form.slots.filter((_, i) => i !== index) })}
                        className="ms-auto inline-flex h-9 w-9 items-center justify-center rounded-full text-coffee/50 hover:bg-red-50 hover:text-red-600"
                        aria-label={t("admin.bundles.removePart").replace("{n}", String(index + 1))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {slot.kind === "fixed" ? (
                    slot.productId ? (
                      <p className="flex items-center justify-between gap-2 rounded-lg bg-beige/30 px-3 py-2 text-sm">
                        {nameOf(slot.productId)}
                        <button type="button" onClick={() => setSlot(index, { productId: "" })} aria-label={t("admin.sales.removeProduct").replace("{name}", nameOf(slot.productId))} className="rounded-full p-1 hover:bg-black/5">
                          <X className="h-4 w-4" />
                        </button>
                      </p>
                    ) : (
                      <ProductSearch products={products} exclude={[]} onPick={(id) => setSlot(index, { productId: id })} nameOf={nameOf} />
                    )
                  ) : slot.kind === "choice" ? (
                    <>
                      <ProductSearch products={products} exclude={slot.productIds} onPick={(id) => setSlot(index, { productIds: [...slot.productIds, id] })} nameOf={nameOf} />
                      {slot.productIds.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5">
                          {slot.productIds.map((id) => (
                            <li key={id} className="inline-flex items-center gap-1 rounded-full bg-beige/40 py-1 ps-3 pe-1 text-xs">
                              {nameOf(id)}
                              <button type="button" onClick={() => setSlot(index, { productIds: slot.productIds.filter((x) => x !== id) })} aria-label={t("admin.sales.removeProduct").replace("{name}", nameOf(id))} className="rounded-full p-1 hover:bg-black/5">
                                <X className="h-3 w-3" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <select
                      value={slot.categoryId}
                      onChange={(e) => setSlot(index, { categoryId: e.target.value })}
                      className="h-10 w-full rounded-lg border border-beige-dark/40 bg-transparent px-2 text-sm"
                      aria-label={t("admin.bundles.kind.category")}
                      data-bundle-slot-category
                    >
                      <option value="">{t("admin.bundles.pickCategory")}</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{categoryName(c.id)}</option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
              {editing.form.slots.length < MAX_BUNDLE_SLOTS && (
                <Button type="button" variant="outline" size="sm" onClick={() => setForm({ slots: [...editing.form.slots, emptySlot()] })} data-bundle-add-slot>
                  <Plus className="h-3.5 w-3.5" />
                  {t("admin.bundles.addPart")}
                </Button>
              )}
              <p className="text-xs text-coffee/55">{t("admin.bundles.addonsNote")}</p>
            </fieldset>

            {range && (
              <p className={cn("rounded-xl px-3 py-2 text-sm", notLower ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900")} data-bundle-preview data-lower={notLower ? "no" : "yes"}>
                {t("admin.bundles.separately")
                  .replace("{range}", range.min === range.max ? formatPrice(range.min) : `${formatPrice(range.min)}–${formatPrice(range.max)}`)}
                {Number.isFinite(price) && price > 0 && !notLower
                  ? ` · ${t("admin.bundles.saving").replace("{range}", range.min === range.max ? formatPrice(range.min - price) : `${formatPrice(range.min - price)}–${formatPrice(range.max - price)}`)}`
                  : ""}
                {notLower ? ` · ${t("admin.bundles.notLowerHint")}` : ""}
              </p>
            )}

            <FreeDeliveryFields enabled={editing.form.freeDelivery} min={editing.form.freeDeliveryMin} onChange={(patch) => setForm(patch)} hint={t("admin.bundles.freeDeliveryHint")} />

            <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-xl border border-beige-dark/30 p-3 text-sm">
              <input type="checkbox" checked={editing.form.couponsAllowed} onChange={(e) => setForm({ couponsAllowed: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[#007A80]" data-bundle-coupons />
              <span>
                <span className="font-medium">{t("admin.bundles.couponsAllowed")}</span>
                <span className="block text-xs text-coffee/55">{t("admin.bundles.couponsHint")}</span>
              </span>
            </label>

            {formError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" data-bundle-form-error>{formError}</p>}
          </AdminModalBody>
        )}
        <AdminModalFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(null)}>{t("admin.sales.cancel")}</Button>
          <Button type="button" disabled={saving} onClick={() => void save()} data-bundle-save>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("admin.sales.save")}
          </Button>
        </AdminModalFooter>
      </AdminModal>

      <AdminModal open={!!confirm} onOpenChange={(next) => !busy && !next && setConfirm(null)} size="sm">
        <AdminModalHeader onClose={() => setConfirm(null)}>
          <AdminModalTitle>{confirm ? t(confirm.mode === "end" ? "admin.bundles.endTitle" : "admin.bundles.deleteTitle").replace("{name}", confirm.item.name[locale] || confirm.item.name.he) : ""}</AdminModalTitle>
        </AdminModalHeader>
        <AdminModalBody data-bundle-confirm={confirm?.mode}>
          <p className="text-sm text-coffee/80">{t(confirm?.mode === "end" ? "admin.bundles.endQuestion" : "admin.bundles.deleteQuestion")}</p>
        </AdminModalBody>
        <AdminModalFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirm(null)}>{t("admin.sales.cancel")}</Button>
          <Button type="button" className="bg-red-600 text-white hover:bg-red-700" disabled={busy} onClick={() => void runConfirm()} data-bundle-confirm-yes>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t(confirm?.mode === "end" ? "admin.sales.endNow" : "admin.sales.delete")}
          </Button>
        </AdminModalFooter>
      </AdminModal>
    </div>
  );
}
