"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ClipboardList, Clock, CreditCard, Heart, Info, MapPin, MessageCircle, Navigation, Phone, Sparkles } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { useSettings } from "@/hooks/useSettings";
import { useFavorites } from "@/hooks/useFavorites";
import { hasClubHint } from "@/lib/loyalty/club-hint";
import { useActiveOrderCount } from "@/lib/orders/my-order-views";
import { openingHoursText } from "@/lib/settings/opening-hours";
import { whatsappUrl } from "@/lib/assistant/fulfillment-answers";
import { scrollToAbout } from "@/lib/scroll-to-about";
import { cn } from "@/lib/utils";

/**
 * The person icon in the header: the customer's own page — the club, "My orders", favourites, and how
 * to reach the cafe (same details as the footer, from the settings). No admin links here.
 */
export function AccountScreen() {
  const t = useT();
  const { locale } = useLocale();
  const { settings } = useSettings();
  const { count: favorites } = useFavorites();
  const activeOrders = useActiveOrderCount();
  const [clubMember, setClubMember] = useState(false);
  useEffect(() => setClubMember(hasClubHint()), []);

  const phone = settings?.phone ?? "";
  const address = settings?.address ?? "";
  const hours = openingHoursText(settings, locale);
  const whatsappHref = whatsappUrl(settings?.social?.whatsapp);
  const mapsUrl = settings?.mapsUrl ?? "";

  const tile = "flex items-center gap-3 rounded-2xl bg-warm-white p-4 shadow-soft transition-shadow hover:shadow-md";

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-6" data-account>
      <h1 className="font-display text-2xl font-bold text-dark-brown md:text-3xl">{t("account.title")}</h1>

      {/* Club */}
      <Link
        href={clubMember ? "/club/me" : "/club"}
        className="flex items-center gap-3 rounded-2xl bg-turquoise p-4 text-warm-white shadow-soft"
        data-account-club={clubMember ? "card" : "join"}
      >
        {clubMember ? <CreditCard className="h-6 w-6 shrink-0" strokeWidth={1.75} /> : <Sparkles className="h-6 w-6 shrink-0" strokeWidth={1.75} />}
        <span className="min-w-0 flex-1">
          <span className="block font-bold">{t(clubMember ? "nav.myCard" : "nav.joinClub")}</span>
          <span className="block text-xs text-warm-white/80">{t("account.club.hint")}</span>
        </span>
        <ChevronLeft className="h-4 w-4 shrink-0 ltr:rotate-180" />
      </Link>

      {/* My orders, favourites */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/orders" className={tile} data-account-link="orders">
          <ClipboardList className="h-5 w-5 shrink-0 text-turquoise" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 text-sm font-semibold text-dark-brown">{t("nav.orders")}</span>
          {activeOrders > 0 && <span className="rounded-full bg-turquoise px-1.5 text-[11px] font-bold text-warm-white">{activeOrders}</span>}
        </Link>
        <Link href="/favorites" className={tile} data-account-link="favorites">
          <Heart className="h-5 w-5 shrink-0 text-turquoise" strokeWidth={1.75} />
          <span className="min-w-0 flex-1 text-sm font-semibold text-dark-brown">{t("nav.favorites")}</span>
          {favorites > 0 && <span className="rounded-full bg-turquoise px-1.5 text-[11px] font-bold text-warm-white">{favorites}</span>}
        </Link>
      </div>

      {/* Contact */}
      <section id="contact" className="scroll-mt-20 space-y-3 rounded-2xl bg-warm-white p-4 shadow-soft" data-account-contact>
        <h2 className="font-display text-lg font-bold text-dark-brown">{t("footer.contact")}</h2>
        {phone && (
          <a href={`tel:${phone.replace(/\s/g, "")}`} className="flex items-center gap-2.5 text-sm text-dark-brown hover:text-turquoise" data-account-phone>
            <Phone className="h-4 w-4 shrink-0 text-turquoise" strokeWidth={1.75} />
            <bdi dir="ltr" className="font-semibold">
              {phone}
            </bdi>
          </a>
        )}
        {address && (
          <p className="flex items-start gap-2.5 text-sm text-dark-brown">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-turquoise" strokeWidth={1.75} />
            <span>{address}</span>
          </p>
        )}
        {(whatsappHref || mapsUrl) && (
          <div className={cn("grid gap-2", whatsappHref && mapsUrl ? "grid-cols-2" : "grid-cols-1")}>
            {whatsappHref && (
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-xl bg-turquoise text-sm font-bold text-warm-white" data-account-whatsapp>
                <MessageCircle className="h-4 w-4" strokeWidth={1.75} />
                {t("footer.whatsappChat")}
              </a>
            )}
            {mapsUrl && (
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-xl border border-turquoise/50 text-sm font-bold text-turquoise" data-account-maps>
                <Navigation className="h-4 w-4" strokeWidth={1.75} />
                {t("account.navigate")}
              </a>
            )}
          </div>
        )}
        {hours && (
          <div className="flex items-start gap-2.5 border-t border-beige-dark/15 pt-3 text-sm text-coffee/75">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-turquoise" strokeWidth={1.75} />
            <p className="whitespace-pre-line" data-account-hours>
              {hours}
            </p>
          </div>
        )}
      </section>

      {/* About: the footer of this page. */}
      <button type="button" onClick={() => scrollToAbout()} className={cn(tile, "w-full text-start")} data-account-about>
        <Info className="h-5 w-5 shrink-0 text-turquoise" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 text-sm font-semibold text-dark-brown">{t("nav.about")}</span>
        <ChevronLeft className="h-4 w-4 shrink-0 text-coffee/35 ltr:rotate-180" />
      </button>
    </div>
  );
}
