"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { getCategoryDisplayName } from "@/lib/i18n/localized-content";
import type { Category } from "@/types";

interface CategoryNavProps {
  categories: Category[];
  activeId: string | null;
  onSelect: (categoryId: string) => void;
  /** Mobile-only controls at the end of the row (search / filter / sort icons). */
  trailing?: ReactNode;
}

/**
 * Sticky category row for the single-page catalog.
 * - Mobile (< md): one horizontally scrolling row; the active chip is scrolled into view
 *   (only the row scrolls, never the page) and an edge fade shows there is more.
 * - Desktop (md+): all categories visible, wrapping onto extra lines if needed.
 */
export function CategoryNav({ categories, activeId, onSelect, trailing }: CategoryNavProps) {
  const { locale } = useLocale();
  const t = useT();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ start: false, end: false });

  // scrollLeft is 0..max in LTR and 0..-max in RTL; Math.abs works for both.
  const updateFade = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft);
    setFade((prev) => {
      const next = { start: pos > 2, end: max - pos > 2 };
      return prev.start === next.start && prev.end === next.end ? prev : next;
    });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateFade();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateFade, categories.length]);

  // Keep the active chip centred in the row (mobile). Uses scrollBy on the row only.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !activeId || el.scrollWidth <= el.clientWidth) return;
    const chip = el.querySelector<HTMLElement>(`[data-nav-id="${CSS.escape(activeId)}"]`);
    if (!chip) return;
    const c = chip.getBoundingClientRect();
    const s = el.getBoundingClientRect();
    const delta = c.left + c.width / 2 - (s.left + s.width / 2);
    if (Math.abs(delta) > 1) el.scrollBy({ left: delta, behavior: "smooth" });
  }, [activeId]);

  return (
    <div className="flex items-center gap-2">
      <nav aria-label={t("nav.catalog")} className="relative min-w-0 flex-1">
        <div
          ref={scrollerRef}
          onScroll={updateFade}
          className="hide-scrollbar flex gap-2 overflow-x-auto py-1 md:flex-wrap md:overflow-visible"
        >
          {categories.map((category) => {
            const active = category.id === activeId;
            return (
              <button
                key={category.id}
                type="button"
                data-nav-id={category.id}
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(category.id)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "border-turquoise bg-turquoise text-warm-white"
                    : "border-beige-dark/30 bg-warm-white text-coffee hover:border-turquoise/40"
                )}
              >
                {getCategoryDisplayName(category, locale).trim()}
              </button>
            );
          })}
        </div>
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 start-0 w-8 bg-gradient-to-r from-cream to-transparent transition-opacity rtl:bg-gradient-to-l md:hidden",
            fade.start ? "opacity-100" : "opacity-0"
          )}
        />
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-0 end-0 w-8 bg-gradient-to-l from-cream to-transparent transition-opacity rtl:bg-gradient-to-r md:hidden",
            fade.end ? "opacity-100" : "opacity-0"
          )}
        />
      </nav>
      {trailing}
    </div>
  );
}
