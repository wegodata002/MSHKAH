"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/providers/locale-provider";
import { ClubCard } from "@/features/club/club-ui";
import type { LoyaltyMeResponse } from "@/lib/loyalty/types";

/**
 * Where the member QR (/club/card?c=…) leads when scanned with a phone.
 *
 * The card id in the link is NEVER used here: this page shows no member details at all.
 * Someone logged in to the club goes to their OWN card (/club/me), whoever's QR they scanned;
 * someone not logged in is asked to log in first. Only the staff screen reads the link (on the server).
 */
export default function ClubCardLinkPage() {
  const t = useT();
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/club/me")
      .then((response) => response.json() as Promise<LoyaltyMeResponse>)
      .then((data) => {
        if (!active) return;
        if (data.member?.status === "active" || data.member?.status === "suspended") {
          router.replace("/club/me");
          return;
        }
        setChecked(true);
      })
      .catch(() => {
        if (active) setChecked(true);
      });
    return () => {
      active = false;
    };
  }, [router]);

  return (
    <>
      <PageHeader />
      {!checked ? (
        <div className="flex min-h-[60vh] items-center justify-center" data-club-checking>
          <Loader2 className="h-6 w-6 animate-spin text-coffee/60" />
        </div>
      ) : (
        <div className="mx-auto flex max-w-md flex-col gap-5 px-4 py-10 md:px-6" data-club-card-landing>
          <ClubCard className="text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-turquoise/10 text-turquoise">
              <CreditCard className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <h1 className="mt-3 font-display text-2xl font-bold text-dark-brown">{t("club2.card.title")}</h1>
            <p className="mt-2 text-sm text-coffee/70">{t("club2.card.body")}</p>
            <Link href="/club" className="mt-5 block">
              <Button variant="turquoise" size="lg" className="h-12 w-full text-base">
                {t("club2.card.login")}
              </Button>
            </Link>
          </ClubCard>
        </div>
      )}
    </>
  );
}
