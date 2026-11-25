"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { useLocalizedProduct } from "@/hooks/useLocalizedContent";
import { ProductDetailDrawer } from "@/features/catalog/product-detail-drawer";
import { cn } from "@/lib/utils";
import type { CartItem } from "@/types";

/**
 * Edit a line already in the cart (cart drawer, checkout summary, assistant cart): opens the product
 * window with the chosen add-ons, quantity and note, and "Save changes" updates the line.
 */
export function useCartLineEditor() {
  const [editing, setEditing] = useState<CartItem | null>(null);

  const editor = (
    <ProductDetailDrawer
      product={editing?.product ?? null}
      open={!!editing}
      onOpenChange={(open) => {
        if (!open) setEditing(null);
      }}
      editItem={editing}
    />
  );

  return { edit: setEditing, editor };
}

/** Pen button next to the bin. */
export function EditLineButton({
  item,
  onEdit,
  className,
  iconClassName = "h-3.5 w-3.5",
}: {
  item: CartItem;
  onEdit: (item: CartItem) => void;
  className?: string;
  iconClassName?: string;
}) {
  const t = useT();
  const localized = useLocalizedProduct(item.product);
  return (
    <button
      type="button"
      onClick={() => onEdit(item)}
      data-edit-line
      aria-label={`${t("cart.editItem")} ${localized.name}`}
      title={t("cart.editItem")}
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-coffee/45 transition-colors hover:text-turquoise",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-turquoise",
        className
      )}
    >
      <Pencil className={iconClassName} strokeWidth={1.75} />
    </button>
  );
}
