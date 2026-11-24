"use client";

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/** The club's gradient hero card (join page and member page). */
export function ClubHero({ badge, children, className }: { badge: string; children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[28px] p-6 text-white shadow-[0_18px_40px_rgba(61,43,36,0.25)]",
        "bg-[radial-gradient(120%_140%_at_100%_0%,#0c8c92_0%,#1d5b5d_35%,#3D2B24_75%)]",
        className
      )}
    >
      <span aria-hidden className="pointer-events-none absolute -bottom-20 -end-14 h-56 w-56 rounded-full bg-white/[0.07]" />
      <span className="relative inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
        <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
        {badge}
      </span>
      <div className="relative">{children}</div>
    </section>
  );
}

/** A benefit tile inside the hero. */
export function ClubPerk({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl bg-white/12 p-3 backdrop-blur-sm" data-club-perk>
      <p className="text-lg font-extrabold leading-tight">{title}</p>
      <p className="mt-0.5 text-xs opacity-85">{body}</p>
    </div>
  );
}

/** White card used for forms and sections. */
export function ClubCard({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-3xl bg-warm-white p-5 shadow-soft md:p-6", className)}>{children}</section>;
}

/** "₪100" without trailing zeros, for the "every ₪X = 1 point" line. */
export function formatIlsShort(minor: number): string {
  const ils = minor / 100;
  return `₪${Number.isInteger(ils) ? ils : ils.toFixed(2)}`;
}
