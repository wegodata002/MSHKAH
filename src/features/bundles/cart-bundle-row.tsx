"use client";

import { Minus, Package, Plus, Trash2 } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { getLocalizedName } from "@/lib/i18n/localized-content";
import { bundleName } from "@/lib/bundles/bundle";
import { formatPrice, cn } from "@/lib/utils";
import type { CartBundleLine } from "@/types";

/**
 * A bundle in the cart / checkout summary: its name, the products chosen (with their add-ons), the
 * price now with what it would cost separately struck through, quantity and remove. A bundle that
 * is over says so (the order can't be sent with it).
 */
export function CartBundleRow({
  line,
  onQuantity,
  onRemove,
  compact = false,
}: {
  line: CartBundleLine;
  onQuantity?: (quantity: number) => void;
  onRemove: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const name = line.bundle ? bundleName(line.bundle, locale) : t("bundles.title");
  const unit = line.unitPrice ?? 0;
  const regular = line.regularUnitPrice ?? 0;
  const ended = line.available === false;
  return (
    <div className={cn("border-b border-beige-dark/10 py-3 last:border-0", ended && "opacity-80")} data-cart-bundle={line.bundleId} data-bundle-ended={ended ? "yes" : "no"}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FBE7E3] text-[#9A2B1A]" aria-hidden>
          <Package className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-dark-brown dark:text-warm-white">{name}</p>
          <ul className="mt-0.5 space-y-0.5 text-xs text-coffee/60">
            {line.picks.map((pick, i) => (
              <li key={`${pick.slotId}-${i}`}>
                • {getLocalizedName(pick.product, locale)}
                {pick.selections.length > 0 && (
                  <span className="text-coffee/45">
                    {" "}
                    ({pick.selections.map((s) => `${s.optionName}${s.priceDelta > 0 ? ` +${formatPrice(s.priceDelta * s.quantity)}` : ""}`).join(", ")})
                  </span>
                )}
                {pick.notes ? <span className="text-coffee/45"> · {pick.notes}</span> : null}
              </li>
            ))}
          </ul>
          {ended ? (
            <p className="mt-1 text-xs font-medium text-amber-800" role="status">{t("bundles.ended")}</p>
          ) : (
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-bold text-[#9A2B1A] dark:text-[#FF8A73]" data-bundle-line-price>{formatPrice(unit * line.quantity)}</span>
              {regular > unit && <s className="text-xs text-coffee/45" data-bundle-line-regular>{formatPrice(regular * line.quantity)}</s>}
              {regular > unit && <span className="text-xs text-emerald-700">{t("bundles.saved").replace("{amount}", formatPrice((regular - unit) * line.quantity))}</span>}
            </p>
          )}
        </div>
      </div>
      <div className={cn("mt-2 flex items-center justify-end gap-2", compact && "mt-1")}>
        {onQuantity && !ended && (
          <div className="flex items-center gap-1 rounded-full border border-beige-dark/30">
            <button type="button" onClick={() => onQuantity(line.quantity - 1)} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-beige/50" aria-label={t("cart.decrease", "−")}>
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="w-6 text-center text-sm font-semibold" data-bundle-quantity>{line.quantity}</span>
            <button type="button" onClick={() => onQuantity(line.quantity + 1)} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-beige/50" aria-label={t("cart.increase", "+")}>
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {!onQuantity && !ended && <span className="text-xs text-coffee/60">× {line.quantity}</span>}
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-coffee/40 transition-colors hover:bg-red-50 hover:text-red-500"
          aria-label={t("bundles.remove").replace("{name}", name)}
          data-bundle-remove
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
