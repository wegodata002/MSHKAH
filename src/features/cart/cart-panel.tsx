"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Minus, Plus, Trash2, ShoppingBag, Tag, ArrowRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPrice } from "@/lib/utils";
import { Logo } from "@/components/brand/logo";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { couponDisplayName } from "@/lib/coupons/store-coupons";
import { useLocalizedProduct } from "@/hooks/useLocalizedContent";
import { useCart } from "@/features/cart/cart-context";
import { ProductImage } from "@/components/catalog/product-image";
import { calculateLineTotal } from "@/lib/product-builder/engine";
import type { CartItem } from "@/types";
import { EditLineButton, useCartLineEditor } from "@/features/cart/cart-line-editor";
import { FulfillmentNote } from "@/features/checkout/fulfillment-note";
import { ClubCouponOffer } from "@/features/club/club-coupon-offer";
import { couponMessageKey } from "@/lib/orders/coupons";
import { SaleBadge, SalePrice } from "@/features/sales/sale-price-view";
import { SaleNotices, SaleSavingsRow } from "@/features/sales/cart-sale-parts";

function CartLineItem({
  item,
  onRemove,
  onUpdateQuantity,
  onEdit,
  compact,
}: {
  item: CartItem;
  onRemove: () => void;
  onUpdateQuantity: (qty: number) => void;
  onEdit?: (item: CartItem) => void;
  compact?: boolean;
}) {
  const t = useT();
  const localized = useLocalizedProduct(item.product);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="border-b border-beige-dark/15 py-3 last:border-b-0"
    >
      <div className="flex items-start gap-3">
        {!compact && (
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-beige/30">
            <ProductImage
              image={item.product.image}
              categoryId={item.product.categoryId}
              alt={localized.name}
              thumbnail
              sizes="56px"
            />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="heading-product text-sm" dir={localized.dir}>
              {localized.name}
            </h4>
            <div className="flex shrink-0 items-center gap-1">
              {onEdit && (
                <EditLineButton item={item} onEdit={onEdit} className="rounded-md p-1.5 hover:bg-beige/40" />
              )}
              <button
                type="button"
                onClick={onRemove}
                className="rounded-md p-1.5 text-coffee/35 transition-colors hover:text-red-500"
                aria-label={t("common.remove", "Remove")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <SalePrice product={item.product} size="sm" amount={item.unitPrice} regularAmount={item.regularUnitPrice} className="text-base" />
            <SaleBadge product={item.product} className="px-1.5 text-[10px] md:text-[10px]" />
          </div>
          {item.selections.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {item.selections.map((s) => (
                <li key={`${s.groupId}-${s.optionId}`} className="text-caption">
                  {s.optionName}
                  {s.quantity > 1 ? ` ×${s.quantity}` : ""}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onUpdateQuantity(item.quantity - 1)}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-beige-dark/30 bg-warm-white transition-colors hover:border-turquoise"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="w-5 text-center text-sm font-semibold">{item.quantity}</span>
              <button
                type="button"
                onClick={() => onUpdateQuantity(item.quantity + 1)}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-beige-dark/30 bg-warm-white transition-colors hover:border-turquoise"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <SalePrice
              product={item.product}
              size="sm"
              amount={calculateLineTotal(item.unitPrice, item.quantity)}
              regularAmount={calculateLineTotal(item.regularUnitPrice ?? item.unitPrice, item.quantity)}
              className="text-base"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

interface CartPanelProps {
  compact?: boolean;
  onCheckout?: () => void;
  className?: string;
}

export function CartPanel({ compact, onCheckout, className }: CartPanelProps) {
  const t = useT();
  const {
    items,
    removeItem,
    updateQuantity,
    subtotal,
    discount,
    total,
    itemCount,
    applyCoupon,
    removeCoupon,
    couponCode,
    couponName,
    couponBelowMinimum,
    couponMinOrder,
    lastCouponMinOrder,
  } = useCart();
  const { locale } = useLocale();
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  // Pen on every line: opens the product window with the line's add-ons, quantity and note.
  const { edit, editor } = useCartLineEditor();

  const handleCoupon = async () => {
    if (!couponInput.trim()) return;
    const check = await applyCoupon(couponInput);
    setCouponError(check === "ok" ? null : t(couponMessageKey(check)).replace("{min}", formatPrice(lastCouponMinOrder())));
  };

  // Clearing the whole field cancels an applied coupon (same as ✕); partial edits don't.
  const handleCouponInputChange = (value: string) => {
    setCouponInput(value);
    // Any change to the code hides the old coupon message.
    setCouponError(null);
    if (!value.trim() && couponCode) removeCoupon();
  };

  // Keep an applied coupon visible in the field (e.g. applied elsewhere or after reload).
  useEffect(() => {
    if (couponCode) setCouponInput((current) => (current.trim() ? current : couponCode));
  }, [couponCode]);

  return (
    <div className={className}>
      <div className="flex shrink-0 items-center gap-2 border-b border-beige-dark/15 pb-4">
        <ShoppingBag className="h-5 w-5 text-coffee" strokeWidth={1.75} />
        <h2 className="heading-section text-lg">{t("cart.title")}</h2>
        {itemCount > 0 && (
          <span className="text-caption">({itemCount})</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2">
        <AnimatePresence mode="popLayout">
          {items.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center py-10 text-center"
            >
              <Logo size="md" href={null} className="h-12 w-auto opacity-80" />
              <p className="text-body mt-3">{t("cart.empty")}</p>
              <p className="text-caption mt-1">{t("cart.emptyHint")}</p>
            </motion.div>
          ) : (
            <div>
              {items.map((item) => (
                <CartLineItem
                  key={item.lineId}
                  item={item}
                  compact={compact}
                  onRemove={() => removeItem(item.lineId)}
                  onUpdateQuantity={(qty) => updateQuantity(item.lineId, qty)}
                  onEdit={edit}
                />
              ))}
            </div>
          )}
        </AnimatePresence>
      </div>

      {items.length > 0 && (
        <div className="shrink-0 border-t border-beige-dark/15 pt-4">
          {/* Shown in the mobile/tablet drawer too. text-base below md avoids iOS focus zoom. */}
          <div className="mb-3 flex gap-2">
            <Input
              value={couponInput}
              onChange={(e) => handleCouponInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCoupon();
                }
              }}
              placeholder={t("cart.coupon", "Coupon code")}
              aria-label={t("cart.coupon", "Coupon code")}
              className="h-9 text-base lg:text-sm"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCoupon()}
              className="shrink-0"
              aria-label={t("cart.coupon", "Coupon code")}
            >
              <Tag className="h-3.5 w-3.5" />
            </Button>
          </div>
          {couponError && <p className="mb-2 text-xs text-red-600">{couponError}</p>}
          <ClubCouponOffer className="mb-2" />
          {couponCode && (
            <p className="mb-2 text-xs text-turquoise" data-coupon-applied>
              {couponCode}
              {couponDisplayName(couponName, locale) ? ` · ${couponDisplayName(couponName, locale)}` : ""}
            </p>
          )}
          {couponBelowMinimum && (
            <p className="mb-2 text-xs text-amber-700" data-coupon-below-minimum>
              {t("cart.couponMinOrder").replace("{min}", formatPrice(couponMinOrder))}
            </p>
          )}

          <SaleNotices />
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-coffee/70">
              <span>{t("cart.subtotal")}</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            <SaleSavingsRow />
            {discount > 0 && (
              <div className="flex justify-between text-turquoise">
                <span className="inline-flex items-center gap-1">
                  {t("cart.discount", "Discount")}
                  <button
                    type="button"
                    onClick={() => {
                      removeCoupon();
                      setCouponInput("");
                      setCouponError(null);
                    }}
                    aria-label={t("cart.removeCoupon", "Remove coupon")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full text-coffee/50 transition-colors hover:bg-beige/60 hover:text-coffee"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </span>
                <span>-{formatPrice(discount)}</span>
              </div>
            )}
            <FulfillmentNote />
            <div className="flex justify-between border-t border-beige-dark/15 pt-2">
              <span className="font-semibold text-dark-brown">{t("cart.total")}</span>
              <span className="text-price text-xl">{formatPrice(total)}</span>
            </div>
          </div>

          <Link href="/checkout" onClick={onCheckout}>
            <Button
              variant="turquoise"
              size="lg"
              className="mt-4 h-12 w-full rounded-xl text-base transition-transform hover:scale-[1.01]"
            >
              {t("cart.checkout")}
              <ArrowRight className="ms-2 h-4 w-4 rtl:rotate-180" strokeWidth={1.75} />
            </Button>
          </Link>
        </div>
      )}

      {editor}
    </div>
  );
}
