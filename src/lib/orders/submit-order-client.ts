import type { CartItem } from "@/types";
import type { CreateOrderRequest } from "@/lib/orders/server-order";

/** Browser side of POST /api/orders/create. The server prices the order; the browser only sends the cart. */

export type SubmitOrderResult =
  | { ok: true; id: string; orderNumber: string; total: number; trackingToken?: string }
  | {
      ok: false;
      status: number;
      code: string;
      productNames?: string[];
      minOrder?: number;
      nextAt?: string | null;
      /** COUPON_INVALID: login_required / invalid / used / expired. */
      reason?: string;
    };

export function cartToOrderItems(items: CartItem[]): CreateOrderRequest["items"] {
  return items.map((item) => {
    const line: CreateOrderRequest["items"][number] = {
      productId: item.product.id,
      quantity: item.quantity,
    };
    if (item.selections.length > 0) {
      line.modifiers = item.selections.map((s) => ({
        groupId: s.groupId,
        groupName: s.groupName,
        optionId: s.optionId,
        optionName: s.optionName,
        priceDelta: s.priceDelta,
        quantity: s.quantity,
        ...(s.kitchenNote?.trim() ? { kitchenNote: s.kitchenNote.trim() } : {}),
      }));
    }
    const note = item.notes?.trim();
    if (note) line.notes = note;
    return line;
  });
}

export async function submitOrder(request: CreateOrderRequest): Promise<SubmitOrderResult> {
  let res: Response;
  try {
    res = await fetch("/api/orders/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    return { ok: false, status: 0, code: "NETWORK_ERROR" };
  }
  const data = (await res.json().catch(() => null)) as
    | {
        ok?: boolean;
        id?: string;
        orderNumber?: string;
        total?: number;
        trackingToken?: string;
        code?: string;
        productNames?: string[];
        minOrder?: number;
        nextAt?: string | null;
        reason?: string;
      }
    | null;
  if (res.ok && data?.ok && data.id) {
    return {
      ok: true,
      id: data.id,
      orderNumber: data.orderNumber ?? "",
      total: Number(data.total) || 0,
      trackingToken: typeof data.trackingToken === "string" ? data.trackingToken : undefined,
    };
  }
  return {
    ok: false,
    status: res.status,
    code: data?.code || "ORDER_SAVE_FAILED",
    productNames: Array.isArray(data?.productNames) ? data.productNames : undefined,
    minOrder: typeof data?.minOrder === "number" ? data.minOrder : undefined,
    nextAt: typeof data?.nextAt === "string" ? data.nextAt : null,
    reason: typeof data?.reason === "string" ? data.reason : undefined,
  };
}
