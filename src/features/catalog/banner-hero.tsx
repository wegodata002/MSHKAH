"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import { normalizeImageUrl } from "@/lib/menu/placeholders";
import { bannerText } from "@/lib/banners/display";
import type { BannerSlide } from "@/types";

function bannerHref(banner: BannerSlide): string {
  if (banner.ctaAction === "product" && banner.ctaTargetId) {
    return `/catalog?product=${encodeURIComponent(banner.ctaTargetId)}`;
  }
  if (banner.ctaAction === "category" && banner.ctaTargetId) {
    return `/catalog?category=${encodeURIComponent(banner.ctaTargetId)}`;
  }
  return banner.ctaUrl || "/catalog";
}

/**
 * A home banner. The picture is always whole (never cropped) and never has text on it:
 * - desktop/tablet: title, subtitle and button in a column at the start side, on the blurred
 *   copy of the picture; the picture fills the rest;
 * - phone: the picture on top, a short strip under it with the text and the button.
 * A banner without a title in the current language shows the picture and the button only.
 * `children` (the carousel dots) are drawn at the bottom of the picture.
 */
export function BannerHero({
  banner,
  device = "desktop",
  interactive = true,
  className,
  children,
}: {
  banner: BannerSlide;
  device?: "desktop" | "mobile";
  interactive?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const content = bannerText(banner, locale);
  const mobile = device === "mobile";
  const rawImage = mobile ? banner.mobileImage || banner.image : banner.image;
  let image = normalizeImageUrl(rawImage) || "/meskahphoto.png";
  if (image === "/store.jpg") image = "/meskahphoto.png";
  const x = mobile ? banner.mobilePositionX : banner.desktopPositionX;
  const y = mobile ? banner.mobilePositionY : banner.desktopPositionY;
  const showButton = banner.ctaAction !== "none";
  const buttonLabel = content.button || t("hero.orderNow");
  const hasText = Boolean(content.title);
  const sizes = mobile ? "390px" : "(max-width: 1024px) 100vw, 1400px";
  const remote = image.includes("firebasestorage");

  const button = showButton ? (
    <Button
      asChild={interactive}
      variant="turquoise"
      size="sm"
      className={cn("shrink-0 rounded-full", mobile ? "h-9 px-3.5 text-xs" : "px-4")}
      data-banner-button
    >
      {interactive ? (
        <Link href={bannerHref(banner)}>
          {buttonLabel}
          <ArrowRight className="ms-1.5 h-3.5 w-3.5 rtl:rotate-180" />
        </Link>
      ) : (
        <span>
          {buttonLabel}
          <ArrowRight className="ms-1.5 inline h-3.5 w-3.5 rtl:rotate-180" />
        </span>
      )}
    </Button>
  ) : null;

  const picture = (
    <>
      <Image
        src={image}
        alt={content.title}
        fill
        unoptimized={remote}
        priority={!interactive}
        className="object-contain"
        style={{ objectPosition: `${x ?? 50}% ${y ?? 50}%` }}
        sizes={sizes}
        data-banner-image
      />
      {children}
    </>
  );

  return (
    <div className={cn("relative isolate overflow-hidden rounded-3xl bg-dark-brown text-warm-white shadow-soft", className)} data-banner>
      {/* Behind everything: the same picture, blurred, filling the margins (and the text area). */}
      <Image
        src={image}
        alt=""
        aria-hidden
        fill
        unoptimized={remote}
        priority={!interactive}
        className="-z-10 scale-110 object-cover opacity-80 blur-2xl"
        sizes={sizes}
        data-banner-backdrop
      />
      {/* One even tint over the whole blurred backdrop, so the text reads on it (no band edges). */}
      <div aria-hidden className="absolute inset-0 -z-10 bg-dark-brown/40" />
      {mobile ? (
        <>
          {/* Phone: about a quarter of the screen (150–220px) for the picture. */}
          <div className="relative h-[clamp(150px,25svh,220px)] w-full">{picture}</div>
          {hasText || button ? (
            <div className="flex items-center gap-3 bg-dark-brown/30 px-4 py-2.5" data-banner-text>
              {hasText ? (
                <div className="min-w-0 flex-1">
                  <h2 className="line-clamp-1 font-display text-base font-bold leading-snug">{content.title}</h2>
                  {content.subtitle ? <p className="line-clamp-1 text-xs text-warm-white/85">{content.subtitle}</p> : null}
                </div>
              ) : (
                <div className="flex-1" />
              )}
              {button}
            </div>
          ) : null}
        </>
      ) : (
        <div className="relative flex aspect-[14/5] max-h-[420px] w-full">
          {hasText || button ? (
            <div
              className="flex w-[32%] max-w-[380px] shrink-0 flex-col justify-center gap-2 p-5 lg:p-8"
              data-banner-text
            >
              {hasText ? (
                <>
                  <h2 className="line-clamp-3 font-display text-xl font-bold leading-tight lg:text-3xl">{content.title}</h2>
                  {content.subtitle ? (
                    <p className="line-clamp-3 text-sm leading-relaxed text-warm-white/90 lg:text-base">{content.subtitle}</p>
                  ) : null}
                </>
              ) : null}
              {button ? <div className="mt-2">{button}</div> : null}
            </div>
          ) : null}
          <div className="relative min-w-0 flex-1">{picture}</div>
        </div>
      )}
    </div>
  );
}
