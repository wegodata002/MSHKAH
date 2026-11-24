import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  type Unsubscribe,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase";
import { sanitizeFirestoreData, findUndefinedPaths } from "@/lib/firebase/sanitize-firestore-data";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { ServiceError, type ServiceResult, success, failure } from "@/lib/errors";
import { mapOrder } from "@/lib/mappers";
import { selectedModifierToFirestore } from "@/lib/mappers/modifier-mappers";
import { orderSchema, type OrderInput } from "@/lib/validation/schemas";
import { forcePickupForNewOrder } from "@/lib/orders/fulfillment";
import { toIsoTimestamp } from "@/lib/dates/normalize";
import type { VerifiedPayment } from "@/lib/orders/dashboard";
import { normalizeOrderStatus, toStoredOrderStatus } from "@/lib/orders/status";
import { isViewOnlyMenuSurface } from "@/lib/domains/host-routing";
import {
  requestOrderCancelledEmailNotification,
  requestOrderUpdatedEmailNotification,
} from "@/lib/email/client-notify";
import {
  computeSignificantOrderChanges,
  fingerprintChanges,
} from "@/lib/email/significant-diff";
import { nowTimestamp } from "@/types/firestore";
import { calculateLineTotal } from "@/lib/product-builder/engine";
import { normalizeCouponCode } from "@/lib/orders/coupons";
import type { Order, OrderStatus, OrderItem, PaymentStatus } from "@/types";
import type { FirestoreOrder, FirestoreOrderItem, FirestoreDoc } from "@/types/firestore";

const ORDER_SAVE_FAILED_CODE = "ORDER_SAVE_FAILED";

function docToOrder(id: string, data: DocumentData): FirestoreDoc<FirestoreOrder> {
  return { id, ...(data as FirestoreOrder) };
}

function orderItemToFirestore(item: OrderItem): FirestoreOrderItem {
  const firestoreItem: FirestoreOrderItem = {
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    price: item.price,
  };

  if (item.basePrice != null) {
    firestoreItem.basePrice = item.basePrice;
  }

  const notes = item.notes?.trim();
  if (notes) {
    firestoreItem.notes = notes;
  }

  const kitchenNotes = item.kitchenNotes?.filter(Boolean);
  if (kitchenNotes?.length) {
    firestoreItem.kitchenNotes = kitchenNotes;
  }

  if (item.modifiers?.length) {
    firestoreItem.modifiers = item.modifiers.map(selectedModifierToFirestore);
  }

  return firestoreItem;
}

function buildFirestoreOrder(
  parsed: OrderInput,
  orderNumber: string,
  now: Timestamp
): FirestoreOrder {
  const order: FirestoreOrder = {
    orderNumber,
    customerId: parsed.customerId,
    customerName: parsed.customerName,
    items: parsed.items.map(orderItemToFirestore),
    status: parsed.status,
    subtotal: parsed.subtotal,
    discount: parsed.discount ?? 0,
    delivery: parsed.delivery ?? 0,
    total: parsed.total,
    paymentMethod: parsed.paymentMethod ?? "cash",
    paymentStatus: parsed.paymentStatus ?? "pending",
    notes: parsed.notes?.trim() ?? "",
    createdAt: now,
    receivedAt: now,
  };
  if (parsed.customerPhone?.trim()) order.customerPhone = parsed.customerPhone.trim();
  if (parsed.customerEmail?.trim()) order.customerEmail = parsed.customerEmail.trim().toLowerCase();
  if (parsed.customerFullName?.trim() || parsed.customerName?.trim()) {
    order.customerFullName = (parsed.customerFullName || parsed.customerName).trim();
  }
  if (parsed.orderType) order.orderType = parsed.orderType;
  if (parsed.deliveryAddress?.trim()) order.deliveryAddress = parsed.deliveryAddress.trim();
  if (parsed.locale) order.locale = parsed.locale;
  if (parsed.isTestOrder) order.isTestOrder = true;
  const couponCode = normalizeCouponCode(parsed.couponCode);
  if (couponCode) order.couponCode = couponCode;
  return order;
}

function filterOrders(
  orders: Order[],
  filters?: { search?: string; status?: OrderStatus | "all" }
): Order[] {
  let result = [...orders];

  if (filters?.status && filters.status !== "all") {
    result = result.filter((o) => o.status === filters.status);
  }

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q)
    );
  }

  return result.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const tail = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
  return `MC-${year}-${tail.slice(-8)}`;
}

export async function getOrders(filters?: {
  search?: string;
  status?: OrderStatus | "all";
}): Promise<Order[]> {
  try {
    const db = getDb();
    const q = query(
      collection(db, COLLECTIONS.orders),
      orderBy("createdAt", "desc")
    );
    const snapshot = await getDocs(q);
    const orders = snapshot.docs.map((d) =>
      mapOrder(docToOrder(d.id, d.data()))
    );
    return filterOrders(orders, filters);
  } catch (error) {
    throw new ServiceError(
      error instanceof Error ? error.message : "Failed to fetch orders",
      "ORDERS_READ_FAILED"
    );
  }
}

