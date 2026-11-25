import { getPublicStoreOrigin } from "@/lib/domains/host-routing";

export type AdminQrLinkId = "menu" | "club" | "couriers" | "waiters";

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

/**
 * Single source for Admin QR cards: "Menu", "Join the club", and the staff sign-in QRs "Couriers" / "Waiters". Override the store link with
 * NEXT_PUBLIC_QR_LINK_2 (menu = /catalog, club = /club). The old "Order" card (store home page) was
 * dropped: it opened the same menu; printed copies keep working since the home page stays.
 */
export function getAdminQrLinks(): AdminQrLink[] {
  const store = readQrLink("NEXT_PUBLIC_QR_LINK_2", getPublicStoreOrigin());
  return [
    {
      id: "menu",
      nameKey: "admin.qr.menuPageName",
      // The storefront's one-page menu (all categories, category bar follows the scroll) — not the
      // view-only menu.mishkatcafe.dev. NEXT_PUBLIC_QR_LINK_1 is no longer read, so an old value
      // pointing at the menu domain cannot override it.
      url: `${store}/catalog`,
      filename: "mishkah-qr-menu.png",
    },
    {
      // Hang by the counter: customers scan it and join the club.
      id: "club",
      nameKey: "admin.qr.clubName",
      url: `${store}/club`,
      filename: "mishkah-qr-club.png",
    },
    {
      // Staff only: opens the personal-code keypad; nothing is shown without a valid code.
      id: "couriers",
      nameKey: "admin.qr.couriersName",
      url: `${store}/staff?for=courier`,
      filename: "mishkah-qr-couriers.png",
    },
    {
      id: "waiters",
      nameKey: "admin.qr.waitersName",
      url: `${store}/staff?for=waiter`,
      filename: "mishkah-qr-waiters.png",
    },
  ];
}

export const ADMIN_QR_PREVIEW_PX = 360;
export const ADMIN_QR_DOWNLOAD_PX = 2048;
export const ADMIN_QR_COLORS = { dark: "#1A1410", light: "#FFFFFF" } as const;
