import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Admin, rendered (jsdom): the waiters' QR card (Admin only, Replace QR with confirmation) and the
 * waiter devices list (rename, disconnect). The admin API is mocked.
 */

vi.mock("@/components/providers/locale-provider", async () => {
  const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
  return {
    useT: () => (key: string, fallback?: string) => ADMIN_TRANSLATIONS.he[key] ?? fallback ?? key,
    useLocale: () => ({ locale: "he", dir: "rtl" }),
  };
});
const fetchMock = vi.fn();
vi.mock("@/lib/auth/client-admin-fetch", () => ({ clientAdminFetch: (...args: unknown[]) => fetchMock(...args) }));
vi.mock("@/lib/admin-qr-image", () => ({ createQrPngDataUrl: async (url: string) => `data:image/png;base64,${btoa(url).slice(0, 20)}` }));
vi.mock("@/features/admin/components/admin-card", () => ({
  AdminCard: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}));

const { WaiterQrCard } = await import("@/features/admin/waiter-qr-card");
const { StaffDevicesSection } = await import("@/features/admin/staff-devices-section");
const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
const he = (key: string) => ADMIN_TRANSLATIONS.he[key]!;

const QR1 = { url: "https://mishkatcafe.dev/staff/join?k=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", version: 1, createdAt: "2026-11-26T08:00:00.000Z", disconnected: 0 };
const QR2 = { url: "https://mishkatcafe.dev/staff/join?k=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", version: 2, createdAt: "2026-11-26T09:00:00.000Z", disconnected: 3 };

beforeEach(() => fetchMock.mockReset());
afterEach(cleanup);

describe("waiters' QR card", () => {
  it("shows the QR for the admin; Replace asks first, then shows the new one and how many were disconnected", async () => {
    fetchMock.mockImplementation(async (_path: string, body?: { action: string }) =>
      body?.action === "waiter-qr" ? { ok: true, status: 200, data: { qr: QR1 } } : { ok: true, status: 200, data: { qr: QR2 } }
    );
    const { container } = render(<WaiterQrCard />);
    await waitFor(() => expect(container.querySelector("[data-waiter-qr-image]")).toBeTruthy());
    expect(container.querySelector("[data-waiter-qr-version]")!.textContent).toContain("QR מספר 1");
    expect(screen.getByText(he("admin.waiterQr.secretNote"))).toBeTruthy();

    fireEvent.click(container.querySelector("[data-waiter-qr-replace]")!);
    expect(fetchMock).toHaveBeenCalledTimes(1); // nothing replaced yet
    expect(container.querySelector("[data-waiter-qr-confirm]")!.textContent).toContain(he("admin.waiterQr.replaceConfirm"));
    fireEvent.click(container.querySelector("[data-waiter-qr-replace-yes]")!);
    await waitFor(() => expect(container.querySelector("[data-waiter-qr-notice]")).toBeTruthy());
    expect(fetchMock.mock.calls[1]![1]).toEqual({ action: "rotate-waiter-qr" });
    expect(container.querySelector("[data-waiter-qr-notice]")!.textContent).toContain("נותקו 3 מכשירים");
    expect(container.querySelector("[data-waiter-qr-version]")!.textContent).toContain("QR מספר 2");
  });

  it("Copy link: copies the secret link, with the 'send only to a waiter' note", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, data: { qr: QR1 } });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = render(<WaiterQrCard />);
    await waitFor(() => expect(container.querySelector("[data-waiter-qr-copy]")).toBeTruthy());
    expect(container.querySelector("[data-waiter-qr-copy-note]")!.textContent).toBe(he("admin.waiterQr.copyNote"));
    fireEvent.click(container.querySelector("[data-waiter-qr-copy]")!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(QR1.url));
    await waitFor(() => expect(container.querySelector("[data-waiter-qr-copy]")!.textContent).toBe(he("admin.qr.copied")));
  });

  it("not an admin: no QR, a short note", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, code: "PERMISSION_DENIED" });
    const { container } = render(<WaiterQrCard />);
    await waitFor(() => expect(container.querySelector("[data-waiter-qr-denied]")).toBeTruthy());
    expect(container.querySelector("[data-waiter-qr-image]")).toBeNull();
    expect(container.querySelector("[data-waiter-qr-replace]")).toBeNull();
    expect(container.querySelector("[data-waiter-qr-copy]")).toBeNull();
  });
});

describe("waiter devices list", () => {
  const list = [
    { id: "Device00000001", name: "טלפון מלצרית 1", active: true, source: "qr", createdAt: "2026-11-26T08:00:00.000Z", expiresAt: "2027-02-24T08:00:00.000Z", lastSeenAt: "2026-11-26T08:05:00.000Z" },
    { id: "Device00000002", name: "טאבלט בר", active: true, source: "code", createdAt: "2026-11-20T08:00:00.000Z", expiresAt: "2026-12-20T08:00:00.000Z", lastSeenAt: null },
  ];

  it("lists devices with how they joined; rename and disconnect each one", async () => {
    fetchMock.mockImplementation(async (_path: string, body?: { action: string }) =>
      body?.action === "devices" ? { ok: true, status: 200, data: { devices: list } } : { ok: true, status: 200, data: {} }
    );
    const { container } = render(<StaffDevicesSection />);
    await waitFor(() => expect(container.querySelectorAll("[data-device]")).toHaveLength(2));
    expect(container.querySelector('[data-device="טלפון מלצרית 1"]')!.textContent).toContain(he("admin.devices.viaQr"));
    expect(container.querySelector('[data-device="טאבלט בר"]')!.textContent).toContain(he("admin.devices.viaCode"));
    expect(container.querySelector("[data-device-connect]")).toBeNull(); // no 6-digit pairing any more

    fireEvent.click(container.querySelector('[data-device="טלפון מלצרית 1"] [data-device-rename]')!);
    fireEvent.change(container.querySelector("[data-device-name-input]")!, { target: { value: "טלפון של רנא" } });
    fireEvent.click(container.querySelector("[data-device-rename-save]")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/staff", { action: "rename-device", deviceId: "Device00000001", name: "טלפון של רנא" }));

    fireEvent.click(container.querySelector('[data-device="טאבלט בר"] [data-device-revoke]')!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/staff", { action: "revoke-device", deviceId: "Device00000002" }));
  });
});
