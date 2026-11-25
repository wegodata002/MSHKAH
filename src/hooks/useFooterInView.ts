"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** Phones/tablets: the fixed bottom bar covers this much of the screen (see --mobile-bottom-nav-height). */
const MOBILE_BOTTOM_NAV_PX = 64;
const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * True while the site footer ([data-site-footer]) is on screen after the customer scrolled down.
 * The floating buttons (assistant, accessibility, checkout) fade out then, so they never cover the
 * footer's text, and come back when the customer scrolls up. At the top of the page (scrollY 0) they
 * always show: on a short page (empty cart, empty favourites) the footer is on screen from the start,
 * and the assistant must still be reachable there. Phones/tablets: the part of the footer behind the
 * bottom bar does not count.
 */
export function useFooterInView(): boolean {
  const pathname = usePathname();
  const [inView, setInView] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 0);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [pathname]);

  useEffect(() => {
    const footer = document.querySelector<HTMLElement>("[data-site-footer]");
    if (!footer || typeof IntersectionObserver === "undefined") {
      setInView(false);
      return;
    }

    const media = window.matchMedia(DESKTOP_QUERY);
    let observer: IntersectionObserver | null = null;

    const observe = () => {
      observer?.disconnect();
      const bottomInset = media.matches ? 0 : MOBILE_BOTTOM_NAV_PX;
      observer = new IntersectionObserver(
        ([entry]) => setInView(entry?.isIntersecting ?? false),
        { rootMargin: `0px 0px -${bottomInset}px 0px`, threshold: 0 }
      );
      observer.observe(footer);
    };

    observe();
    media.addEventListener("change", observe);
    return () => {
      media.removeEventListener("change", observe);
      observer?.disconnect();
    };
  }, [pathname]);

  return inView && scrolled;
}
