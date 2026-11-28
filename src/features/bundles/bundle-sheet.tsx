"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Minus, Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useProductBuilderConfig } from "@/hooks/useModifiers";
import { ProductBuilder } from "@/features/catalog/product-builder";
import { useCart } from "@/features/cart/cart-context";
import { useSaleClock } from "@/features/sales/sale-price-view";
import { getLocalizedName } from "@/lib/i18n/localized-content";
import { productHasBuilder } from "@/lib/product-builder/engine";
import { bundleDescription, bundleName, productFitsSlot, slotCount, type Bundle, type BundleSlot } from "@/lib/bundles/bundle";
import { priceCartBundle } from "@/lib/bundles/cart-bundle";
import { priceNow, saleUntilText } from "@/lib/sales/sale-price";
import { cn, formatPrice } from "@/lib/utils";
import type { CartBundleLine, Product } from "@/types";
import type { SelectedModifier } from "@/types/modifiers";

const orderable = (p: Product) => p.available !== false && p.active !== false && !p.hidden;

type Pick = { slotId: string; productId: string | null; selections: SelectedModifier[]; notes: string; valid: boolean };

function startPicks(bundle: Bundle): Pick[] {
  return bundle.slots.flatMap((slot) =>
    Array.from({ length: slotCount(slot) }, () => ({ slotId: slot.id, productId: slot.kind === "fixed" ? slot.productId : null, selections: [], notes: "", valid: true }))
  );
}

/** The add-ons of one chosen product, inside the bundle window (paid on top of the bundle). */
function PickAddons({ product, onChange }: { product: Product; onChange: (patch: { selections?: SelectedModifier[]; notes?: string; valid?: boolean }) => void }) {
  const t = useT();
  const { config } = useProductBuilderConfig(product.id);
  const [notes, setNotes] = useState("");
  const [open, setOpen] = useState(false);
  const onSelections = useCallback((selections: SelectedModifier[]) => onChange({ selections }), [onChange]);
  const onValid = useCallback((valid: boolean) => onChange({ valid }), [onChange]);
  const noop = useCallback(() => {}, []);
  if (!config || !productHasBuilder(config)) return null;
  return (
    <div className="mt-2 rounded-xl bg-beige/25 p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-sm font-medium text-turquoise underline-offset-2 hover:underline" aria-expanded={open} data-bundle-pick-addons>
        {t(open ? "bundles.hideOptions" : "bundles.options")}
      </button>
      <div className={cn("mt-3", !open && "hidden")}>
        <ProductBuilder
          inBundle
          product={product}
          config={config}
          quantity={1}
          onQuantityChange={noop}
          notes={notes}
          onNotesChange={(n) => {
            setNotes(n);
            onChange({ notes: n });
          }}
          onUnitPriceChange={noop}
          onValidChange={onValid}
          onSelectionsChange={onSelections}
        />
      </div>
    </div>
  );
}

/**
 * Choosing a bundle: for each part, the product (or products) to put in, each with its add-ons (paid
 * on top), then "Add to cart". The price shown is the bundle price now with what the products cost
 * separately struck through; the server prices the order again. `onAdd` replaces the cart (waiter screen).
 */
