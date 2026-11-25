"use client";

import { motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { usePathname } from "next/navigation";
import { useAssistant } from "@/features/assistant/assistant-context";
import { useT } from "@/components/providers/locale-provider";
import { useFooterInView } from "@/hooks/useFooterInView";
import { cn } from "@/lib/utils";

export function AssistantFab() {
  const t = useT();
  const pathname = usePathname();
  const { toggle, isOpen, enabled } = useAssistant();
  const footerInView = useFooterInView();

  // Shown on every customer page, cart and checkout included.
  if (pathname.startsWith("/admin") || !enabled) return null;

  // Cart / checkout (phones, tablets): smaller and tucked into the corner, away from the form fields.
  const compact = pathname.startsWith("/cart") || pathname.startsWith("/checkout");

  return (
    <motion.button
      type="button"
      onClick={toggle}
      aria-expanded={isOpen}
      aria-controls="assistant-drawer"
      aria-label={t("assistant.open")}
      // Fades out while the site footer is on screen, so it never covers the footer's text.
      aria-hidden={footerInView || undefined}
      tabIndex={footerInView ? -1 : undefined}
      className={cn(
        "fixed z-[60] flex h-14 w-14 items-center justify-center rounded-full",
        "bg-gradient-to-br from-turquoise to-turquoise-light text-warm-white",
        "shadow-premium border border-white/25",
        // Bottom row, end corner; the checkout button takes the start corner of the same row.
        "bottom-[calc(var(--mobile-bottom-nav-height)+env(safe-area-inset-bottom,0px)+0.75rem)] end-4 lg:bottom-6 lg:end-6",
        compact && "max-lg:h-11 max-lg:w-11",
        "transition-transform hover:scale-105 active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-turquoise focus-visible:ring-offset-2",
        isOpen && "scale-90 opacity-80",
        footerInView && "pointer-events-none"
      )}
      whileTap={{ scale: 0.92 }}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{
        opacity: footerInView ? 0 : 1,
        scale: footerInView ? 0.8 : isOpen ? 0.9 : 1,
      }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      <MessageSquare className={cn("h-6 w-6", compact && "max-lg:h-5 max-lg:w-5")} strokeWidth={1.75} />
    </motion.button>
  );
}
