"use client";

import { useT } from "@/components/providers/locale-provider";
import { Input } from "@/components/ui/input";

/**
 * "🚚 Free delivery" + "from ₪___" (optional), for a sale and for a bundle. The delivery fee is 0 for
 * an order with it, from that amount of products in the whole order; the area's minimum still applies.
 */
export function FreeDeliveryFields({
  enabled,
  min,
  onChange,
  hint,
}: {
  enabled: boolean;
  min: string;
  onChange: (patch: { freeDelivery?: boolean; freeDeliveryMin?: string }) => void;
  hint: string;
}) {
  const t = useT();
  return (
    <fieldset className="space-y-2 rounded-xl border border-beige-dark/30 p-3" data-free-delivery-fields>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={enabled} onChange={(e) => onChange({ freeDelivery: e.target.checked })} className="h-4 w-4 accent-[#007A80]" data-free-delivery />
        🚚 {t("offers.freeDelivery")}
      </label>
      {enabled && (
        <div className="flex flex-wrap items-center gap-2 ps-6">
          <label htmlFor="free-delivery-min" className="text-sm text-coffee/75">{t("admin.bundles.freeDeliveryFrom")}</label>
          <div className="flex items-center gap-1">
            <span className="text-sm text-coffee/60">₪</span>
            <Input
              id="free-delivery-min"
              value={min}
              onChange={(e) => onChange({ freeDeliveryMin: e.target.value.replace(/[^\d.]/g, "").slice(0, 7) })}
              inputMode="decimal"
              dir="ltr"
              className="h-10 w-24"
              data-free-delivery-min
            />
          </div>
          <span className="text-xs text-coffee/55">({t("admin.bundles.optional")})</span>
        </div>
      )}
      <p className="text-xs text-coffee/55">{hint}</p>
    </fieldset>
  );
}