export async function getOrderById(id: string): Promise<Order | undefined> {
  try {
    const db = getDb();
    const snap = await getDoc(doc(db, COLLECTIONS.orders, id));
    if (!snap.exists()) return undefined;
    return mapOrder(docToOrder(snap.id, snap.data()));
  } catch (error) {
    throw new ServiceError(
      error instanceof Error ? error.message : "Failed to fetch order",
      "ORDER_READ_FAILED"
    );
  }
}

export async function getOrdersByCustomer(customerId: string): Promise<Order[]> {
  try {
    const orders = await getOrders();
    return orders.filter((o) => o.customerId === customerId);
  } catch (error) {
    throw new ServiceError(
      error instanceof Error ? error.message : "Failed to fetch customer orders",
      "ORDERS_BY_CUSTOMER_FAILED"
    );
  }
}

export async function getOrderStats(): Promise<{
  total: number;
  pending: number;
  confirmed: number;
  preparing: number;
  ready: number;
  delivered: number;
  cancelled: number;
}> {
  try {
    const orders = await getOrders();
    return {
      total: orders.length,
      pending: orders.filter((o) => o.status === "pending").length,
      confirmed: orders.filter((o) => o.status === "confirmed").length,
      preparing: orders.filter((o) => o.status === "preparing").length,
      ready: orders.filter((o) => o.status === "ready").length,
      delivered: orders.filter((o) => o.status === "delivered").length,
      cancelled: orders.filter((o) => o.status === "cancelled").length,
    };
  } catch (error) {
    throw new ServiceError(
      error instanceof Error ? error.message : "Failed to fetch order stats",
      "ORDER_STATS_FAILED"
    );
  }
}

export function subscribeToPaymentFacts(
  onData: (payments: VerifiedPayment[]) => void,
  onError: (error: string) => void
): Unsubscribe {
  try {
    return onSnapshot(
      collection(getDb(), COLLECTIONS.payments),
      (snapshot) => {
        onData(
          snapshot.docs.flatMap((item) => {
            const data = item.data() as {
              orderId?: string;
              status?: string;
              amount?: number;
              paidAt?: unknown;
              refundAmount?: number;
              provider?: string;
            };
            if (!data.orderId) return [];
            return [{
              orderId: data.orderId,
              status: data.status ?? null,
              amount: typeof data.amount === "number" ? data.amount : null,
              paidAt: toIsoTimestamp(data.paidAt),
              refundAmount: typeof data.refundAmount === "number" ? data.refundAmount : null,
              provider: data.provider ?? null,
            }];
          })
        );
      },
      (error) => onError(error.message)
    );
  } catch (error) {
    onError(error instanceof Error ? error.message : "Failed to subscribe to payments");
    return () => {};
  }
}

export function subscribeToOrders(
  filters: { search?: string; status?: OrderStatus | "all" } | undefined,
  onData: (orders: Order[]) => void,
  onError: (error: string) => void
): Unsubscribe {
  try {
    const db = getDb();
    const q = query(
      collection(db, COLLECTIONS.orders),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(
      q,
      (snapshot) => {
        const orders = snapshot.docs.map((d) =>
          mapOrder(docToOrder(d.id, d.data()))
        );
        onData(filterOrders(orders, filters));
      },
      (error) => onError(error.message)
    );
  } catch (error) {
    onError(error instanceof Error ? error.message : "Failed to subscribe to orders");
    return () => {};
  }
}

export async function createOrder(input: OrderInput): Promise<ServiceResult<Order>> {
  try {
    if (
      typeof window !== "undefined" &&
      isViewOnlyMenuSurface(window.location.hostname, window.location.pathname)
    ) {
      return failure(
        new ServiceError("Ordering is disabled on the menu display", "VIEW_ONLY_MENU")
      );
    }
    // Keep delivery fee at 0; allow pickup/delivery type + address when provided.
    const parsed = forcePickupForNewOrder(orderSchema.parse(input));
    const db = getDb();
    const orderNumber = await generateOrderNumber();
    const now = nowTimestamp();

    const rawOrder = buildFirestoreOrder(parsed, orderNumber, now);
    const undefinedPaths = findUndefinedPaths(rawOrder);
    if (undefinedPaths.length > 0) {
      console.warn("[createOrder] undefined fields before sanitize:", undefinedPaths, rawOrder);
    }

    const orderData = sanitizeFirestoreData(rawOrder);

    const ref = await addDoc(collection(db, COLLECTIONS.orders), orderData);
    return success(mapOrder({ id: ref.id, ...orderData } as FirestoreDoc<FirestoreOrder>));
  } catch (error) {
    console.error("[createOrder] failed:", error);
    return failure(new ServiceError("Order save failed", ORDER_SAVE_FAILED_CODE));
  }
}

export async function updateOrder(
  id: string,
  input: Partial<OrderInput & { orderNumber?: string }>
): Promise<ServiceResult<Order>> {
  try {
    const db = getDb();
    const ref = doc(db, COLLECTIONS.orders, id);
    const patch = sanitizeFirestoreData(input);
    await updateDoc(ref, patch);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return failure(new ServiceError("Order not found", "NOT_FOUND"));
    }
    return success(mapOrder(docToOrder(snap.id, snap.data())));
  } catch (error) {
    console.error("[updateOrder] failed:", error);
    return failure(new ServiceError("Order save failed", ORDER_SAVE_FAILED_CODE));
  }
}

