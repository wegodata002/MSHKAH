"use client";

import { useEffect, useRef } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/locale-provider";
import { ADMIN_SIDEBAR_WIDTH_PX } from "../admin-layout-config";

/**
 * Warns before leaving an admin page with unsaved changes:
 * - closing / reloading the tab (beforeunload)
 * - following an in-app link such as the admin sidebar (capture-phase click on
 *   document runs before Next.js <Link> handles the click).
 */
export function useUnsavedChangesGuard(dirty: boolean, message?: string) {
  const t = useT();
  const confirmText = message ?? t("admin.unsaved.leaveConfirm");

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      if (!window.confirm(confirmText)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty, confirmText]);
}

/**
 * Fixed save bar shown while there are unsaved changes. On mobile it sits above the admin
 * bottom nav; on desktop it is offset by the sidebar width (padding-inline-start).
 * Renders a spacer so the bar never covers the end of the page.
 */
export function UnsavedChangesBar({
  visible,
  saving,
  onSave,
  onDiscard,
  label,
  saveLabel,
}: {
  visible: boolean;
  saving: boolean;
  onSave: () => void;
  /** Optional "discard changes" button. */
  onDiscard?: () => void;
  label?: string;
  saveLabel?: string;
}) {
  const t = useT();
  const barRef = useRef<HTMLDivElement>(null);
  // The accessibility button sits just above this bar while it is shown (accessibility.css):
  // publish the distance from the bottom of the screen to the top of the bar.
  useEffect(() => {
    const el = barRef.current;
    if (!visible || !el) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--admin-unsaved-top", `${Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top))}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty("--admin-unsaved-top");
    };
  }, [visible]);
  if (!visible) return null;

  return (
    <>
      <div aria-hidden className="h-28 lg:h-20" />
      <div
        data-unsaved-bar
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--mobile-bottom-nav-height)+env(safe-area-inset-bottom,0px)+0.5rem)] z-[95] px-4 lg:bottom-4 lg:pe-6 lg:ps-[calc(var(--admin-sidebar-w)+1.5rem)] print:hidden"
        style={{ "--admin-sidebar-w": `${ADMIN_SIDEBAR_WIDTH_PX}px` } as React.CSSProperties}
      >
        <div
          ref={barRef}
          role="status"
          className="pointer-events-auto mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-warm-white px-4 py-3 shadow-elevated dark:border-amber-500/40 dark:bg-[#1a1412]"
        >
          <span className="inline-flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
            <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
            {label ?? t("admin.unsaved.message")}
          </span>
          <div className="flex shrink-0 items-center gap-2">
            {onDiscard ? (
              <Button variant="ghost" onClick={onDiscard} disabled={saving}>
                <RotateCcw className="h-4 w-4" />
                {t("admin.unsaved.discard")}
              </Button>
            ) : null}
            <Button onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? t("admin.productForm.saving") : (saveLabel ?? t("admin.unsaved.save"))}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
