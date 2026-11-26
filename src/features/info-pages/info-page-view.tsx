"use client";

import Link from "next/link";
import { Accessibility, Clock, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { useAccessibility } from "@/components/providers/accessibility-provider";
import { useInfoPages } from "@/hooks/useInfoPages";
import { useSettings } from "@/hooks/useSettings";
import { useFulfillmentAvailability } from "@/features/checkout/use-fulfillment-availability";
import { publishedText, textBlocks, type InfoPageId, type TextBlock } from "@/lib/info-pages/content";
import { openingHoursText } from "@/lib/settings/opening-hours";
import { zoneName } from "@/lib/fulfillment/settings";
import { formatPrice } from "@/lib/utils";

const card = "rounded-2xl bg-warm-white p-5 shadow-soft dark:bg-white/5 md:p-6";

function Blocks({ blocks }: { blocks: TextBlock[] }) {
  return (
    <>
      {blocks.map((block, index) =>
        block.kind === "heading" ? (
          <h2 key={index} className="mt-6 font-display text-xl font-bold text-dark-brown first:mt-0 dark:text-warm-white">
            {block.text}
          </h2>
        ) : block.kind === "list" ? (
          <ul key={index} className="mt-3 list-disc space-y-1.5 ps-5 leading-relaxed text-coffee/85 dark:text-warm-white/85">
            {block.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={index} className="mt-3 whitespace-pre-line leading-relaxed text-coffee/85 first:mt-0 dark:text-warm-white/85">
            {block.text}
          </p>
        )
      )}
    </>
  );
}

/** FAQ: opening hours and delivery areas straight from the settings, so they are never out of date. */
function LiveFacts() {
  const t = useT();
  const { locale } = useLocale();
  const { settings } = useSettings();
  const availability = useFulfillmentAvailability();
  const hours = openingHoursText(settings, locale);
  return (
    <div className="grid gap-4 md:grid-cols-2" data-info-live>
      <div className={card}>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Clock className="h-4 w-4 text-turquoise" strokeWidth={1.75} /> {t("footer.hours")}
        </h2>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-coffee/80 dark:text-warm-white/80">{hours || "—"}</p>
      </div>
      <div className={card}>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MapPin className="h-4 w-4 text-turquoise" strokeWidth={1.75} /> {t("info.deliveryAreas")}
        </h2>
        {availability.loading ? (
          <Loader2 className="mt-3 h-4 w-4 animate-spin text-turquoise" />
        ) : availability.zones.length ? (
          <ul className="mt-3 space-y-1.5 text-sm text-coffee/80 dark:text-warm-white/80">
            {availability.zones.map((zone) => (
              <li key={zone.id} className="flex flex-wrap justify-between gap-x-3">
                <span className="font-semibold">{zoneName(zone, locale)}</span>
                <span>
                  {t("info.deliveryFee").replace("{fee}", formatPrice(zone.fee))}
                  {zone.minOrder > 0 ? ` · ${t("info.minOrder").replace("{min}", formatPrice(zone.minOrder))}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-coffee/70">{t("info.noDelivery")}</p>
        )}
      </div>
    </div>
  );
}

/** One of the footer's "More info" pages, as published from the admin. */
export function InfoPageView({ id }: { id: InfoPageId }) {
  const t = useT();
  const { locale } = useLocale();
  const { pages, loading } = useInfoPages();
  const { setPanelOpen } = useAccessibility();
  const page = pages?.[id];
  const shown = page ? publishedText(id, page, locale) : null;
  // A language left empty shows the Hebrew text, written right to left.
  const dir = shown && shown.lang !== locale ? { dir: "rtl" as const, lang: shown.lang } : {};

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 pb-36 md:px-6 md:pt-10 lg:pb-28" data-info-page={id}>
      <h1 className="font-display text-3xl font-bold text-dark-brown dark:text-warm-white">{t(`info.${id}.title`)}</h1>

      {id === "accessibility" && (
        <Button type="button" variant="turquoise" className="mt-4 rounded-full" onClick={() => setPanelOpen(true)} data-open-a11y>
          <Accessibility className="me-2 h-4 w-4" strokeWidth={1.75} />
          {t("info.openA11yMenu")}
        </Button>
      )}

      {loading ? (
        <div className="mt-10 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-turquoise" aria-label={t("common.loading", "Loading")} />
        </div>
      ) : !shown ? (
        <div className={`${card} mt-6`} data-info-unpublished>
          <p className="text-coffee/80">{t("info.notPublished")}</p>
          <Button asChild variant="outline" className="mt-4 rounded-full">
            <Link href="/">{t("info.backHome")}</Link>
          </Button>
        </div>
      ) : id === "faq" ? (
        <div className="mt-6 space-y-4">
          <LiveFacts />
          <div className="space-y-3" {...dir}>
            {shown.text.items
              .filter((item) => item.q.trim() && item.a.trim())
              .map((item, index) => (
                <details key={index} className={`${card} group`} data-faq-item>
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold text-dark-brown dark:text-warm-white">
                    {item.q}
                    <span aria-hidden className="text-turquoise transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <div className="mt-3">
                    <Blocks blocks={textBlocks(item.a)} />
                  </div>
                </details>
              ))}
          </div>
        </div>
      ) : (
        <article className={`${card} mt-6`} {...dir} data-info-body>
          <Blocks blocks={textBlocks(shown.text.body)} />
        </article>
      )}
    </div>
  );
}
