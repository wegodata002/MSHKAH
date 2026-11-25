import { describe, expect, it } from "vitest";
import { getAdminQrLinks } from "@/lib/admin-qr-links";
import { createQrPngDataUrl } from "@/lib/admin-qr-image";

describe("admin QR links", () => {
  it("exposes the public links (menu, join the club) and the staff sign-in links from a single config", () => {
    const links = getAdminQrLinks();
    expect(links.map((l) => l.id)).toEqual(["menu", "club", "couriers", "waiters"]);
    const [menu, club, couriers, waiters] = links;
    expect(couriers?.url).toBe(menu?.url.replace(/\/catalog$/, "/staff?for=courier"));
    expect(waiters?.url).toBe(menu?.url.replace(/\/catalog$/, "/staff?for=waiter"));
    expect(couriers?.nameKey).toBe("admin.qr.couriersName");
    expect(waiters?.nameKey).toBe("admin.qr.waitersName");
    expect(menu?.nameKey).toBe("admin.qr.menuPageName");
    expect(menu?.filename).toBe("mishkah-qr-menu.png");
    expect(club?.filename).toBe("mishkah-qr-club.png");
    // Menu QR → the storefront's one-page menu, never the view-only menu domain.
    expect(menu?.url).toMatch(/^https:\/\/[^/]+\/catalog$/);
    expect(menu?.url).not.toMatch(/\/\/menu\./);
    expect(club?.url).toBe(menu?.url.replace(/\/catalog$/, "/club"));
  });

  it("builds a PNG from the live URL", async () => {
    const [menu] = getAdminQrLinks();
    const png = await createQrPngDataUrl(menu!.url, 256);
    expect(png.startsWith("data:image/png;base64,")).toBe(true);
    expect(png.length).toBeGreaterThan(500);
  }, 15000);
});
