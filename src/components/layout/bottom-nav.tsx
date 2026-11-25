"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHideCustomerChrome } from "@/hooks/useAdminPath";
import { Home, LayoutGrid, ClipboardList, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/locale-provider";
import { useFavorites } from "@/hooks/useFavorites";

const NAV_ITEM_CLASS =
  "relative flex h-[var(--mobile-bottom-nav-height)] min-h-[var(--mobile-bottom-nav-height)] flex-1 flex-col items-center justify-center gap-0.5 px-1";

export function BottomNav() {
  const pathname = usePathname();
  const hideChrome = useHideCustomerChrome();
  const t = useT();
  const { count: favoritesCount } = useFavorites();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (hideChrome) return null;
  if (!mounted) return null;

  // No cart item here: the cart lives in the header and in the round checkout button.
  // "Favourites" took the place of "Account" (/account stays reachable from the footer links).
  const navItems = [
    { href: "/", labelKey: "nav.home", icon: Home, exact: true },
    { href: "/catalog", labelKey: "nav.catalog", icon: LayoutGrid },
    { href: "/orders", labelKey: "nav.orders", icon: ClipboardList },
    { href: "/favorites", labelKey: "nav.favorites", icon: Heart, badge: favoritesCount },
  ];

  const nav = (
    <nav
      data-mobile-bottom-nav=""
      aria-label="Mobile"
      className="mobile-bottom-nav lg:hidden"
    >
      <div className="mobile-bottom-nav__inner">
        {navItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const Icon = item.icon;
          const label = t(item.labelKey);

          return (
            <Link
              key={item.href}
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
