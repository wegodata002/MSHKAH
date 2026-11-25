"use client";

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { usePathname } from "next/navigation";
import { useHideCustomerChrome } from "@/hooks/useAdminPath";
import { useCart } from "@/features/cart/cart-context";
import { useFooterInView } from "@/hooks/useFooterInView";
import { useT } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";

/**
 * Round "go to checkout" button (same size and shape as the assistant / accessibility buttons).
 * Bottom row, start corner; the assistant and accessibility buttons sit in the end corner of
 * the same row. Shown only while the cart has items, hidden on checkout.
 */
export function CheckoutFab() {
  const { itemCount } = useCart();
  const pathname = usePathname();
  const hideChrome = useHideCustomerChrome();
  const t = useT();
  const footerInView = useFooterInView();

  if (hideChrome || pathname.startsWith("/checkout")) return null;

  const label =
    itemCount === 1
      ? t("cart.goToCheckoutOne", "Go to checkout (1 item)")
      : t("cart.goToCheckoutCount", "Go to checkout ({count} items)").replace("{count}", String(itemCount));

  return (
    <AnimatePresence>
      {itemCount > 0 && (
        <motion.div
          key="checkout-fab"
          data-cart-fab
          initial={{ opacity: 0, scale: 0.8 }}
          // Fades out while the site footer is on screen, so it never covers the footer's text.
          animate={{ opacity: footerInView ? 0 : 1, scale: footerInView ? 0.8 : 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          aria-hidden={footerInView || undefined}
          className={cn(
            "fixed z-[60] print:hidden",
            "bottom-[calc(var(--mobile-bottom-nav-height)+env(safe-area-inset-bottom,0px)+0.75rem)] start-4 lg:bottom-6 lg:start-6",
            footerInView && "pointer-events-none"
          )}
        >
          <Link
            href="/checkout"
            tabIndex={footerInView ? -1 : undefined}
            aria-label={label}
            title={label}
            className={cn(
              "relative flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-full",
              "border border-white/25 bg-dark-brown text-warm-white shadow-premium",
              "transition-transform hover:scale-105 active:scale-95",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-turquoise focus-visible:ring-offset-2"
            )}
          >
            <ShoppingBag className="h-5 w-5" strokeWidth={1.75} aria-hidden />
            {/* Small "to checkout" arrow under the bag. */}
            <ArrowRight className="h-3.5 w-3.5 text-turquoise-light rtl:rotate-180" strokeWidth={2.25} aria-hidden />
            <span
              aria-hidden
              className="absolute -top-1 -end-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-turquoise px-1 text-[11px] font-bold text-warm-white ring-2 ring-cream"
            >
              {itemCount}
            </span>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
