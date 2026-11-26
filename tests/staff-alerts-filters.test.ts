// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { newCourierWork, newWaiterWork, titleWithBadge, type WaiterAlertOrder } from "@/lib/staff/alerts";
import { DEFAULT_STAFF_FILTER, filterStaff, matchesStaffQuery, staffCounts } from "@/lib/staff/filter";
import type { StaffMemberView } from "@/lib/staff/types";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("tab title badge", () => {
  it("(n) before the title while there is unseen work; never doubled", () => {
    expect(titleWithBadge("MISHKAT", 2)).toBe("(2) MISHKAT");
    expect(titleWithBadge("(2) MISHKAT", 3)).toBe("(3) MISHKAT");
    expect(titleWithBadge("(3) MISHKAT", 0)).toBe("MISHKAT");
  });
});

describe("courier: new work", () => {
  it("deliveries assigned since the last check, not on the first load, not done or cancelled", () => {
    const list = [
      { id: "a", stage: "pickup_now" },
      { id: "b", stage: "in_kitchen" },
      { id: "c", stage: "cancelled" },
      { id: "d", stage: "delivered" },
    ];
    expect(newCourierWork(null, list)).toEqual([]);
    expect(newCourierWork(new Set(["a"]), list)).toEqual(["b"]);
    expect(newCourierWork(new Set(["a", "b", "c", "d"]), list)).toEqual([]);
  });
});

describe("waiter: new work", () => {
  const o = (id: string, stage: string, tableId = "inside-4"): WaiterAlertOrder => ({ id, orderNumber: `MC-${id}`, tableId, stage });
  it("first load: nothing", () => {
    expect(newWaiterWork(null, [o("A", "ready")])).toEqual({ newOrders: [], nowReady: [] });
  });

  it("a new order at a table, and a dish that became ready", () => {
    const before = new Map([["A", "in_kitchen"], ["B", "ready"]]);
    const result = newWaiterWork(before, [o("A", "ready"), o("B", "ready"), o("C", "in_kitchen", "outside-2")]);
    expect(result.newOrders.map((x) => x.id)).toEqual(["C"]);
    expect(result.nowReady.map((x) => x.id)).toEqual(["A"]);
  });

  it("not for an order this screen just sent, a cancelled one, or a new one already served", () => {
    const before = new Map<string, string>();
    const result = newWaiterWork(before, [o("A", "in_kitchen"), o("B", "cancelled"), o("C", "served")], new Set(["MC-A"]));
    expect(result).toEqual({ newOrders: [], nowReady: [] });
  });

  it("a new order that is already ready counts once", () => {
    const result = newWaiterWork(new Map(), [o("A", "ready")]);
    expect(result.newOrders.length + result.nowReady.length).toBe(1);
  });
});

describe("admin staff filters", () => {
  const m = (name: string, role: "courier" | "waiter", active = true, worksToday = false, phone = "0501234567"): StaffMemberView => ({
    id: name, name, phone, role, active, worksToday, hasPin: true, pinSetAt: null,
  });
  const LIST = [
    m("סמיר חדאד", "courier", true, true, "0521112233"),
    m("יוסף", "courier", true, false),
    m("עלי", "courier", false, true),
    m("רנא", "waiter", true, false, "0549998877"),
    m("סמאח", "waiter", false),
  ];
  const names = (f: Partial<typeof DEFAULT_STAFF_FILTER>) => filterStaff(LIST, { ...DEFAULT_STAFF_FILTER, ...f }).map((x) => x.name);

  it("role, status", () => {
    expect(names({})).toHaveLength(5);
    expect(names({ role: "courier" })).toEqual(["סמיר חדאד", "יוסף", "עלי"]);
    expect(names({ role: "waiter" })).toEqual(["רנא", "סמאח"]);
    expect(names({ status: "active" })).toEqual(["סמיר חדאד", "יוסף", "רנא"]);
    expect(names({ role: "waiter", status: "disabled" })).toEqual(["סמאח"]);
  });

  it("works today: active couriers only, and only with the couriers filter", () => {
    expect(names({ role: "courier", worksToday: true })).toEqual(["סמיר חדאד"]);
    expect(names({ role: "all", worksToday: true })).toHaveLength(5);
  });

  it("search by part of the name, or by phone digits (2+)", () => {
    expect(names({ query: "סמ" })).toEqual(["סמיר חדאד", "סמאח"]);
    expect(names({ query: "חדאד" })).toEqual(["סמיר חדאד"]);
    expect(names({ query: "999" })).toEqual(["רנא"]);
    expect(names({ query: "054-999" })).toEqual(["רנא"]);
    expect(matchesStaffQuery(LIST[0]!, "5")).toBe(false);
    expect(matchesStaffQuery(LIST[0]!, "  ")).toBe(true);
  });

  it("counts on the buttons follow the search", () => {
    expect(staffCounts(LIST, "")).toEqual({ all: 5, courier: 3, waiter: 2, active: 3, disabled: 2, worksToday: 1 });
    expect(staffCounts(LIST, "סמ")).toMatchObject({ all: 2, courier: 1, waiter: 1 });
  });
});

describe("wiring", () => {
  it("both screens keep checking in the background and alert through the shared hook", () => {
    for (const file of ["src/features/staff/courier-deliveries.tsx", "src/features/staff/waiter-tables.tsx"]) {
      const src = read(file);
      expect(src, file).toContain("useWorkAlerts()");
      expect(src, file).toMatch(/setInterval\(\(\) => void load\(\), (COURIER|WAITER)_POLL_MS\)/);
      expect(src, file).toContain("<SoundButton");
    }
    expect(read("src/features/staff/courier-deliveries.tsx")).toContain("newCourierWork(known.current, list)");
    expect(read("src/features/staff/waiter-tables.tsx")).toContain("newWaiterWork(lastStages.current, json.orders, sentHere.current)");
  });

  it("the screen stays on while the waiter screen is open (not on the courier screen)", () => {
    expect(read("src/features/staff/waiter-tables.tsx")).toContain("useScreenWakeLock(Boolean(data))");
    expect(read("src/features/staff/courier-deliveries.tsx")).not.toContain("useScreenWakeLock");
    expect(read("src/features/staff/use-work-alerts.ts")).toContain('wakeLock.request("screen")');
  });

  it("filters on the Staff page, translated", () => {
    expect(read("src/features/admin/staff-admin.tsx")).toContain("<StaffFilters");
    const admin = read("src/data/admin-translations.ts");
    for (const key of ["search", "all", "couriers", "waiters", "anyStatus", "active", "disabled", "none", "clear"]) {
      expect(admin.split(`"admin.staff.filter.${key}":`).length - 1, key).toBe(3);
    }
    expect(read("src/data/ui-translations-seed.ts").split('"staff.sound.enable":').length - 1).toBe(3);
  });
});
