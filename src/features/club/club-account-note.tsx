"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";

/**
 * "My orders" / "Favourites": for a signed-in club member, a short line saying the list comes from
 * the account (every device); for anyone else, an invitation to join the club. Text starts at the
 * reading side (right in Hebrew and Arabic, left in English) — the page direction follows the language.
 */
export function ClubAccountLine({ textKey, className }: { textKey: string; className?: string }) {
  const t = useT();
  return (
    <p className={cn("flex items-center gap-1.5 text-start text-sm font-medium text-turquoise", className)} data-club-account-line>
      <Sparkles className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {t(textKey)}
    </p>
  );
}

export function ClubInvite({ className }: { className?: string }) {
  const t = useT();
  return (
    <div
      className={cn("flex flex-col gap-3 rounded-2xl border border-turquoise/25 bg-turquoise/5 p-4 text-start sm:flex-row sm:items-center sm:justify-between", className)}
      data-club-invite
    >
      <p className="flex items-start gap-2 text-sm text-dark-brown dark:text-warm-white">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-turquoise" strokeWidth={1.75} aria-hidden />
        <span>{t("clubInvite.text")}</span>
      </p>
      <Link
        href="/club"
        className="inline-flex h-10 shrink-0 items-center justify-center self-start rounded-full bg-turquoise px-5 text-sm font-semibold text-warm-white transition-colors hover:bg-turquoise/90 sm:self-auto"
        data-club-invite-join
      >
        {t("clubInvite.join")}
      </Link>
    </div>
  );
}
