"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Phones/tablets: the fixed bottom bar covers this much of the screen (see --mobile-bottom-nav-height). */
const MOBILE_BOTTOM_NAV_PX = 64;
const DESKTOP_QUERY = "(min-width: 1024px)";

export type FloatingButtonsFooterState = {
  /** The whole page (footer included) fits on screen without scrolling. */
  shortPage: boolean;
  /** Fade the floating buttons out now. */
  hide: boolean;
};

const INITIAL: FloatingButtonsFooterState = { shortPage: false, hide: false };

/**
 * How the floating buttons (assistant, accessibility, checkout) and the site footer share the bottom
 * of the screen, on every page with the footer:
 * - A page that scrolls: the buttons stay visible while scrolling and fade out only once the customer
 *   scrolled down and the footer is on screen (the end of the page); they come back as soon as the
 *   footer leaves the screen. Phones/tablets: the part of the footer behind the bottom bar does not count.
 * - A short page (everything, footer included, fits without scrolling): the buttons never hide; the
 *   footer adds room at its end instead ([data-fab-spacer], see SiteFooter). The footer sits at the
 *   bottom of the screen on such a page, so that room lifts its text above the buttons.
 * "Short" is measured without that room, so adding it never flips the decision.
 */
export function useFloatingButtonsFooter(): FloatingButtonsFooterState {
  const pathname = usePathname();
  const [state, setState] = useState<FloatingButtonsFooterState>(INITIAL);

  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    let frame = 0;

    const measure = () => {
      frame = 0;
      const footer = document.querySelector<HTMLElement>("[data-site-footer]");
      if (!footer) {
        setState((prev) => (prev.shortPage || prev.hide ? INITIAL : prev));
        return;
      }
      const spacer = footer.querySelector<HTMLElement>("[data-fab-spacer]");
      const naturalHeight = document.documentElement.scrollHeight - (spacer?.offsetHeight ?? 0);
      const shortPage = naturalHeight <= window.innerHeight + 1;
      const rect = footer.getBoundingClientRect();
      const bottomInset = media.matches ? 0 : MOBILE_BOTTOM_NAV_PX;
      const footerOnScreen = rect.top < window.innerHeight - bottomInset && rect.bottom > 0;
      const hide = !shortPage && footerOnScreen && window.scrollY > 0;
      setState((prev) => (prev.shortPage === shortPage && prev.hide === hide ? prev : { shortPage, hide }));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    media.addEventListener("change", schedule);
    // Content that loads later (products, images) changes the page height.
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    resizeObserver?.observe(document.body);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      media.removeEventListener("change", schedule);
      resizeObserver?.disconnect();
    };
  }, [pathname]);

  return state;
}

/** True while the floating buttons should fade out (see useFloatingButtonsFooter). */
export function useFooterInView(): boolean {
  return useFloatingButtonsFooter().hide;
}
