"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Loader2, Minus, Plus, Search, Send, Trash2, X } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { ProductBuilder } from "@/features/catalog/product-builder";
import { useAllProducts, useCategories } from "@/hooks/useProducts";
import { useProductBuilderConfig } from "@/hooks/useModifiers";
import { getLocalizedName } from "@/lib/i18n/localized-content";
import { tableDisplayName, type DineInTable } from "@/lib/fulfillment/settings";
import { cn, formatPrice } from "@/lib/utils";
import type { Product } from "@/types";
import type { SelectedModifier } from "@/types/modifiers";

/**
 * "New order" on the waiter screen: products and add-ons from the menu (the same add-on window as the
 * menu), the guest's name, then "Send to the kitchen". The server prices everything again from the
 * catalog; the amounts here are for the waiter's eyes only.
 */

type Line = {
  key: string;
  product: Product;
  quantity: number;
  selections: SelectedModifier[];
  unitPrice: number;
  notes: string;
};

const money = (n: number) => Math.round(n * 100) / 100;

function ItemSheet({ product, onAdd, onClose }: { product: Product; onAdd: (line: Omit<Line, "key">) => void; onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { config, loading } = useProductBuilderConfig(product.id);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [unitPrice, setUnitPrice] = useState(product.price);
  const [valid, setValid] = useState(true);
  const [selections, setSelections] = useState<SelectedModifier[]>([]);

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-dark-brown/40 sm:items-center" role="dialog" aria-modal="true" data-item-sheet={product.id}>
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl bg-warm-white shadow-premium sm:rounded-3xl">
        <div className="flex items-center justify-between gap-3 border-b border-beige-dark/20 px-5 py-4">
          <p className="font-display text-lg font-bold text-dark-brown">{getLocalizedName(product, locale)}</p>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-coffee/60 hover:bg-beige/50" aria-label={t("courier.cancel")}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading || !config ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-7 w-7 animate-spin text-turquoise" />
            </div>
          ) : (
            <ProductBuilder
              product={product}
              config={config}
              quantity={quantity}
              onQuantityChange={setQuantity}
              notes={notes}
              onNotesChange={setNotes}
              onUnitPriceChange={setUnitPrice}
              onValidChange={setValid}
              onSelectionsChange={setSelections}
            />
          )}
        </div>
        <div className="border-t border-beige-dark/20 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="button"
            disabled={loading || !config || !valid}
            onClick={() => onAdd({ product, quantity, selections, unitPrice, notes: notes.trim() })}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-turquoise font-bold text-warm-white disabled:opacity-50"
            data-add-item
          >
            <Plus className="h-4 w-4" />
            {t("waiter.newOrder.add").replace("{amount}", formatPrice(money(unitPrice * quantity)))}
          </button>
        </div>
      </div>
    </div>
  );
}

