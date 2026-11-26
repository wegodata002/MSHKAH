"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Power, Search, Sparkles, Trash2 } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminPageHeader } from "@/features/admin/components/admin-page-header";
import { AdminModal, AdminModalBody, AdminModalFooter, AdminModalHeader, AdminModalTitle } from "@/features/admin/components/admin-modal";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { couponDisplayName, couponStatus, type CouponInput, type CouponStatus, type StoreCoupon } from "@/lib/coupons/store-coupons";
import { cn, formatPrice } from "@/lib/utils";

type Item = StoreCoupon & { uses: number };
type Filter = "all" | CouponStatus;

const LANGS = [
  { id: "he", label: "עברית" },
  { id: "ar", label: "العربية" },
  { id: "en", label: "English" },
] as const;

const STATUS_STYLE: Record<CouponStatus, string> = {
  active: "bg-emerald-50 text-emerald-700",
  expired: "bg-amber-50 text-amber-800",
  disabled: "bg-stone-100 text-stone-600",
};

const ERROR_KEYS = new Set(["EXISTS", "CODE", "NAME", "VALUE", "EXPIRES", "MIN_ORDER"]);

function emptyForm(): CouponInput {
  return { code: "", name: { he: "", ar: "", en: "" }, type: "percent", value: 10, expiresOn: null, audience: "all", minOrder: 0, limit: "unlimited", active: true };
}

