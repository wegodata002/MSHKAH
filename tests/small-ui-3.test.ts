// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ADMIN_TRANSLATIONS } from "@/data/admin-translations";
import { createFakeFirestore } from "./helpers/fake-firestore";
import { parseStaffAdminRequest } from "@/lib/staff/admin-input";
import { signStaffSession } from "@/lib/staff/session";
import { mapOrder } from "@/lib/mappers";
import { toWaiterOrder } from "@/lib/waiter/tables";
import type { FirestoreOrder } from "@/types/firestore";

const fake = createFakeFirestore();
vi.mock("@/lib/firebase/admin", () => ({ getAdminDb: () => fake.db }));
const store = await import("@/lib/staff/admin/store");
const db = fake.db as unknown as Parameters<typeof store.deleteStaff>[0];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("waiters' QR: copy link", () => {
  it("note in three languages", () => {
    expect(ADMIN_TRANSLATIONS.he["admin.waiterQr.copyNote"]).toBe("קישור סודי — לשלוח רק למלצרית.");
    expect(ADMIN_TRANSLATIONS.ar["admin.waiterQr.copyNote"]).toBeTruthy();
    expect(ADMIN_TRANSLATIONS.en["admin.waiterQr.copyNote"]).toBeTruthy();
  });
});

describe("phone header: language", () => {
  it("a round button with the current language that opens the list; not in the ☰ menu", () => {
    const switcher = read("src/components/layout/language-switcher.tsx");
    expect(switcher).toContain('const SHORT_LABEL: Record<Locale, string> = { he: "עב", ar: "ع", en: "EN" };');
    expect(switcher).toContain("data-lang-button");
    expect(switcher).toContain('aria-haspopup="listbox"');
    expect(read("src/components/layout/header.tsx")).toContain('<LanguageSwitcher variant="icon" className="lg:hidden" />');
    expect(read("src/components/layout/mobile-menu-drawer.tsx")).not.toContain("LanguageSwitcher");
  });
});

describe("admin: accessibility button", () => {
  it("smaller, in the corner opposite the side menu, above the bottom bar and the unsaved-changes bar", () => {
    const css = read("src/app/accessibility.css");
    expect(css).toContain("body:has([data-admin]) .a11y-fab.a11y-fab {");
    expect(css).toContain("inset-inline-end: 0.75rem;");
    expect(css).toContain("body:has([data-admin]):has(.mobile-bottom-nav) .a11y-fab.a11y-fab {");
    expect(css).toContain("bottom: calc(var(--admin-unsaved-top, 6rem) + 0.5rem);");
    const bar = read("src/features/admin/components/unsaved-changes-bar.tsx");
    expect(bar).toContain("data-unsaved-bar");
    expect(bar).toContain('root.style.setProperty("--admin-unsaved-top"');
    expect(bar).toContain('root.style.removeProperty("--admin-unsaved-top")');
    // The toasts stay in the start corner, the other side from the button.
    expect(read("src/features/admin/components/admin-toast.tsx")).toContain("fixed bottom-6 start-6");
  });
});

describe("Staff page: delete (in-memory database)", () => {
  const courier = { name: "סמיר", phone: "0521112233", role: "courier", active: true, pinHash: "h1", pinSetAt: null, sessionVersion: 1, workingDate: null, createdAt: "", updatedAt: "", updatedBy: "" };
  beforeEach(() => {
    fake.reset();
    fake.put("staffMembers", "Courier00000001", courier);
    fake.put("staffMembers", "Waiter000000001", { ...courier, name: "רנא", role: "waiter", pinHash: null });
  });

  it("requests: delete needs a valid id", () => {
    expect(parseStaffAdminRequest({ action: "delete", id: "Courier00000001" })).toEqual({ ok: true, request: { action: "delete", id: "Courier00000001" } });
    expect(parseStaffAdminRequest({ action: "delete", id: "../x" })).toEqual({ ok: false, error: "ID" });
  });

  it("a courier with an open delivery today is refused; nothing is deleted", async () => {
    const result = await store.deleteStaff(db, { id: "Courier00000001", openDeliveriesToday: async () => 2 });
    expect(result).toEqual({ ok: false, code: "OPEN_DELIVERIES", open: 2 });
    expect(fake.get("staffMembers", "Courier00000001")).toBeTruthy();
  });

  it("a courier without open deliveries, and an old waiter record, are deleted; their sign-in ends", async () => {
    const cookie = signStaffSession({ staffId: "Courier00000001", sessionVersion: 1 }).value;
    expect((await store.readStaffMember(db, cookie))?.name).toBe("סמיר");
    expect(await store.deleteStaff(db, { id: "Courier00000001", openDeliveriesToday: async () => 0 })).toEqual({ ok: true });
    expect(fake.get("staffMembers", "Courier00000001")).toBeUndefined();
    expect(await store.readStaffMember(db, cookie)).toBeNull();

    // Waiters are not checked for deliveries.
    const never = vi.fn(async () => 5);
    expect(await store.deleteStaff(db, { id: "Waiter000000001", openDeliveriesToday: never })).toEqual({ ok: true });
    expect(never).not.toHaveBeenCalled();
    expect(await store.deleteStaff(db, { id: "Waiter000000001", openDeliveriesToday: never })).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("old orders do not depend on the staff record: names are saved on the order", () => {
    // A delivered order of a deleted courier, and a table order served / paid / entered by a deleted waiter.
    const order = mapOrder({
      id: "Order0000001",
      orderNumber: "MC-2026-0001",
      customerId: "c1",
      customerName: "דנה",
      items: [],
      status: "delivered",
      subtotal: 30,
      discount: 0,
      delivery: 15,
      total: 45,
      orderType: "delivery",
      courierId: "Courier00000001",
      courierName: "סמיר",
      paymentMethod: "cash",
      paymentStatus: "paid",
      paidBy: "סמיר",
    } as unknown as FirestoreOrder & { id: string });
    expect(order.courierName).toBe("סמיר");
    expect(order.courierId).toBe("Courier00000001");
    const table = toWaiterOrder({ id: "Order0000002", paymentStatus: "paid", servedBy: "רנא", paidBy: "רנא · טלפון מלצרית 1", createdBy: "רנא" });
    expect([table.servedBy, table.paidBy, table.createdBy]).toEqual(["רנא", "רנא · טלפון מלצרית 1", "רנא"]);
    // The admin order screens read the saved name; the courier picker keeps a courier that is no longer listed.
    expect(read("src/features/admin/orders/order-card.tsx")).toContain("{order.courierName}");
    expect(read("src/features/admin/orders/order-courier-picker.tsx")).toContain('options.unshift({ id: order.courierId, name: order.courierName ?? "—" })');
    // Assigning to a deleted courier is refused on the server (the record is read in the transaction).
    expect(read("src/lib/couriers/admin/store.ts")).toContain("if (!courier || courier.role !== \"courier\"");
  });

  it("the admin route checks open deliveries for today before deleting", () => {
    const route = read("src/app/api/admin/staff/route.ts");
    expect(route).toContain("openDeliveryCount(await listCourierDeliveries(db, courierId))");
    expect(route).toContain('result.code === "OPEN_DELIVERIES"');
  });
});
