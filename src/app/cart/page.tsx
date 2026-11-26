"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useCart } from "@/features/cart/cart-context";

/**
 * /cart (old links, the browser's address bar): opens the cart and shows the menu behind it. The
 * cart drawer lives in the layout, so it stays open across the move; an empty cart shows its usual
 * "Your cart is empty" view.
 */
export default function CartPage() {
  const { openCart } = useCart();
  const router = useRouter();

  useEffect(() => {
    openCart();
    router.replace("/catalog");
  }, [openCart, router]);

  return (
    <div className="flex justify-center py-20" data-cart-redirect>
      <Loader2 className="h-6 w-6 animate-spin text-turquoise" />
    </div>
  );
}