function dateText(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y!.slice(2)}`;
}

function Radio({ name, checked, onChange, label, data }: { name: string; checked: boolean; onChange: () => void; label: string; data?: string }) {
  return (
    <label className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-2 px-3 text-sm", checked ? "border-turquoise bg-turquoise/5 font-semibold" : "border-beige-dark/30")}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="accent-[#007a80]" data-coupon-option={data} />
      {label}
    </label>
  );
}

/**
 * Admin → Coupons (Admin only): store coupons such as MISHKAT10 — create, edit, switch on/off,
 * delete. Checked and priced on the server only (see store-coupons.ts). Personal club codes are
 * managed on the club page and are not listed here.
 */
export function CouponsAdmin() {
  const t = useT();
  const { locale } = useLocale();
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [editing, setEditing] = useState<{ mode: "create" | "edit"; form: CouponInput } | null>(null);
  const [lang, setLang] = useState<"he" | "ar" | "en">("he");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Item | null>(null);
  // Status (active / expired) as of the last load.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => setNow(new Date()), [items]);

  const load = useCallback(async () => {
    const result = await clientAdminFetch<{ coupons: Item[] }>("/api/admin/coupons", { action: "list" });
    if (result.ok && result.data) setItems(result.data.coupons);
    else {
      setItems([]);
      setNotice({ text: t(result.code === "PERMISSION_DENIED" ? "admin.coupons.adminOnly" : "admin.coupons.error.generic"), tone: "error" });
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { all: 0, active: 0, expired: 0, disabled: 0 };
    for (const item of items ?? []) {
      c.all += 1;
      c[couponStatus(item, now)] += 1;
    }
    return c;
  }, [items, now]);

  const shown = useMemo(
    () =>
      (items ?? []).filter(
        (item) => (filter === "all" || couponStatus(item, now) === filter) && item.code.includes(query.trim().toUpperCase())
      ),
    [items, filter, query, now]
  );

  const errorText = (code?: string) => t(code && ERROR_KEYS.has(code) ? `admin.coupons.error.${code}` : "admin.coupons.error.generic");

  const openCreate = () => {
    setFormError(null);
    setLang("he");
    setEditing({ mode: "create", form: emptyForm() });
  };
  const openEdit = (item: Item) => {
    setFormError(null);
    setLang("he");
    const { uses: _uses, builtin: _b, ...form } = item;
    void _uses;
    void _b;
    setEditing({ mode: "edit", form });
  };
  const setForm = (patch: Partial<CouponInput>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    const result = await clientAdminFetch<{ coupon: StoreCoupon }>("/api/admin/coupons", { action: editing.mode, coupon: editing.form });
    setSaving(false);
    if (!result.ok) {
      setFormError(errorText(result.code));
      return;
    }
    setNotice({ text: t("admin.coupons.saved").replace("{code}", editing.form.code.toUpperCase()), tone: "ok" });
    setEditing(null);
    await load();
  };

  const toggle = async (item: Item) => {
    setBusy(item.code);
    const result = await clientAdminFetch("/api/admin/coupons", { action: "toggle", code: item.code, active: !item.active });
    setBusy(null);
    if (result.ok) await load();
    else setNotice({ text: errorText(result.code), tone: "error" });
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(deleting.code);
    const result = await clientAdminFetch("/api/admin/coupons", { action: "delete", code: deleting.code });
    setBusy(null);
    if (result.ok) {
      setNotice({ text: t("admin.coupons.deleted").replace("{code}", deleting.code), tone: "ok" });
      setDeleting(null);
      await load();
    } else setNotice({ text: errorText(result.code), tone: "error" });
  };

  const discountText = (item: Pick<StoreCoupon, "type" | "value">) => (item.type === "percent" ? `${item.value}%` : formatPrice(item.value));
  const audienceText = (item: Pick<StoreCoupon, "audience">) => t(item.audience === "members" ? "admin.coupons.audience.members" : "admin.coupons.audience.all");
  const statusBadge = (item: Item) => {
    const status = couponStatus(item, now);
    return (
      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[status])} data-coupon-status={status}>
        {t(`admin.coupons.status.${status}`)}
      </span>
    );
  };
  const actions = (item: Item) => (
    <div className="flex flex-wrap gap-1.5">
      <Button type="button" size="sm" variant="outline" onClick={() => openEdit(item)} data-coupon-edit>
        <Pencil className="h-3.5 w-3.5" />
        {t("admin.coupons.edit")}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy === item.code} onClick={() => void toggle(item)} data-coupon-toggle>
        {busy === item.code ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
        {t(item.active ? "admin.coupons.disable" : "admin.coupons.enable")}
      </Button>
      <Button type="button" size="sm" variant="outline" className="border-red-200 text-red-700" onClick={() => setDeleting(item)} data-coupon-delete aria-label={t("admin.coupons.delete")}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  return (
    <div className="space-y-5" data-coupons-admin>
      <AdminPageHeader
        title={t("admin.coupons.title")}
        actions={
          <Button type="button" onClick={openCreate} data-coupon-add>
            <Plus className="h-4 w-4" />
            {t("admin.coupons.add")}
          </Button>
        }
      />

      {notice && (
        <p role="status" className={cn("rounded-xl px-4 py-3 text-sm", notice.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700")} data-coupon-notice>
          {notice.text}
        </p>
      )}

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {(["all", "active", "expired", "disabled"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn("h-9 rounded-full border px-3 text-sm font-semibold", filter === f ? "border-turquoise bg-turquoise text-warm-white" : "border-beige-dark/40 bg-warm-white text-coffee/70")}
              data-coupon-filter={f}
            >
              {t(f === "all" ? "admin.coupons.filter.all" : `admin.coupons.status.${f}`)}
              <span className="ms-1.5 opacity-75">{counts[f]}</span>
            </button>
          ))}
        </div>
        <div className="relative md:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee/40" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("admin.coupons.search")} dir="ltr" className="h-10 w-full rounded-xl border border-beige-dark/40 bg-warm-white ps-9 pe-3 text-sm uppercase dark:bg-white/5" data-coupon-search />
        </div>
      </div>

      {items === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-turquoise" />
        </div>
      ) : shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-beige-dark/40 p-6 text-center text-sm text-coffee/60" data-coupon-empty>
          {t(items.length === 0 ? "admin.coupons.empty" : "admin.coupons.none")}
        </p>
      ) : (
        <>
          {/* Phone: cards. */}
          <ul className="space-y-3 md:hidden" data-coupon-cards>
            {shown.map((item) => (
              <li key={item.code} className="rounded-2xl bg-warm-white p-4 shadow-soft dark:bg-white/5" data-coupon={item.code}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-base font-bold text-dark-brown dark:text-warm-white" dir="ltr">
                      {item.code}
                      {item.audience === "members" ? <Sparkles className="ms-1.5 inline h-3.5 w-3.5 text-turquoise" /> : null}
                    </p>
                    <p className="text-xs text-coffee/60">{couponDisplayName(item.name, locale)}</p>
                  </div>
                  {statusBadge(item)}
                </div>
                <p className="mt-2 text-sm text-coffee/80">
                  {discountText(item)} · {audienceText(item)}
                  {item.minOrder > 0 ? ` · ${t("admin.coupons.fromMin").replace("{min}", formatPrice(item.minOrder))}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-coffee/60">
                  {t("admin.coupons.usedCount").replace("{n}", String(item.uses))} · {item.expiresOn ? t("admin.coupons.until").replace("{date}", dateText(item.expiresOn)) : t("admin.coupons.noExpiry")}
                  {item.limit === "once" ? ` · ${t("admin.coupons.limit.once")}` : ""}
                </p>
                <div className="mt-3">{actions(item)}</div>
              </li>
            ))}
          </ul>
          {/* Desktop: table. */}
          <div className="hidden overflow-x-auto rounded-2xl bg-warm-white shadow-soft md:block dark:bg-white/5">
            <table className="w-full text-sm" data-coupon-table>
              <thead className="border-b border-beige-dark/20 text-start text-xs text-coffee/60">
                <tr>
                  {["code", "name", "discount", "audience", "expires", "used", "status", "actions"].map((col) => (
                    <th key={col} className="px-3 py-2.5 text-start font-semibold">
                      {col === "actions" ? "" : t(`admin.coupons.col.${col}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={item.code} className="border-b border-beige-dark/10 last:border-0" data-coupon={item.code}>
                    <td className="px-3 py-2.5 font-mono font-bold" dir="ltr">{item.code}</td>
                    <td className="px-3 py-2.5">{couponDisplayName(item.name, locale)}</td>
                    <td className="px-3 py-2.5">
                      {discountText(item)}
                      {item.minOrder > 0 ? <span className="block text-xs text-coffee/55">{t("admin.coupons.fromMin").replace("{min}", formatPrice(item.minOrder))}</span> : null}
                    </td>
                    <td className="px-3 py-2.5">
                      {item.audience === "members" ? <Sparkles className="me-1 inline h-3.5 w-3.5 text-turquoise" /> : null}
                      {audienceText(item)}
                      {item.limit === "once" ? <span className="block text-xs text-coffee/55">{t("admin.coupons.limit.once")}</span> : null}
                    </td>
                    <td className="px-3 py-2.5">{dateText(item.expiresOn)}</td>
                    <td className="px-3 py-2.5" data-coupon-uses>{item.uses}</td>
                    <td className="px-3 py-2.5">{statusBadge(item)}</td>
                    <td className="px-3 py-2.5">{actions(item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <AdminModal open={!!editing} onOpenChange={(next) => !saving && !next && setEditing(null)} size="sm">
        <AdminModalHeader onClose={() => setEditing(null)}>
          <AdminModalTitle>{t(editing?.mode === "edit" ? "admin.coupons.editTitle" : "admin.coupons.add")}</AdminModalTitle>
        </AdminModalHeader>
        {editing && (
          <AdminModalBody className="space-y-4" data-coupon-form>
            <div>
              <Label htmlFor="coupon-code">{t("admin.coupons.col.code")}</Label>
              <Input
                id="coupon-code"
                value={editing.form.code}
                onChange={(e) => setForm({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) })}
                disabled={editing.mode === "edit"}
                dir="ltr"
                className="mt-1 h-11 font-mono uppercase"
                placeholder="SUMMER15"
              />
            </div>
            <div>
              <Label>{t("admin.coupons.col.name")}</Label>
              <div className="mt-1 flex gap-1 rounded-xl bg-beige/25 p-1">
                {LANGS.map((l) => (
                  <button key={l.id} type="button" onClick={() => setLang(l.id)} className={cn("flex-1 rounded-lg px-2 py-1.5 text-xs", lang === l.id && "bg-warm-white font-semibold text-turquoise shadow-sm")}>
                    {l.label}
                  </button>
                ))}
              </div>
              <Input
                value={editing.form.name[lang]}
                onChange={(e) => setForm({ name: { ...editing.form.name, [lang]: e.target.value } })}
                dir={lang === "en" ? "ltr" : "rtl"}
                className="mt-2 h-11"
                data-coupon-name={lang}
              />
            </div>
            <div>
              <Label>{t("admin.coupons.col.discount")}</Label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Radio name="type" checked={editing.form.type === "percent"} onChange={() => setForm({ type: "percent" })} label="%" data="percent" />
                <Radio name="type" checked={editing.form.type === "fixed"} onChange={() => setForm({ type: "fixed" })} label="₪" data="fixed" />
              </div>
              <Input type="number" inputMode="decimal" min={1} value={editing.form.value} onChange={(e) => setForm({ value: Number(e.target.value) })} dir="ltr" className="mt-2 h-11 w-32" data-coupon-value />
            </div>
            <div>
              <Label htmlFor="coupon-expires">{t("admin.coupons.expiresLabel")}</Label>
              <div className="mt-1 flex items-center gap-2">
                <Input id="coupon-expires" type="date" value={editing.form.expiresOn ?? ""} onChange={(e) => setForm({ expiresOn: e.target.value || null })} dir="ltr" className="h-11 w-48" />
                {editing.form.expiresOn && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setForm({ expiresOn: null })}>
                    {t("admin.coupons.noExpiry")}
                  </Button>
                )}
              </div>
            </div>
            <div>
              <Label>{t("admin.coupons.col.audience")}</Label>
              <div className="mt-1 grid gap-2">
                <Radio name="audience" checked={editing.form.audience === "all"} onChange={() => setForm({ audience: "all" })} label={t("admin.coupons.audience.all")} data="all" />
                <Radio name="audience" checked={editing.form.audience === "members"} onChange={() => setForm({ audience: "members" })} label={t("admin.coupons.audience.members")} data="members" />
              </div>
            </div>
            <div>
              <Label htmlFor="coupon-min">{t("admin.coupons.minLabel")}</Label>
              <Input id="coupon-min" type="number" inputMode="decimal" min={0} value={editing.form.minOrder || ""} onChange={(e) => setForm({ minOrder: Number(e.target.value) || 0 })} dir="ltr" className="mt-1 h-11 w-32" placeholder="0" />
            </div>
            <div>
              <Label>{t("admin.coupons.limitLabel")}</Label>
              <div className="mt-1 grid gap-2">
                <Radio name="limit" checked={editing.form.limit === "once"} onChange={() => setForm({ limit: "once" })} label={t("admin.coupons.limit.once")} data="once" />
                <Radio name="limit" checked={editing.form.limit === "unlimited"} onChange={() => setForm({ limit: "unlimited" })} label={t("admin.coupons.limit.unlimited")} data="unlimited" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.form.active} onChange={(e) => setForm({ active: e.target.checked })} className="h-4 w-4 accent-[#007a80]" />
              {t("admin.coupons.status.active")}
            </label>
            {formError && (
              <p className="text-sm text-red-600" role="alert" data-coupon-form-error>
                {formError}
              </p>
            )}
          </AdminModalBody>
        )}
        <AdminModalFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setEditing(null)}>
            {t("admin.coupons.cancel")}
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()} data-coupon-save>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("admin.coupons.save")}
          </Button>
        </AdminModalFooter>
      </AdminModal>

      <AdminModal open={!!deleting} onOpenChange={(next) => !busy && !next && setDeleting(null)} size="sm">
        <AdminModalHeader onClose={() => setDeleting(null)}>
          <AdminModalTitle>{deleting ? t("admin.coupons.deleteTitle").replace("{code}", deleting.code) : ""}</AdminModalTitle>
        </AdminModalHeader>
        <AdminModalBody className="space-y-2" data-coupon-delete-dialog>
          <p className="text-sm text-coffee/80">{t("admin.coupons.deleteQuestion")}</p>
          {deleting?.code === "MISHKAT10" && <p className="text-sm text-amber-800">{t("admin.coupons.deleteBuiltin")}</p>}
        </AdminModalBody>
        <AdminModalFooter>
          <Button type="button" variant="outline" disabled={!!busy} onClick={() => setDeleting(null)}>
            {t("admin.coupons.cancel")}
          </Button>
          <Button type="button" className="bg-red-600 text-white hover:bg-red-700" disabled={!!busy} onClick={() => void confirmDelete()} data-coupon-delete-confirm>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {t("admin.coupons.delete")}
          </Button>
        </AdminModalFooter>
      </AdminModal>
    </div>
  );
}
