import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QRCode from "qrcode";
import jsQRReal from "jsqr";
import type { ScanSummary } from "@/lib/loyalty/coffee";

/**
 * The staff "scan card" screen, rendered (jsdom): lookup, + cups, the 60-second question, free
 * cup, 10% used with confirmation, undo; and the camera with the built-in reader and with jsQR.
 * The server routes are mocked here (they are tested in club-3.test.ts).
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
vi.mock("@/features/admin/components/admin-page-header", () => ({
  AdminPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/features/admin/components/admin-card", () => ({
  AdminCard: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <section>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  ),
}));

const { ClubScanAdmin } = await import("@/features/admin/club-scan/club-scan-admin");
const { QrCamera } = await import("@/features/admin/club-scan/qr-camera");
const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
const he = (key: string) => ADMIN_TRANSLATIONS.he[key]!;

function summary(patch: Partial<ScanSummary> = {}, cups = 2): ScanSummary {
  return {
    member: { id: "m1", name: "דנה כהן", memberNumber: "M-4821-7QXA", maskedEmail: "d***@gmail.com", status: "active" },
    coffee: { enabled: true, cups, filled: Math.min(cups, 5), giftReady: cups >= 5, toGift: Math.max(0, 5 - cups) },
    coupons: [{ code: "MK-7QXA-29KM", percent: 10, expiresAt: "2026-12-24T10:00:00.000Z", firstPurchaseOnly: true }],
    history: [
      {
        id: "e1",
        memberId: "m1",
        kind: "cups",
        cups: 2,
        cupsAfter: 2,
        actorUid: "u1",
        actorName: "נועה",
        actorRole: "Employee",
        createdAt: "2026-11-24T12:02:00.000Z",
        canUndo: true,
      },
    ],
    ...patch,
  };
}
const ok = (data: unknown) => ({ ok: true, status: 200, data });
const refused = (data: unknown) => ({ ok: false, status: 409, data });

beforeEach(() => fetchMock.mockReset());
afterEach(() => cleanup());

async function findDana() {
  fetchMock.mockResolvedValueOnce(ok({ ok: true, summary: summary() }));
  render(<ClubScanAdmin />);
  fireEvent.change(screen.getByLabelText(he("club3.scan.memberNumber")), { target: { value: "m-4821-7qxa" } });
  fireEvent.click(screen.getByRole("button", { name: new RegExp(he("club3.scan.find")) }));
  await screen.findByText("דנה כהן");
}

describe("scan screen", () => {
  it("member number → name, number, masked email, cups, the 10% code, history (who and when)", async () => {
    await findDana();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/club/scan", { memberNumber: "M-4821-7QXA" });
    expect(screen.getByText(/d\*\*\*@gmail\.com/)).toBeInTheDocument();
    expect(screen.getByText(he("club3.scan.cups").replace("{n}", "2"))).toBeInTheDocument();
    expect(document.querySelectorAll('[data-coffee-cup="full"]')).toHaveLength(2);
    expect(screen.getByText(he("club3.scan.couponAvailable").replace("{percent}", "10"))).toBeInTheDocument();
    expect(screen.getByText(he("club3.scan.h.cups").replace("{n}", "2"))).toBeInTheDocument();
    expect(screen.getByText(/נועה \(עובד\)/)).toBeInTheDocument();
    // No free-cup button before 5 cups.
    expect(document.querySelector("[data-scan-gift]")).toBeNull();
  });

  it("not found → clear message", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, data: { ok: false, reason: "not_found" } });
    render(<ClubScanAdmin />);
    fireEvent.change(screen.getByLabelText(he("club3.scan.memberNumber")), { target: { value: "M-0000-XXXX" } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(he("club3.scan.find")) }));
    expect(await screen.findByText(he("club3.scan.notFound"))).toBeInTheDocument();
  });

  it("+ 3 cups at once; a second add within a minute asks first, then sends the same request with confirm", async () => {
    await findDana();
    const plus = screen.getByRole("button", { name: "+" });
    fireEvent.click(plus);
    fireEvent.click(plus);
    fetchMock.mockResolvedValueOnce(refused({ ok: false, reason: "recent", secondsAgo: 12, summary: summary() }));
    fireEvent.click(screen.getByRole("button", { name: he("club3.scan.addMany").replace("{n}", "3") }));
    await screen.findByText(he("club3.scan.recent").replace("{s}", "12"));
    const first = fetchMock.mock.calls[1]![1] as { action: string; count: number; requestId: string; confirm: boolean };
    expect(first).toMatchObject({ memberId: "m1", action: "add", count: 3, confirm: false });

    fetchMock.mockResolvedValueOnce(ok({ ok: true, summary: summary({}, 5) }));
    fireEvent.click(screen.getByRole("button", { name: he("club3.scan.recentYes") }));
    await screen.findByText(he("club3.scan.added"));
    const second = fetchMock.mock.calls[2]![1] as { requestId: string; confirm: boolean };
    expect(second).toMatchObject({ confirm: true, requestId: first.requestId });
    // 5 cups → the free-cup button appears.
    expect(document.querySelector("[data-scan-gift]")).not.toBeNull();
  });

  it("free cup redeem", async () => {
    fetchMock.mockResolvedValueOnce(ok({ ok: true, summary: summary({}, 6) }));
    render(<ClubScanAdmin />);
    fireEvent.change(screen.getByLabelText(he("club3.scan.memberNumber")), { target: { value: "M-4821-7QXA" } });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(he("club3.scan.find")) }));
    const gift = await screen.findByRole("button", { name: new RegExp(he("club3.scan.redeemGift")) });
    fetchMock.mockResolvedValueOnce(ok({ ok: true, summary: summary({}, 1) }));
    fireEvent.click(gift);
    await screen.findByText(he("club3.scan.giftDone"));
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ action: "gift" });
  });

  it("10% 'used' needs a confirmation", async () => {
    await findDana();
    fireEvent.click(screen.getByRole("button", { name: he("club3.scan.couponUse") }));
    expect(fetchMock).toHaveBeenCalledTimes(1); // nothing sent yet
    fetchMock.mockResolvedValueOnce(ok({ ok: true, summary: summary({ coupons: [] }) }));
    fireEvent.click(screen.getByRole("button", { name: he("club3.scan.couponConfirm") }));
    await screen.findByText(he("club3.scan.couponDone"));
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ action: "coupon", code: "MK-7QXA-29KM" });
  });

  it("undo last action; a refused undo explains why", async () => {
    await findDana();
    fetchMock.mockResolvedValueOnce(refused({ ok: false, reason: "cannot_undo", summary: summary() }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(he("club3.scan.undo")) }));
    expect(await screen.findByText(he("club3.scan.err.cannot_undo"))).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ action: "undo", entryId: "e1" });
  });
});

// ── Camera ────────────────────────────────────────────────────────────
describe("camera scanner", () => {
  const stopTrack = vi.fn();
  beforeEach(() => {
    stopTrack.mockReset();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: () => Promise.resolve() });
    Object.defineProperty(HTMLVideoElement.prototype, "readyState", { configurable: true, get: () => 4 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 480 });
  });
  afterEach(() => {
    delete (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector;
    vi.restoreAllMocks();
  });

  it("uses the built-in reader where it exists (Chrome / Edge), and stops the camera after a read", async () => {
    (window as unknown as { BarcodeDetector: unknown }).BarcodeDetector = class {
      static getSupportedFormats = async () => ["qr_code"];
      detect = async () => [{ rawValue: "https://mishkatcafe.dev/club/card?c=m1.sig" }];
    };
    const onResult = vi.fn();
    render(<QrCamera onResult={onResult} onClose={() => {}} />);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("https://mishkatcafe.dev/club/card?c=m1.sig"));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(stopTrack).toHaveBeenCalled();
  });

  it("falls back to jsQR where there is none (Safari on iPhone / iPad)", async () => {
    // A real QR of a signed card link, drawn into the "camera frame" the canvas returns.
    const link = "https://mishkatcafe.dev/club/card?c=1f0e6a2c-8d3b-4f61-9a7e-5b2c9d4e7f10.AbCdEfGhIjKlMnOpQrStUv";
    const qr = QRCode.create(link, { errorCorrectionLevel: "M" });
    const cell = 4;
    const margin = 4;
    const size = (qr.modules.size + margin * 2) * cell;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let y = 0; y < qr.modules.size; y++) {
      for (let x = 0; x < qr.modules.size; x++) {
        if (!qr.modules.get(y, x)) continue;
        for (let dy = 0; dy < cell; dy++) {
          for (let dx = 0; dx < cell; dx++) {
            const i = (((y + margin) * cell + dy) * size + (x + margin) * cell + dx) * 4;
            pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
          }
        }
      }
    }
    // jsQR itself reads it.
    expect(jsQRReal(pixels, size, size)?.data).toBe(link);

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          drawImage: () => {},
          getImageData: () => ({ data: pixels, width: size, height: size }),
        }) as unknown as CanvasRenderingContext2D
    );
    const onResult = vi.fn();
    render(<QrCamera onResult={onResult} onClose={() => {}} />);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(link), { timeout: 4000 });
    expect(stopTrack).toHaveBeenCalled();
  });

  it("camera refused → message to type the member number", async () => {
    (navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>).mockRejectedValueOnce(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    render(<QrCamera onResult={() => {}} onClose={() => {}} />);
    expect(await screen.findByText(he("club3.scan.cameraDenied"))).toBeInTheDocument();
  });

  it("closing stops the camera", async () => {
    const { unmount } = render(<QrCamera onResult={() => {}} onClose={() => {}} />);
    await waitFor(() => expect(document.querySelector('[data-qr-camera="scanning"]')).not.toBeNull());
    await act(async () => unmount());
    expect(stopTrack).toHaveBeenCalled();
  });
});
