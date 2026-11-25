import { getPublicStoreOrigin } from "@/lib/domains/host-routing";

export type AdminQrLinkId = "menu" | "order" | "club";

export type AdminQrLink = {
  id: AdminQrLinkId;
  nameKey: string;
  url: string;
  filename: string;
};

function normalizePublicUrl(raw: string, fallback: string): string {
  const value = raw.trim();
  if (!value) return fallback.replace(/\/+$/, "");
  try {
    const parsed = new URL(value.includes("://") ? value : `https://${value}`);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fallback.replace(/\/+$/, "");
    }
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${path}`;
  } catch {
    return fallback.replace(/\/+$/, "");
  }
}

function readQrLink(envName: string, fallback: string): string {
  return normalizePublicUrl(process.env[envName] ?? "", fallback);
}

/** Single source for Admin QR cards. Override the store link with NEXT_PUBLIC_QR_LINK_2 (menu = /catalog, club = /club). */
export function getAdminQrLinks(): AdminQrLink[] {
  return [
    {
      id: "menu",
      nameKey: "admin.qr.menuName",
      // The storefront's one-page menu (all categories, category bar follows the scroll) — not the
      // view-only menu.mishkatcafe.dev. Follows the store link like the club QR; NEXT_PUBLIC_QR_LINK_1
      // is no longer read, so an old value pointing at the menu domain cannot override it.
      url: `${readQrLink("NEXT_PUBLIC_QR_LINK_2", getPublicStoreOrigin())}/catalog`,
      filename: "mishkah-qr-menu.png",
    },
    {
      id: "order",
      nameKey: "admin.qr.orderName",
      url: readQrLink("NEXT_PUBLIC_QR_LINK_2", getPublicStoreOrigin()),
      filename: "mishkah-qr-order.png",
    },
    {
      // Hang by the counter: customers scan it and join the club.
      id: "club",
      nameKey: "admin.qr.clubName",
      url: `${readQrLink("NEXT_PUBLIC_QR_LINK_2", getPublicStoreOrigin())}/club`,
      filename: "mishkah-qr-club.png",
    },
  ];
}

export const ADMIN_QR_PREVIEW_PX = 360;
export const ADMIN_QR_DOWNLOAD_PX = 2048;
export const ADMIN_QR_COLORS = { dark: "#1A1410", light: "#FFFFFF" } as const;
