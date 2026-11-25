// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { countMyOrderTypes, filterMyOrderType, isActiveItem, splitMyOrders, type MyOrderItem } from "@/lib/orders/my-order-views";
import { pruneMyOrders } from "@/lib/orders/my-orders";
import { MY_ORDERS_KEEP_DAYS, MY_ORDERS_MAX } from "@/lib/orders/my-orders-limits";
import { splitLtrRuns } from "@/components/ui/bidi-text";
import type { OrderTrackingView } from "@/lib/orders/tracking-view";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const DAY = 24 * 60 * 60 * 1000;

function item(token: string, status: string | null, orderType = "pickup"): MyOrderItem {
  return {
    entry: { token, orderNumber: `MC-${token}`, savedAt: 0 },
    view: status === null ? null : ({ status, orderType } as unknown as OrderTrackingView),
  };
}

describe("My orders: tabs and filter", () => {
  const items = [
    item("a", "preparing", "pickup"),
    item("b", "ready", "delivery"),
    item("c", "delivered", "delivery"),
    item("d", "cancelled", "dine_in"),
    item("e", null), // link no longer valid
    item("f", "pending", "dine_in"),
  ];

  it("in progress / finished", () => {
    const { active, done } = splitMyOrders(items);
    expect(active.map((i) => i.entry.token)).toEqual(["a", "b", "f"]);
    expect(done.map((i) => i.entry.token)).toEqual(["c", "d", "e"]);
    expect(isActiveItem(item("x", "ready"))).toBe(true);
  });

  it("counts and filter by kind", () => {
    const { active } = splitMyOrders(items);
    expect(countMyOrderTypes(active)).toEqual({ pickup: 1, delivery: 1, dine_in: 1 });
    expect(filterMyOrderType(active, "delivery").map((i) => i.entry.token)).toEqual(["b"]);
    expect(filterMyOrderType(active, "all")).toHaveLength(3);
  });

  it("kept on the device 90 days, up to 60 orders", () => {
    expect(MY_ORDERS_KEEP_DAYS).toBe(90);
    expect(MY_ORDERS_MAX).toBe(60);
    const now = 1_800_000_000_000;
    const kept = pruneMyOrders(
      [
        { token: "new", orderNumber: "1", savedAt: now - 89 * DAY },
        { token: "old", orderNumber: "2", savedAt: now - 91 * DAY },
      ],
      now
    );
    expect(kept.map((e) => e.token)).toEqual(["new"]);
    const many = Array.from({ length: 80 }, (_, i) => ({ token: `t${i}`, orderNumber: `${i}`, savedAt: now - i }));
    expect(pruneMyOrders(many, now)).toHaveLength(60);
  });

  it("one call for all orders, capped and read-only", () => {
    const route = read("src/app/api/orders/track/batch/route.ts");
    expect(route).toContain("export async function POST");
    expect(route).toContain("tokens.length > MY_ORDERS_MAX");
    expect(route).toContain("readTrackingToken(token)");
    expect(route).toContain("buildTrackingView(");
    // No database writes (Map.set for the token lookup is fine).
    expect(route).not.toMatch(/\.(update|add|delete|batch|runTransaction)\(|\)\.set\(/);
    expect(read("src/features/orders/my-orders-screen.tsx")).not.toContain("/api/orders/track?t=");
  });
});

describe("menu", () => {
  it("desktop: favourites and my orders with counts, about scrolls to the footer, no contact link", () => {
    const header = read("src/components/layout/header.tsx");
    expect(header).toContain('href: "/favorites", labelKey: "nav.favorites", count: "favorites"');
    expect(header).toContain('href: "/orders", labelKey: "nav.orders", count: "orders"');
    expect(header).toContain('href: OFFERS_HREF, labelKey: "nav.offers"');
    expect(read("src/lib/customer-nav.ts")).toContain('OFFERS_HREF = "/offers"');
    expect(header).not.toContain('"nav.contact"');
    expect(header).toContain("onClick={() => scrollToAbout()}");
    expect(header).toContain("count > 0 &&");
    const footer = read("src/components/layout/footer.tsx");
    expect(footer).toContain('id="about"');
    expect(read("src/lib/scroll-to-about.ts")).toContain("[data-site-footer]");
  });

  it("phone bottom bar: active-order count on My orders", () => {
    expect(read("src/components/layout/bottom-nav.tsx")).toContain('labelKey: "nav.orders", icon: ClipboardList, badge: activeOrders');
  });

  it("account page: club, orders, favourites, contact, about; no admin links", () => {
    const page = read("src/app/account/page.tsx") + read("src/features/account/account-screen.tsx");
    for (const s of ['href="/orders"', 'href="/favorites"', "data-account-contact", "data-account-about", "whatsappUrl(", "openingHoursText("]) {
      expect(page).toContain(s);
    }
    expect(page).not.toMatch(/adminHref|account\.adminPanel|admin\.customers|admin\.settings|useAdminExternalHref/);
  });

  it("new texts in three languages", () => {
    const ui = read("src/data/ui-translations-seed.ts");
    for (const key of ["account.title", "account.club.hint", "account.navigate", "myOrders.tab.active", "myOrders.tab.done", "myOrders.type.all", "myOrders.noActive", "myOrders.noDone", "myOrders.keptDays"]) {
      expect(ui.split(`"${key}":`).length - 1, key).toBe(3);
    }
  });
});

describe("store name", () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
  }

  it("Hebrew is משקאת everywhere (emails, receipt, club, site); English and Arabic unchanged", () => {
    const all = files(resolve(process.cwd(), "src"));
    const old = all.filter((f) => /משכאת|משכא"/.test(readFileSync(f, "utf8")));
    expect(old).toEqual([]);
    expect(read("src/lib/email/loyalty-templates.ts")).toContain("קוד אימות למועדון משקאת");
    expect(read("src/lib/email/loyalty-templates.ts")).toContain("ברוך הבא למועדון משקאת");
    expect(read("src/lib/email/customer-payment-templates.ts")).toContain("ההזמנה ממשקאת אושרה");
    expect(read("src/lib/print-jobs/receipt-model.ts")).toContain('brandSecondary: "משקאת"');
    expect(read("src/data/admin-translations.ts")).toContain('"club.join.hero.title": "הצטרפו למועדון משקאת"');
    expect(read("src/lib/brand.ts")).toContain('name: "MISHKAT CAFÉ"');
  });
});

