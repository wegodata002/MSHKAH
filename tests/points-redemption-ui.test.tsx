import { cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/providers/locale-provider", async () => {
  const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
  const { UI_TRANSLATIONS_SEED } = await import("@/data/ui-translations-seed");
  const t = (key: string, fallback?: string) => ADMIN_TRANSLATIONS.he[key] ?? UI_TRANSLATIONS_SEED.he[key] ?? fallback ?? key;
  return { useT: () => t, useLocale: () => ({ locale: "he", dir: "rtl" }) };
});
const hint = { on: true };
vi.mock("@/lib/loyalty/club-hint", () => ({ hasClubHint: () => hint.on }));

const { usePointsAtCheckout, PointsAtCheckout } = await import("@/features/club/points-at-checkout");
const { OrderCard } = await import("@/features/admin/orders/order-card");
const { UI_TRANSLATIONS_SEED } = await import("@/data/ui-translations-seed");
const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");

const SETTINGS = { redemptionEnabled: true, pointValueApproved: true, pointValueMinor: 10, redemptionMinPoints: 10, redemptionMaxPoints: 500 };
const fetchMock = vi.fn();

beforeEach(() => {
  hint.on = true;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, ready: true, balancePoints: 120, settings: SETTINGS }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ products = 40, total = 40, allowed = true }: { products?: number; total?: number; allowed?: boolean }) {
  const state = usePointsAtCheckout({ productsAfterCoupon: products, totalBeforePoints: total, allowed });
  return (
    <>
      <PointsAtCheckout state={state} />
      <output data-requested>{state.requested}</output>
      <output data-discount>{state.discount}</output>
    </>
  );
}

describe("checkout: paying with points", () => {
  it("shows the balance and its value; default = as many as possible; the member can choose less", async () => {
    const { container } = render(<Harness />);
    await waitFor(() => expect(container.querySelector("[data-points-checkout]")).toBeTruthy());
    expect(container.querySelector("[data-points-balance]")!.textContent).toContain("120");
    expect(container.querySelector("[data-points-balance]")!.textContent).toContain("12");
    expect((container.querySelector("[data-points-input]") as HTMLInputElement).value).toBe("120");
    expect(container.querySelector("[data-requested]")!.textContent).toBe("120");
    expect(container.querySelector("[data-discount]")!.textContent).toBe("12");
    fireEvent.click(container.querySelector("[data-points-minus]")!);
    expect(container.querySelector("[data-requested]")!.textContent).toBe("119");
    expect((container.querySelector("[data-points-plus]") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(container.querySelector("[data-points-input]")!, { target: { value: "3" } });
    expect(container.querySelector("[data-requested]")!.textContent).toBe("10"); // the club minimum
    fireEvent.click(container.querySelector("[data-points-use]")!);
    expect(container.querySelector("[data-requested]")!.textContent).toBe("0");
  });

  it("a small order: up to what it can take (₪1 left to pay)", async () => {
    const { container } = render(<Harness products={5} total={5} />);
    await waitFor(() => expect(container.querySelector("[data-points-input]")).toBeTruthy());
    expect((container.querySelector("[data-points-input]") as HTMLInputElement).value).toBe("40");
    expect((container.querySelector("[data-points-plus]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("nothing shown when redemption is off / not a member / at the table; no request is sent", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, ready: false }) });
    const off = render(<Harness />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(off.container.querySelector("[data-points-checkout]")).toBeNull();
    off.unmount();
    hint.on = false;
    fetchMock.mockClear();
    const guest = render(<Harness />);
    expect(guest.container.querySelector("[data-points-checkout]")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    guest.unmount();
    hint.on = true;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, ready: true, balancePoints: 120, settings: SETTINGS }) });
    const table = render(<Harness allowed={false} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(table.container.querySelector("[data-points-checkout]")).toBeNull();
    expect(table.container.querySelector("[data-requested]")!.textContent).toBe("0");
  });

  it("refused by the server: takes the new maximum and reads the balance again", async () => {
    const { result } = renderHook(() => usePointsAtCheckout({ productsAfterCoupon: 40, totalBeforePoints: 40, allowed: true }));
    await waitFor(() => expect(result.current.max).toBe(120));
    result.current.onRefused(60);
    await waitFor(() => expect(result.current.max).toBe(60));
    expect(result.current.requested).toBe(60);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("below the minimum on this order: says so, no choice", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, ready: true, balancePoints: 5, settings: SETTINGS }) });
    const { container } = render(<Harness />);
    await waitFor(() => expect(container.querySelector("[data-points-none]")).toBeTruthy());
    expect(container.querySelector("[data-points-none]")!.textContent).toBe(UI_TRANSLATIONS_SEED.he["checkout.points.notThisOrder"]!.replace("{min}", "10"));
    expect(container.querySelector("[data-points-input]")).toBeNull();
  });
});

describe("admin order card: points held on an unpaid card order", () => {
  const base = {
    id: "Order0001", orderNumber: "MC-2026-AAAA1111", customerId: "c", customerName: "דנה", status: "pending", items: [{ productId: "latte", productName: "לאטה", quantity: 2, price: 20 }],
    subtotal: 40, discount: 0, delivery: 0, total: 25, createdAt: "2026-11-26T10:00:00Z", orderType: "pickup", paymentMethod: "card", paymentProvider: "HYP", paymentStatus: "pending", pointsRedeemed: 150, pointsDiscount: 15,
  };
  const card = (order: Record<string, unknown>, expanded = false) =>
    render(<OrderCard order={order as never} expanded={expanded} updating={false} now={Date.parse("2026-11-26T10:05:00Z")} onToggle={() => {}} onStatusChange={() => {}} onCancel={() => {}} onPrint={() => {}} />);

  it("'points held (150)' while the card payment is not done; gone once paid, cancelled or given back", () => {
    expect(card(base).container.querySelector("[data-points-held]")!.textContent).toBe(ADMIN_TRANSLATIONS.he["admin.orders.pointsHeld"]!.replace("{points}", "150"));
    cleanup();
    for (const over of [{ paymentStatus: "paid" }, { status: "cancelled" }, { pointsReleasedAt: "2026-11-26T11:00:00Z" }, { paymentMethod: "cash", paymentProvider: undefined }]) {
      expect(card({ ...base, ...over }).container.querySelector("[data-points-held]"), JSON.stringify(over)).toBeNull();
      cleanup();
    }
  });

  it("details: the points line (and 'returned' after a cancel)", () => {
    const { container } = card({ ...base, status: "cancelled", pointsReleasedAt: "2026-11-26T11:00:00Z" }, true);
    const line = container.querySelector("[data-order-points]")!.textContent!;
    expect(line).toContain("150");
    expect(line).toContain("15");
    expect(line).toContain(ADMIN_TRANSLATIONS.he["admin.orders.pointsReturned"]!);
  });
});
