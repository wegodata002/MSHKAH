import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { user: { role: "Admin" } as { role: string } | null, firebaseUser: { uid: "U1" } as unknown, loading: false };
vi.mock("@/components/providers/auth-provider", () => ({ useAuth: () => auth }));
const fetchMock = vi.fn();
vi.mock("@/lib/auth/client-admin-fetch", async (orig) => ({ ...(await orig<object>()), clientAdminFetch: (...a: unknown[]) => fetchMock(...a) }));
const { useCustomerMemberLinks } = await import("@/hooks/useCustomerMemberLinks");

beforeEach(() => {
  fetchMock.mockReset();
  auth.user = { role: "Admin" };
});

describe("Customers: club badge loading states", () => {
  it("ready with links", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, data: { links: { C1: { memberId: "M1", status: "active" } } } });
    const { result } = renderHook(() => useCustomerMemberLinks());
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.links.C1!.memberId).toBe("M1");
  });

  it("403 → denied; 503 → failed, and retry asks again", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, code: "PERMISSION_DENIED" });
    const denied = renderHook(() => useCustomerMemberLinks());
    await waitFor(() => expect(denied.result.current.state).toBe("denied"));
    denied.unmount();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, code: "UNAVAILABLE" }).mockResolvedValue({ ok: true, status: 200, data: { links: {} } });
    const { result } = renderHook(() => useCustomerMemberLinks());
    await waitFor(() => expect(result.current.state).toBe("failed"));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("not an Admin: denied without asking the server", async () => {
    auth.user = { role: "Manager" };
    const { result } = renderHook(() => useCustomerMemberLinks());
    expect(result.current.state).toBe("denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