describe("staff page sign-in hint", () => {
  it("three short lines, Latin words and numbers isolated", () => {
    const admin = read("src/data/admin-translations.ts");
    for (const k of ["how", "block", "session"]) expect(admin.split(`"admin.staff.loginHint.${k}":`).length - 1, k).toBe(3);
    expect(admin).not.toContain('"admin.staff.loginHint":');
    expect(read("src/features/admin/staff-admin.tsx")).toContain("<BidiText text={t(`admin.staff.loginHint.${k}`)} />");
    expect(splitLtrRuns("סורקים את הברקוד בדף ה-QR.")).toEqual([
      { text: "סורקים את הברקוד בדף ה-", ltr: false },
      { text: "QR", ltr: true },
      { text: ".", ltr: false },
    ]);
    expect(splitLtrRuns("5 קודים שגויים חוסמים ל-15 דקות.").filter((p) => p.ltr).map((p) => p.text)).toEqual(["5", "15"]);
    expect(splitLtrRuns("رمز QR لمدة 12 ساعة").filter((p) => p.ltr).map((p) => p.text)).toEqual(["QR", "12"]);
  });
});

describe("phone navigation (header, bottom bar, side menu)", () => {
  it("header on phones: ☰, logo, favourites (count), account, cart; club button and language on desktop only", () => {
    const header = read("src/components/layout/header.tsx");
    expect(header).toContain("data-mobile-menu-open");
    expect(header).toMatch(/data-mobile-menu-open[\s\S]*<Logo/);
    expect(header).toContain('className={cn(ICON_BUTTON, "lg:hidden")} data-header-favorites');
    expect(header).toContain("hidden h-10 min-w-0 shrink-0 items-center gap-1.5 rounded-full bg-turquoise");
    expect(header).toContain('<LanguageSwitcher compact className="hidden lg:inline-flex" />');
    expect(header).not.toContain('variant="dropdown"');
    expect(header).toContain("<MobileMenuDrawer open={menuOpen} onClose={closeMenu} />");
  });

  it("bottom bar: home, menu, offers (→ menu for now), my orders with active count", () => {
    const nav = read("src/components/layout/bottom-nav.tsx");
    const hrefs = [...nav.matchAll(/\{ href: ("[^"]*"|[A-Z_]+), labelKey: "([^"]+)"/g)].map((m) => `${m[1]}|${m[2]}`);
    expect(hrefs).toEqual(['"/"|nav.home', '"/catalog"|nav.catalog', "OFFERS_HREF|nav.offers", '"/orders"|nav.orders']);
    expect(nav).toContain("badge: activeOrders");
  });

  it("side menu: every link, about, contact, language; opens from the start side; closes in four ways", () => {
    const drawer = read("src/components/layout/mobile-menu-drawer.tsx");
    for (const key of ["nav.home", "nav.catalog", "nav.offers", "nav.favorites", "nav.orders", "nav.accountClub", "nav.about", "nav.contact", "nav.language"]) {
      expect(drawer, key).toContain(`"${key}"`);
    }
    expect(drawer).toContain('rtl ? "right-0" : "left-0"');
    expect(drawer).toContain('e.key === "Escape" && onClose()');
    expect(drawer).toContain("onClick={onClose}");
    expect(drawer).toContain("lastPath.current !== pathname");
    expect(drawer).toContain("<LanguageSwitcher compact />");
    expect(drawer).not.toMatch(/admin/i);
    expect(read("src/features/account/account-screen.tsx")).toContain('id="contact"');
    const ui = read("src/data/ui-translations-seed.ts");
    for (const key of ["nav.openMenu", "nav.closeMenu", "nav.accountClub", "nav.language", "waiter.busyOnly", "waiter.noWork"]) {
      expect(ui.split(`"${key}":`).length - 1, key).toBe(3);
    }
  });
});

describe("staff screens", () => {
  it("waiter: 'only tables with work' kept on the device, with a message when there is none", async () => {
    const { tableHasWork } = await import("@/lib/waiter/tables");
    expect(tableHasWork({ state: "free" })).toBe(false);
    for (const state of ["ready", "in_kitchen", "to_pay"] as const) expect(tableHasWork({ state })).toBe(true);
    const screen = read("src/features/staff/waiter-tables.tsx");
    expect(screen).toContain('BUSY_ONLY_KEY = "mishkat-waiter-busy-only"');
    expect(screen).toContain("data-no-work");
    expect(screen).toContain("shownTables.map((table)");
  });

  it("courier: 'delivered today · N' folded at the bottom, opens on tap", () => {
    const screen = read("src/features/staff/courier-deliveries.tsx");
    expect(screen).toContain("const [showDelivered, setShowDelivered] = useState(false);");
    expect(screen).toContain('{t("courier.section.delivered")} · {items.length}');
    expect(screen).toContain("data-delivered-toggle");
  });
});