export function BundleSheet({
  bundle,
  products,
  open,
  onOpenChange,
  onAdd,
}: {
  bundle: Bundle | null;
  products: readonly Product[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd?: (line: Omit<CartBundleLine, "lineId">) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const isPhone = useIsMobile(768);
  const { addBundle, openCart } = useCart();
  const clock = useSaleClock();
  const [picks, setPicks] = useState<Pick[]>([]);
  const [quantity, setQuantity] = useState(1);
  useEffect(() => {
    if (bundle && open) {
      setPicks(startPicks(bundle));
      setQuantity(1);
    }
  }, [bundle, open]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const optionsFor = useCallback(
    (slot: BundleSlot) => products.filter((p) => orderable(p) && productFitsSlot(slot, p)),
    [products]
  );
  const patchPick = useCallback((index: number, patch: Partial<Pick>) => setPicks((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p))), []);

  if (!bundle) return null;
  const chosen = picks.filter((p) => p.productId && byId.get(p.productId));
  const complete = picks.length > 0 && chosen.length === picks.length && picks.every((p) => p.valid);
  const cartPicks = chosen.map((p) => ({ slotId: p.slotId, product: byId.get(p.productId!)!, selections: p.selections, notes: p.notes.trim() || undefined }));
  const priced = priceCartBundle(bundle, cartPicks, new Map(), clock || Date.now());
  const name = bundleName(bundle, locale);

  const add = () => {
    if (!complete) return;
    const line = { bundleId: bundle.id, quantity, picks: cartPicks };
    if (onAdd) onAdd(line);
    else {
      addBundle(line);
      openCart();
    }
    onOpenChange(false);
  };

  let unitIndex = -1;
  const body = (
    <div className="flex h-full min-h-0 flex-col" data-bundle-sheet={bundle.id}>
      <div className="flex items-start justify-between gap-3 border-b border-beige-dark/15 p-4">
        <div className="min-w-0">
          <DialogHeader className="space-y-1 text-start">
            <DialogTitle className="font-display text-xl font-bold text-dark-brown">{name}</DialogTitle>
            <DialogDescription className="text-sm text-coffee/60">
              {bundleDescription(bundle, locale) || t("bundles.chooseHint")}
            </DialogDescription>
          </DialogHeader>
          <p className="mt-1 flex flex-wrap gap-2 text-xs">
            <span className="text-coffee/55">{t("sale.until").replace("{date}", saleUntilText(bundle.endsAt))}</span>
            {bundle.freeDelivery && (
              <span className="font-semibold text-turquoise">
                🚚 {bundle.freeDeliveryMin ? t("offers.freeDeliveryFrom").replace("{min}", formatPrice(bundle.freeDeliveryMin)) : t("offers.freeDelivery")}
              </span>
            )}
          </p>
        </div>
        <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-beige/50" aria-label={t("common.close", "Close")}>
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {bundle.slots.map((slot, slotIndex) => {
          const options = optionsFor(slot);
          const count = slotCount(slot);
          const slotPicks = picks.map((p, i) => ({ p, i })).filter(({ p }) => p.slotId === slot.id);
          const done = slotPicks.filter(({ p }) => p.productId).length;
          return (
            <section key={slot.id} className="space-y-2" data-bundle-sheet-slot={slot.id}>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-dark-brown">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-turquoise/10 text-xs font-bold text-turquoise">{slotIndex + 1}</span>
                {slot.kind === "fixed"
                  ? `${count} × ${byId.get(slot.productId) ? getLocalizedName(byId.get(slot.productId)!, locale) : ""}`
                  : t("bundles.chooseN").replace("{n}", String(count))}
                {slot.kind !== "fixed" && <span className="text-xs font-normal text-coffee/50">({done}/{count})</span>}
              </h3>
              {slotPicks.map(({ p, i }, k) => {
                unitIndex += 1;
                const product = p.productId ? byId.get(p.productId) : undefined;
                return (
                  <div key={`${slot.id}-${k}`} className="rounded-xl border border-beige-dark/25 p-3" data-bundle-unit={unitIndex}>
                    {slot.kind !== "fixed" && (
                      <>
                        {count > 1 && <p className="mb-2 text-xs font-medium text-coffee/55">{t("bundles.unit").replace("{n}", String(k + 1))}</p>}
                        <div className="flex flex-wrap gap-2" role="radiogroup">
                          {options.map((o) => {
                            const selected = p.productId === o.id;
                            return (
                              <button
                                key={o.id}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => patchPick(i, { productId: o.id, selections: [], notes: "", valid: true })}
                                className={cn(
                                  "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm",
                                  selected ? "border-turquoise bg-turquoise/10 font-semibold text-turquoise" : "border-beige-dark/40 hover:bg-beige/30"
                                )}
                                data-bundle-option={o.id}
                              >
                                {selected && <Check className="h-3.5 w-3.5" />}
                                {getLocalizedName(o, locale)}
                              </button>
                            );
                          })}
                          {options.length === 0 && <p className="text-xs text-amber-800">{t("bundles.partEmpty")}</p>}
                        </div>
                      </>
                    )}
                    {product && <PickAddons key={product.id} product={product} onChange={(patch) => patchPick(i, patch)} />}
                  </div>
                );
              })}
            </section>
          );
        })}
        <p className="text-xs text-coffee/55">{t("bundles.addonsExtra")}</p>
      </div>

      <div className="border-t border-beige-dark/15 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div data-bundle-sheet-price>
            <p className="font-display text-2xl font-bold text-[#9A2B1A] dark:text-[#FF8A73]">{formatPrice(priced.unitPrice * quantity)}</p>
            {complete && priced.regularUnitPrice > priced.unitPrice && (
              <p className="text-xs text-coffee/55">
                <s>{formatPrice(priced.regularUnitPrice * quantity)}</s> · {t("bundles.saved").replace("{amount}", formatPrice((priced.regularUnitPrice - priced.unitPrice) * quantity))}
              </p>
            )}
            {priced.extras > 0 && <p className="text-xs text-coffee/55">{t("bundles.priceWithAddons").replace("{price}", formatPrice(priced.bundlePrice)).replace("{addons}", formatPrice(priced.extras))}</p>}
          </div>
          <div className="flex items-center gap-1 rounded-full border border-beige-dark/30">
            <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-beige/50" aria-label="−">
              <Minus className="h-4 w-4" />
            </button>
            <span className="w-6 text-center font-bold">{quantity}</span>
            <button type="button" onClick={() => setQuantity((q) => Math.min(99, q + 1))} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-beige/50" aria-label="+">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
        <Button type="button" variant="turquoise" size="lg" className="h-12 w-full rounded-xl text-base" disabled={!complete} onClick={add} data-bundle-add-to-cart>
          {complete ? t("bundles.addToCart").replace("{price}", formatPrice(priced.unitPrice * quantity)) : t("bundles.completeChoices")}
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        hideCloseButton
        {...(isPhone ? { layout: "custom" as const } : {})}
        className={cn(
          "flex flex-col gap-0 overflow-hidden p-0",
          isPhone ? "inset-0 h-[100dvh] max-h-[100dvh] w-full max-w-none rounded-none border-0" : "h-[min(760px,calc(100dvh-40px))] w-[min(640px,calc(100vw-40px))] max-w-[640px]"
        )}
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}

/** For the card: the price now of a product (sale included) — used by the bundle card's "save at least". */
export function productPriceNow(p: Product, now: number): number {
  return priceNow(p, now).price;
}
