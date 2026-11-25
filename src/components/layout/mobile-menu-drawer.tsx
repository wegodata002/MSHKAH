"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ClipboardList, Heart, Home, Info, LayoutGrid, Phone, Star, Tag, X, type LucideIcon } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { useFavorites } from "@/hooks/useFavorites";
import { useActiveOrderCount } from "@/lib/orders/my-order-views";
import { scrollToAbout } from "@/lib/scroll-to-about";
import { OFFERS_HREF } from "@/lib/customer-nav";
import { cn } from "@/lib/utils";

type DrawerLink = { href: string; labelKey: string; icon: LucideIcon; count?: number; exact?: boolean; neverActive?: boolean };

/**
 * Phone and tablet (below lg): the ☰ menu. Opens from the start side (right in Hebrew and Arabic,
 * left in English) with every link, About, Contact and the language. Closes with ✕, a tap outside,
 * Escape, or a page change.
 */
export function MobileMenuDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { dir } = useLocale();
  const pathname = usePathname();
  const { count: favorites } = useFavorites();
  const activeOrders = useActiveOrderCount();
  const closeRef = useRef<HTMLButtonElement>(null);
  const rtl = dir === "rtl";

  // Close on a page change.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      onClose();
    }
  }, [onClose, pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, open]);

  if (typeof document === "undefined") return null;

  const links: DrawerLink[] = [
    { href: "/", labelKey: "nav.home", icon: Home, exact: true },
    { href: "/catalog", labelKey: "nav.catalog", icon: LayoutGrid },
    { href: OFFERS_HREF, labelKey: "nav.offers", icon: Tag, neverActive: true },
    { href: "/favorites", labelKey: "nav.favorites", icon: Heart, count: favorites },
    { href: "/orders", labelKey: "nav.orders", icon: ClipboardList, count: activeOrders },
    { href: "/account", labelKey: "nav.accountClub", icon: Star },
  ];
  const isActive = (l: DrawerLink) =>
    !l.neverActive && (l.exact ? pathname === l.href : pathname === l.href || pathname.startsWith(`${l.href}/`));
  const row = "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start text-[15px] font-semibold";

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[130] lg:hidden" data-mobile-menu>
          <motion.div
            className="absolute inset-0 bg-dark-brown/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            data-mobile-menu-scrim
          />
          <motion.nav
            dir={dir}
            aria-label={t("nav.openMenu")}
            className={cn(
              "absolute inset-y-0 flex w-[min(20rem,82vw)] flex-col bg-warm-white shadow-premium",
              rtl ? "right-0" : "left-0"
            )}
            initial={{ x: rtl ? "100%" : "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: rtl ? "100%" : "-100%" }}
            transition={{ type: "tween", duration: 0.22 }}
            data-mobile-menu-panel={rtl ? "right" : "left"}
          >
            <div className="flex items-center justify-between border-b border-beige-dark/15 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <Logo size="sm" href="/" className="h-9 w-auto" />
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label={t("nav.closeMenu")}
                className="flex h-10 w-10 items-center justify-center rounded-full text-coffee hover:bg-cream"
                data-mobile-menu-close
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
            <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
              {links.map((l) => {
                const Icon = l.icon;
                const active = isActive(l);
                return (
                  <li key={l.labelKey}>
                    <Link
                      href={l.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={cn(row, active ? "bg-turquoise/10 text-turquoise" : "text-dark-brown hover:bg-cream")}
                      data-mobile-menu-link={l.labelKey}
                    >
                      <Icon className="h-5 w-5 shrink-0 text-turquoise" strokeWidth={1.75} />
                      <span className="flex-1">{t(l.labelKey)}</span>
                      {l.count ? <span className="rounded-full bg-turquoise px-2 text-xs font-bold text-warm-white">{l.count}</span> : null}
                    </Link>
                  </li>
                );
              })}
              <li aria-hidden className="mx-3 my-2 h-px bg-beige-dark/20" />
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    // After the drawer has let go of the page scroll.
                    window.setTimeout(() => scrollToAbout(), 250);
                  }}
                  className={cn(row, "text-dark-brown hover:bg-cream")}
                  data-mobile-menu-link="nav.about"
                >
                  <Info className="h-5 w-5 shrink-0 text-turquoise" strokeWidth={1.75} />
                  <span className="flex-1">{t("nav.about")}</span>
                </button>
              </li>
              <li>
                <Link href="/account#contact" onClick={onClose} className={cn(row, "text-dark-brown hover:bg-cream")} data-mobile-menu-link="nav.contact">
                  <Phone className="h-5 w-5 shrink-0 text-turquoise" strokeWidth={1.75} />
                  <span className="flex-1">{t("nav.contact")}</span>
                </Link>
              </li>
            </ul>
            <div className="border-t border-beige-dark/15 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3" data-mobile-menu-language>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-coffee/55">{t("nav.language")}</p>
              <LanguageSwitcher compact />
            </div>
          </motion.nav>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