export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
  metadata?: { cancelReason?: string; cancelledBy?: string }
): Promise<ServiceResult<void>> {
  try {
    const stored = toStoredOrderStatus(normalizeOrderStatus(status));
    const ref = doc(getDb(), COLLECTIONS.orders, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return failure(new ServiceError("Order not found", "NOT_FOUND"));
    }
    const current = snap.data() as FirestoreOrder;
    const stamp = serverTimestamp();
    const patch: Record<string, unknown> = { status: stored };

    if (stored === "pending" && !current.receivedAt) patch.receivedAt = stamp;
    if (stored === "confirmed" && !current.confirmedAt) patch.confirmedAt = stamp;
    if (stored === "preparing" && !current.preparationStartedAt) patch.preparationStartedAt = stamp;
    if (stored === "ready" && !current.readyAt) patch.readyAt = stamp;
    if (stored === "delivered") {
      if (!current.deliveredAt) patch.deliveredAt = stamp;
      if (!current.completedAt) patch.completedAt = stamp;
    }
    if (stored === "cancelled") {
      if (!current.cancelledAt) patch.cancelledAt = stamp;
      patch.cancelReason = metadata?.cancelReason?.trim() || "other";
      patch.cancelledBy = metadata?.cancelledBy?.trim() || "admin";
    }

    await updateDoc(ref, patch);
    if (stored === "cancelled") {
      requestOrderCancelledEmailNotification(id);
    }
    return success(undefined);
  } catch (error) {
    console.error("[updateOrderStatus] failed:", error);
    return failure(new ServiceError("Order status update failed", ORDER_SAVE_FAILED_CODE));
  }
}

/**
 * Staff confirm that a cash / pay-at-pickup order was paid at the counter.
 * Card (HYP) orders are never marked here; their status comes from the payment provider.
 */
export async function markOrderCashPaid(id: string, paidBy: string): Promise<ServiceResult<void>> {
  try {
    const ref = doc(getDb(), COLLECTIONS.orders, id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      return failure(new ServiceError("Order not found", "NOT_FOUND"));
    }
    const current = snap.data() as FirestoreOrder;
    if (current.paymentStatus === "paid") return success(undefined);
    const method = (current.paymentMethod || "").toLowerCase();
    if (current.paymentProvider === "HYP" || method === "card") {
      return failure(new ServiceError("Card payments are confirmed by the payment provider", "CARD_ORDER"));
    }
    await updateDoc(ref, {
      paymentStatus: "paid",
      paidAt: serverTimestamp(),
      paidBy: paidBy.trim() || "admin",
      paidVia: "cash_counter",
    });
    return success(undefined);
  } catch (error) {
    console.error("[markOrderCashPaid] failed:", error);
    return failure(new ServiceError("Payment update failed", ORDER_SAVE_FAILED_CODE));
  }
}

export async function deleteOrder(id: string): Promise<ServiceResult<void>> {
  try {
    const db = getDb();
    await deleteDoc(doc(db, COLLECTIONS.orders, id));
    return success(undefined);
  } catch (error) {
    return failure(error, "Failed to delete order");
  }
}

export async function updateOrderItemExtras(
  orderId: string,
  itemIndex: number,
  update: {
    price: number;
    modifiers?: OrderItem["modifiers"];
    notes?: string;
    kitchenNotes?: string[];
  }
): Promise<ServiceResult<Order>> {
  const order = await getOrderById(orderId);
  if (!order) {
    return failure(new ServiceError("Order not found", "NOT_FOUND"));
  }
  if (itemIndex < 0 || itemIndex >= order.items.length) {
    return failure(new ServiceError("Invalid item index", "INVALID_ITEM"));
  }

  const before = order;

  const items = order.items.map((item, i) => {
    if (i !== itemIndex) return item;
    const next: OrderItem = {
      ...item,
      price: update.price,
    };
    if (update.modifiers?.length) {
      next.modifiers = update.modifiers;
    } else {
      delete next.modifiers;
    }
    const note = update.notes?.trim();
    if (note) next.notes = note;
    else delete next.notes;
    if (update.kitchenNotes?.length) next.kitchenNotes = update.kitchenNotes;
    else delete next.kitchenNotes;
    return next;
  });

  const subtotal = items.reduce(
    (sum, item) => sum + calculateLineTotal(item.price, item.quantity),
    0
  );
  const total = subtotal + (order.delivery ?? 0) - (order.discount ?? 0);

  const result = await updateOrder(orderId, {
    items,
    subtotal,
    total: Math.max(total, 0.01),
  });

  if (result.success) {
    const changes = computeSignificantOrderChanges(before, result.data);
    if (changes.length > 0) {
      requestOrderUpdatedEmailNotification({
        orderId,
        changes,
        fingerprint: fingerprintChanges(changes),
      });
    }
  }

  return result;
}
