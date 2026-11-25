"use client";

import Link from "next/link";
import { Phone, MapPin, MessageCircle, Clock } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { useSettings } from "@/hooks/useSettings";
import { useFloatingButtonsFooter } from "@/hooks/useFooterInView";
import { BRAND } from "@/lib/brand";
import { openingHoursText } from "@/lib/settings/opening-hours";
import { whatsappUrl } from "@/lib/assistant/fulfillment-answers";

export function SiteFooter() {
  const t = useT();
  const { locale } = useLocale();
  const { settings } = useSettings();
  const { shortPage } = useFloatingButtonsFooter();

  const phone = settings?.phone ?? "";
  const address = settings?.address ?? "";
  const hours = openingHoursText(settings, locale);
  // Only when a WhatsApp number is entered in the settings; "0587887090" opens wa.me/972587887090.
  const whatsappHref = whatsappUrl(settings?.social?.whatsapp);
  const mapsUrl = settings?.mapsUrl ?? "";

  return (
    // Compact; reaches the very bottom of the page (it takes over the space kept under the page for
    // the phone's bottom bar, see globals.css "data-site-footer").
    <footer className="mt-auto border-t border-beige-dark/15 bg-warm-white" data-site-footer>
      <div className="mx-auto max-w-[1400px] px-4 pb-3 pt-6 md:px-8 lg:px-10 lg:pt-8">
        {/* Phone: hours | links side by side, then contact, then the logo line. */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4 lg:gap-8">
          {/* Hours */}
          <div>
            <h3 className="text-caption mb-2 uppercase tracking-wider">{t("footer.hours")}</h3>
            {hours ? (
              <p className="text-body whitespace-pre-line">{hours}</p>
            ) : (
              <p className="text-body text-coffee/40">—</p>
            )}
          </div>

          {/* Contact */}
          <div className="order-3 col-span-2 lg:order-none lg:col-span-1">
            <h3 className="text-caption mb-2 uppercase tracking-wider">{t("footer.contact")}</h3>
            <ul className="space-y-1.5">
              {phone && (
                <li>
                  <a
                    href={`tel:${phone.replace(/\s/g, "")}`}
                    className="text-body flex items-center gap-2 hover:text-turquoise"
                  >
                    <Phone className="h-3.5 w-3.5 text-turquoise" strokeWidth={1.75} />
                    {phone}
                  </a>
                </li>
              )}
              {address && (
                <li>
                  {mapsUrl ? (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-body flex items-start gap-2 hover:text-turquoise"
                    >
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-turquoise" strokeWidth={1.75} />
                      {address}
                    </a>
                  ) : (
                    <span className="text-body flex items-start gap-2">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-turquoise" strokeWidth={1.75} />
                      {address}
                    </span>
                  )}
                </li>
              )}
              {whatsappHref && (
                <li>
                  <a
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-body flex items-center gap-2 hover:text-turquoise"
                  >
                    <MessageCircle className="h-3.5 w-3.5 text-turquoise" strokeWidth={1.75} />
                    {t("footer.whatsappChat")}
                  </a>
                </li>
              )}
            </ul>
          </div>

          {/* Info */}
          <div className="order-2 lg:order-none">
            <h3 className="text-caption mb-2 uppercase tracking-wider">{t("footer.moreInfo")}</h3>
            <ul className="space-y-1.5">
              {[
                { href: "/account", label: t("footer.faq") },
                { href: "#a11y-panel", label: t("footer.accessibility") },
                { href: "/account", label: t("footer.terms") },
                { href: "/account", label: t("footer.privacy") },
              ].map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-body hover:text-turquoise">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Logo */}
          <div className="order-4 col-span-2 flex items-center gap-3 lg:order-none lg:col-span-1 lg:flex-col lg:items-start lg:gap-3">
            <Logo size="md" href="/" priority className="h-9 w-auto shrink-0 lg:h-11" />
            <p className="text-caption max-w-xs text-xs leading-relaxed">{t("footer.about")}</p>
          </div>
        </div>

        <div className="mt-5 text-center sm:text-start">
          <p className="text-caption">
            © {new Date().getFullYear()} {settings?.storeName ?? BRAND.name}. {t("footer.rights")}
          </p>
        </div>
        {/* Short page (no scrolling): the floating buttons stay, so keep room for them under the text.
            76px clears them: phones/tablets 12+56px above the bottom bar, desktop 24+56px minus pb-3. */}
        {shortPage && <div data-fab-spacer aria-hidden className="h-[4.75rem]" />}
      </div>
    </footer>
  );
}
