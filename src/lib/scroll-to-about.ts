"use client";

/**
 * "About": the white footer at the end of every page (hours, contact, info links). Scrolls to it on
 * the current page and briefly highlights it. Returns false when the page has no footer.
 */
export function scrollToAbout(): boolean {
  const footer = document.querySelector<HTMLElement>("[data-site-footer]");
  if (!footer) return false;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  footer.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  // A long page may still be loading images while it scrolls, which pushes the footer down: once the
  // smooth scroll is over, finish the way if the footer is not on screen yet.
  window.setTimeout(() => {
    const r = footer.getBoundingClientRect();
    if (r.top >= window.innerHeight || r.bottom <= 0) footer.scrollIntoView({ behavior: "auto", block: "start" });
  }, 900);
  footer.setAttribute("data-about-flash", "");
  window.setTimeout(() => footer.removeAttribute("data-about-flash"), 1800);
  return true;
}