export function WaiterNewOrder({
  table,
  waiterId,
  onBack,
  onSent,
  onSignedOut,
}: {
  table: DineInTable;
  /** The waiter chosen on a fixed tablet (none for a waiter signed in with her code). */
  waiterId?: string;
  onBack: () => void;
  onSent: (orderNumber: string) => void;
  onSignedOut: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { products, loading } = useAllProducts();
  const { categories } = useCategories();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [picking, setPicking] = useState<Product | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [step, setStep] = useState<"menu" | "details">("menu");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const menu = useMemo(() => products.filter((p) => !p.hidden && !p.isTestProduct && p.active !== false), [products]);
  const usedCategories = useMemo(() => {
    const ids = new Set(menu.map((p) => p.categoryId));
    return [...categories].filter((c) => ids.has(c.id)).sort((a, b) => a.sortOrder - b.sortOrder);
  }, [categories, menu]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const order = new Map(usedCategories.map((c, i) => [c.id, i]));
    return menu
      .filter((p) => (categoryId === "all" ? true : p.categoryId === categoryId))
      .filter((p) => !q || [p.name_he, p.name_ar, p.name_en].some((n) => (n || "").toLowerCase().includes(q)))
      .sort((a, b) => (order.get(a.categoryId) ?? 99) - (order.get(b.categoryId) ?? 99) || a.sortOrder - b.sortOrder);
  }, [categoryId, menu, query, usedCategories]);

  const count = lines.reduce((sum, l) => sum + l.quantity, 0);
  const total = money(lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0));

  const addLine = (line: Omit<Line, "key">) => {
    setLines((prev) => [...prev, { ...line, key: `${line.product.id}-${Date.now()}-${prev.length}` }]);
    setPicking(null);
  };
  const changeQty = (key: string, delta: number) =>
    setLines((prev) => prev.flatMap((l) => (l.key !== key ? [l] : l.quantity + delta <= 0 ? [] : [{ ...l, quantity: Math.min(99, l.quantity + delta) }])));

  const errorText = (code: string | undefined, names: string[] | undefined): string => {
    const items = (names ?? []).join(", ");
    switch (code) {
      case "OPTIONS_UNAVAILABLE":
        return t("waiter.newOrder.error.options").replace("{items}", items);
      case "PRODUCT_UNAVAILABLE":
      case "PRODUCT_NOT_FOUND":
        return items ? t("waiter.newOrder.error.unavailable").replace("{items}", items) : t("checkout.productMissing");
      case "DINE_IN_UNAVAILABLE":
        return t("waiter.newOrder.error.closed");
      case "UNKNOWN_TABLE":
        return t("checkout.unknownTable");
      case "CHOOSE_WAITER":
        return t("waiter.error.chooseWaiter");
      case "INVALID_PHONE":
        return t("waiter.newOrder.error.phone");
      case "RATE_LIMITED":
        return t("checkout.tooManyOrders");
      default:
        return t("courier.error.generic");
    }
  };

  const send = async () => {
    if (busy || lines.length === 0 || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/staff/tables/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: table.id,
          customerName: name.trim(),
          phone: phone.trim() || undefined,
          notes: notes.trim() || undefined,
          locale,
          waiterId,
          items: lines.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            modifiers: l.selections.map((m) => ({ groupId: m.groupId, optionId: m.optionId, quantity: m.quantity })),
            notes: l.notes || undefined,
          })),
        }),
      });
      if (res.status === 401) return onSignedOut();
      const data = (await res.json().catch(() => null)) as { ok?: boolean; orderNumber?: string; code?: string; productNames?: string[] } | null;
      if (res.ok && data?.ok && data.orderNumber) return onSent(data.orderNumber);
      setError(errorText(data?.code, data?.productNames));
    } catch {
      setError(t("courier.error.generic"));
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="mb-3 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={step === "details" ? () => setStep("menu") : onBack}
        className="inline-flex items-center gap-1 text-sm font-medium text-turquoise"
        data-new-order-back
      >
        <ArrowRight className="h-4 w-4 ltr:rotate-180" />
        {step === "details" ? t("waiter.newOrder.backToMenu") : t("courier.cancel")}
      </button>
      <h2 className="font-display text-lg font-bold text-dark-brown">
        {t("waiter.newOrder.title")} · {tableDisplayName(table, locale)}
      </h2>
    </div>
  );

  if (step === "details") {
    return (
      <div data-new-order={table.id} data-step="details">
        {header}
        <ul className="space-y-2" data-order-lines>
          {lines.map((l) => (
            <li key={l.key} className="flex items-start justify-between gap-3 rounded-2xl bg-warm-white p-3 shadow-soft" data-order-line={l.product.id}>
              <div className="min-w-0">
                <p className="font-semibold text-dark-brown">{getLocalizedName(l.product, locale)}</p>
                {l.selections.length > 0 && (
                  <p className="text-xs text-coffee/60">{l.selections.map((s) => (s.quantity > 1 ? `${s.optionName} ×${s.quantity}` : s.optionName)).join(", ")}</p>
                )}
                {l.notes && <p className="text-xs text-amber-800">{l.notes}</p>}
                <p className="mt-0.5 text-sm text-coffee/70">{formatPrice(money(l.unitPrice * l.quantity))}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => changeQty(l.key, -1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-beige-dark/40" aria-label="-" data-line-minus>
                  {l.quantity === 1 ? <Trash2 className="h-4 w-4 text-red-600" /> : <Minus className="h-4 w-4" />}
                </button>
                <span className="w-6 text-center font-bold" data-line-qty>
                  {l.quantity}
                </span>
                <button type="button" onClick={() => changeQty(l.key, 1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-beige-dark/40" aria-label="+" data-line-plus>
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-4 space-y-3 rounded-2xl bg-warm-white p-4 shadow-soft">
          <label className="block text-sm font-semibold text-dark-brown">
            {t("waiter.newOrder.name")}
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="mt-1 h-12 w-full rounded-xl border border-beige-dark/40 bg-cream px-3 text-base" data-guest-name />
          </label>
          <label className="block text-sm font-semibold text-dark-brown">
            {t("waiter.newOrder.phone")}
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" maxLength={40} className="mt-1 h-12 w-full rounded-xl border border-beige-dark/40 bg-cream px-3 text-base" data-guest-phone />
          </label>
          <label className="block text-sm font-semibold text-dark-brown">
            {t("waiter.newOrder.notes")}
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-xl border border-beige-dark/40 bg-cream px-3 py-2 text-base" data-order-notes />
          </label>
        </div>

        {error && (
          <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-new-order-error>
            {error}
          </p>
        )}
        <p className="mt-3 text-xs text-coffee/55">{t("waiter.newOrder.payLater")}</p>
        <button
          type="button"
          disabled={busy || lines.length === 0 || !name.trim()}
          onClick={() => void send()}
          className="mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-dark-brown text-lg font-bold text-warm-white disabled:opacity-50"
          data-send-order
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          {t("waiter.newOrder.send")} · {formatPrice(total)}
        </button>
      </div>
    );
  }

  return (
    <div data-new-order={table.id} data-step="menu">
      {header}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("waiter.newOrder.search")}
          className="h-11 w-full rounded-xl border border-beige-dark/40 bg-warm-white ps-9 pe-3 text-base"
          data-menu-search
        />
      </div>
      <div className="-mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1" data-menu-categories>
        {[{ id: "all", label: t("waiter.newOrder.all") }, ...usedCategories.map((c) => ({ id: c.id, label: getLocalizedName(c, locale) }))].map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCategoryId(c.id)}
            aria-pressed={categoryId === c.id}
            className={cn(
              "h-9 shrink-0 whitespace-nowrap rounded-full border px-3 text-sm font-semibold",
              categoryId === c.id ? "border-turquoise bg-turquoise text-warm-white" : "border-beige-dark/40 bg-warm-white text-coffee/70"
            )}
            data-menu-category={c.id}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-7 w-7 animate-spin text-turquoise" />
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-menu-products>
          {shown.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={!p.available}
                onClick={() => setPicking(p)}
                className="flex h-full min-h-[4.5rem] w-full flex-col items-start justify-between rounded-2xl bg-warm-white p-3 text-start shadow-soft disabled:opacity-45"
                data-menu-product={p.id}
                data-available={p.available ? "yes" : "no"}
              >
                <span className="line-clamp-2 text-sm font-semibold text-dark-brown">{getLocalizedName(p, locale)}</span>
                <span className="mt-1 text-xs text-coffee/60">{p.available ? formatPrice(p.price) : t("waiter.newOrder.unavailable")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {lines.length > 0 && (
        <div className="sticky bottom-[max(0.75rem,env(safe-area-inset-bottom))] mt-4">
          <button
            type="button"
            onClick={() => setStep("details")}
            className="flex h-14 w-full items-center justify-between rounded-2xl bg-dark-brown px-5 font-bold text-warm-white shadow-premium"
            data-order-continue
          >
            <span>{t("waiter.newOrder.items").replace("{n}", String(count))}</span>
            <span>
              {t("waiter.newOrder.continue")} · {formatPrice(total)}
            </span>
          </button>
        </div>
      )}

      {picking && <ItemSheet product={picking} onAdd={addLine} onClose={() => setPicking(null)} />}
    </div>
  );
}
