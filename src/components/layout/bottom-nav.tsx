"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHideCustomerChrome } from "@/hooks/useAdminPath";
import { Home, LayoutGrid, ClipboardList, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/locale-provider";
import { OFFERS_HREF } from "@/lib/customer-nav";
import { useActiveOrderCount } from "@/lib/orders/my-order-views";

const NAV_ITEM_CLASS =
  "relative flex h-[var(--mobile-bottom-nav-height)] min-h-[var(--mobile-bottom-nav-height)] flex-1 flex-col items-center justify-center gap-0.5 px-1";

export function BottomNav() {
  const pathname = usePathname();
  const hideChrome = useHideCustomerChrome();
  const t = useT();
  // Orders still in progress on this device: a count only when there is one.
  const activeOrders = useActiveOrderCount();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (hideChrome) return null;
  if (!mounted) return null;

  // No cart here: the cart is in the header and in the round checkout button. Favourites, the
  // account and everything else are in the header and the ☰ side menu.
  const navItems: { href: string; labelKey: string; icon: typeof Home; exact?: boolean; neverActive?: boolean; badge?: number }[] = [
    { href: "/", labelKey: "nav.home", icon: Home, exact: true },
    { href: "/catalog", labelKey: "nav.catalog", icon: LayoutGrid },
    // Until the offers branch: the menu (never shown as the current page).
    { href: OFFERS_HREF, labelKey: "nav.offers", icon: Tag, neverActive: true },
    { href: "/orders", labelKey: "nav.orders", icon: ClipboardList, badge: activeOrders },
  ];

  const nav = (
    <nav
      data-mobile-bottom-nav=""
      aria-label="Mobile"
      className="mobile-bottom-nav lg:hidden"
    >
      <div className="mobile-bottom-nav__inner">
        {navItems.map((item) => {
          const isActive = item.neverActive
            ? false
            : item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          const label = t(item.labelKey);

          return (
            <Link
              key={item.labelKey}
              href={item.href}
              className={NAV_ITEM_CLASS}
              aria-current={isActive ? "page" : undefined}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute top-0 h-0.5 w-8 rounded-full bg-turquoise transition-opacity",
                  isActive ? "opacity-100" : "opacity-0"
                )}
              />
              <span className="relative">
                <Icon
                  className={cn(
                    "h-5 w-5 shrink-0 transition-colors",
                    isActive ? "text-turquoise" : "text-coffee/45"
                  )}
                  strokeWidth={1.75}
                />
                {item.badge ? (
                  <span
                    aria-hidden
                    className="absolute -top-1.5 -end-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-turquoise px-1 text-[9px] font-bold leading-none text-warm-white"
                  >
                    {item.badge}
                  </span>
                ) : null}
              </span>
              <span
                className={cn(
                  "text-[10px] font-medium leading-none",
                  isActive ? "text-turquoise" : "text-coffee/45"
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );

  return createPortal(nav, document.body);
}
