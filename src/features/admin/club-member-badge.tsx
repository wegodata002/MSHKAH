"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import type { CustomerMemberLink } from "@/lib/loyalty/admin/customer-links";

/**
 * Shared member badge. Combines colour **and** text ("חבר מועדון") so the
 * tag is visible to colour-blind viewers per the loyalty-club spec.
 */
export function ClubMemberBadge({ compact }: { compact?: boolean }) {
  const t = useT();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-turquoise/30 bg-turquoise/10 font-medium text-turquoise ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      }`}
      aria-label={t("club.badge.label")}
    >
      <Sparkles className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {t("club.badge.label")}
    </span>
  );
}

/**
 * Admin → Customers: the badge as a link to Club → Members with this member's details open.
 * A suspended member says so. `withDetails`: also "Member details" (the customer's profile window).
 */
export function ClubMemberBadgeLink({ link, href, compact, withDetails }: { link: CustomerMemberLink; href: string; compact?: boolean; withDetails?: boolean }) {
  const t = useT();
  const { dir } = useLocale();
  const Arrow = dir === "rtl" ? ChevronLeft : ChevronRight;
  return (
    <Link
      href={href}
      className={`inline-flex w-fit items-center gap-1 rounded-full border border-turquoise/30 bg-turquoise/10 font-medium text-turquoise hover:bg-turquoise/20 ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      }`}
      title={t("admin.customers.memberDetails")}
      data-customer-member={link.memberId}
      data-customer-member-status={link.status}
    >
      <Sparkles className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {t("club.badge.label")}
      {link.status === "suspended" ? <span className="text-coffee/60">· {t("admin.clubMembers.status.suspended")}</span> : null}
      {withDetails ? <span className="ms-1 font-semibold">{t("admin.customers.memberDetails")}</span> : null}
      <Arrow className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
    </Link>
  );
}
