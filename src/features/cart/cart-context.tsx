"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Product, CartItem } from "@/types";
import type { SelectedModifier } from "@/types/modifiers";
import {
  calculateUnitPrice,
  calculateLineTotal,
  selectionsFingerprint,
} from "@/lib/product-builder/engine";
import { NEW_ORDER_FULFILLMENT } from "@/lib/orders/fulfillment";
import { couponRate, normalizeCouponCode, type CouponCheck } from "@/lib/orders/coupons";
import type { CouponName } from "@/lib/coupons/store-coupons";
import { isPersonalCouponCode } from "@/lib/loyalty/coupons";
import { isViewOnlyMenuSurface } from "@/lib/domains/host-routing";
import { priceNow } from "@/lib/sales/sale-price";
import { priceCartLine, saleChanges, type SaleChange } from "@/lib/sales/cart-pricing";
import { useSaleClock } from "@/features/sales/sale-price-view";
import { subscribeToProducts } from "@/services/productService";

interface CartState {
  items: CartItem[];
  isOpen: boolean;
  couponCode: string;
  /** Percent coupons: the rate (0–1) shown in the cart. The server prices the order on its own. */
  couponDiscount: number;
  /** Store coupons in shekels (₪ off the products); 0 for percent coupons. */
  couponFixed?: number;
  /** Store coupons: products needed before the discount applies (0 = none). */
  couponMinOrder?: number;
  couponName?: CouponName | null;
}

type CouponTerms = { discount: number; fixed?: number; minOrder?: number; name?: CouponName | null };

type CartAction =
  | {
      type: "ADD_CONFIGURED_ITEM";
      product: Product;
      selections: SelectedModifier[];
      unitPrice: number;
      quantity: number;
      notes?: string;
      configurable?: boolean;
    }
  | { type: "REMOVE_ITEM"; lineId: string }
  | { type: "UPDATE_QUANTITY"; lineId: string; quantity: number }
  | {
      type: "UPDATE_CONFIGURED_ITEM";
      lineId: string;
      selections: SelectedModifier[];
      unitPrice: number;
      quantity: number;
      notes?: string;
    }
  | { type: "HYDRATE"; state: Partial<CartState> }
  | { type: "CLEAR_CART" }
  | { type: "OPEN_CART" }
  | { type: "CLOSE_CART" }
  | { type: "TOGGLE_CART" }
  | ({ type: "SET_COUPON"; code: string } & CouponTerms)
  | { type: "REMOVE_COUPON" };

interface AddItemOptions {
  selections?: SelectedModifier[];
  unitPrice?: number;
  notes?: string;
  quantity?: number;
  configurable?: boolean;
}

interface CartContextValue {
  items: CartItem[];
  isOpen: boolean;
  itemCount: number;
  subtotal: number;
  discount: number;
  /** Always 0 — business is pickup-only. Kept for UI compatibility. */
  deliveryFee: number;
  total: number;
  couponCode: string;
  /** The applied store coupon's name (Admin → Coupons), in the three languages. */
  couponName: CouponName | null;
  /** The cart is below the applied coupon's minimum order: no discount until it is reached. */
  couponBelowMinimum: boolean;
  couponMinOrder: number;
  /** The minimum of the last coupon refused for "min_order" (for its message, right after applyCoupon). */
  lastCouponMinOrder: () => number;
  /** Always pickup — business does not offer delivery. */
  orderType: typeof NEW_ORDER_FULFILLMENT;
  /** What the sales saved on the products in the cart (regular − sale price), 0 when none. */
  saleSavings: number;
  /** Products whose sale started or ended while in the cart (their price was updated). */
  saleNotices: Array<SaleChange & { product: Product }>;
  dismissSaleNotices: () => void;
  addItem: (product: Product, options?: AddItemOptions) => void;
  removeItem: (lineId: string) => void;
  updateQuantity: (lineId: string, quantity: number) => void;
  updateConfiguredItem: (
    lineId: string,
    options: Required<Pick<AddItemOptions, "selections" | "unitPrice" | "quantity">> &
      Pick<AddItemOptions, "notes">
  ) => void;
  /**
   * Applies the coupon only when it is valid; returns why not otherwise. Personal club codes
   * (MK-XXXX-XXXX) are checked with the server; the order route checks them again.
   */
  applyCoupon: (code: string) => Promise<CouponCheck>;
  removeCoupon: () => void;
  clearCart: () => void;
  openCart: () => void;
  closeCart: () => void;
  toggleCart: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);
const CART_STORAGE_KEY = "mishkat-cart-v2";

function newLineId(
  product: Product,
  selections: SelectedModifier[],
  notes?: string
): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return selectionsFingerprint(product.id, selections, notes) + Date.now();
}

/** Display rate of a personal club code saved in the browser: 0 < rate ≤ 50%, else dropped. */
function personalDisplayRate(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 0.5 ? n : 0;
}

type PersonalCouponAnswer = { ok: true; code: string; percent: number } | { ok: false; reason?: CouponCheck };

async function checkPersonalCoupon(code: string): Promise<PersonalCouponAnswer | null> {
  try {
    const res = await fetch("/api/club/coupon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    return (await res.json()) as PersonalCouponAnswer;
  } catch {
    return null;
  }
}

type StoreCouponAnswer =
  | { ok: true; coupon: { code: string; name: CouponName; type: "percent" | "fixed"; value: number; minOrder: number } }
  | { ok: false; reason?: CouponCheck; minOrder?: number };

/** Store coupon (Admin → Coupons): the server decides (date, club members only, minimum, once per customer). */
async function checkStoreCouponOnServer(code: string, subtotal: number): Promise<StoreCouponAnswer | null> {
  try {
    const res = await fetch("/api/coupons/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, subtotal }),
    });
    return (await res.json()) as StoreCouponAnswer;
  } catch {
    return null;
  }
}

function termsOf(coupon: Extract<StoreCouponAnswer, { ok: true }>["coupon"]): CouponTerms {
  return coupon.type === "fixed"
    ? { discount: 0, fixed: coupon.value, minOrder: coupon.minOrder, name: coupon.name }
    : { discount: coupon.value / 100, fixed: 0, minOrder: coupon.minOrder, name: coupon.name };
}

const NO_COUPON = { couponCode: "", couponDiscount: 0, couponFixed: 0, couponMinOrder: 0, couponName: null } as const;

/** A coupon applies to one order only: drop it once the cart is empty. */
function resetCouponIfEmpty(state: CartState): CartState {
  return state.items.length === 0 && (state.couponCode || state.couponDiscount || state.couponFixed)
    ? { ...state, ...NO_COUPON }
    : state;
}

/** Saved store-coupon terms, for display only until the server answers again (capped). */
function savedTerms(state: Partial<CartState>): CouponTerms {
  const rate = Number(state.couponDiscount);
  const fixed = Number(state.couponFixed);
  const min = Number(state.couponMinOrder);
  return {
    discount: Number.isFinite(rate) && rate > 0 && rate <= 0.9 ? rate : 0,
    fixed: Number.isFinite(fixed) && fixed > 0 && fixed <= 1000 ? fixed : 0,
    minOrder: Number.isFinite(min) && min > 0 ? min : 0,
    name: state.couponName && typeof state.couponName === "object" ? state.couponName : null,
  };
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_CONFIGURED_ITEM": {
      const fingerprint = selectionsFingerprint(
        action.product.id,
        action.selections,
        action.notes
      );
      const existing = state.items.find(
        (i) =>
          selectionsFingerprint(i.product.id, i.selections, i.notes) === fingerprint
      );
      if (existing) {
        return {
          ...state,
          items: state.items.map((i) =>
            i.lineId === existing.lineId
              ? { ...i, quantity: i.quantity + action.quantity }
              : i
          ),
        };
      }
      return {
        ...state,
        items: [
          ...state.items,
          {
            lineId: newLineId(action.product, action.selections, action.notes),
            product: action.product,
            quantity: action.quantity,
            selections: action.selections,
            unitPrice: action.unitPrice,
            notes: action.notes,
            configurable: action.configurable,
          },
        ],
      };
    }
    case "REMOVE_ITEM":
      return resetCouponIfEmpty({
        ...state,
        items: state.items.filter((i) => i.lineId !== action.lineId),
      });
    case "UPDATE_QUANTITY": {
      if (action.quantity <= 0) {
        return resetCouponIfEmpty({
          ...state,
          items: state.items.filter((i) => i.lineId !== action.lineId),
        });
      }
      return {
        ...state,
        items: state.items.map((i) =>
          i.lineId === action.lineId ? { ...i, quantity: action.quantity } : i
        ),
      };
    }
    case "UPDATE_CONFIGURED_ITEM": {
      // Edit of a line already in the cart (pen in the cart, checkout summary, assistant).
      const target = state.items.find((item) => item.lineId === action.lineId);
      if (!target) return state;
      const updated: CartItem = {
        ...target,
        selections: action.selections,
        unitPrice: action.unitPrice,
        quantity: action.quantity,
        notes: action.notes,
      };
      // Now the same as another line (product + add-ons + note)? Merge into the edited line.
      const fingerprint = selectionsFingerprint(updated.product.id, updated.selections, updated.notes);
      const twin = state.items.find(
        (item) =>
          item.lineId !== action.lineId &&
          selectionsFingerprint(item.product.id, item.selections, item.notes) === fingerprint
      );
      return {
        ...state,
        items: state.items
          .filter((item) => item !== twin)
          .map((item) =>
            item.lineId === action.lineId
              ? twin
                ? { ...updated, quantity: updated.quantity + twin.quantity }
                : updated
              : item
          ),
      };
    }
    case "HYDRATE": {
      // Never trust a stored rate: recompute it from the coupon table.
      // Unknown codes are dropped; an empty cart never restores a coupon.
      const code = normalizeCouponCode(action.state.couponCode ?? state.couponCode);
      // A personal club code keeps its saved rate for display (capped); it is re-checked with the
      // server right after loading, and the server prices the order on its own anyway.
      // A store coupon keeps its saved terms for display (capped) and is checked with the server right
      // after loading too (MISHKAT10 saved by an older cart still shows its 10% meanwhile).
      const items = Array.isArray(action.state.items) ? action.state.items : state.items;
      if (isPersonalCouponCode(code)) {
        const rate = personalDisplayRate(action.state.couponDiscount);
        return resetCouponIfEmpty({ ...state, items, ...NO_COUPON, couponCode: rate > 0 ? code : "", couponDiscount: rate, isOpen: state.isOpen });
      }
      const terms = savedTerms(action.state);
      const rate = terms.discount || (terms.fixed ? 0 : couponRate(code));
      const applies = !!code && (rate > 0 || (terms.fixed ?? 0) > 0);
      return resetCouponIfEmpty({
        ...state,
        items,
        ...NO_COUPON,
        ...(applies ? { couponCode: code, couponDiscount: rate, couponFixed: terms.fixed, couponMinOrder: terms.minOrder, couponName: terms.name } : {}),
        // Loading the saved cart never closes a cart already opened (e.g. by /cart a moment earlier).
        isOpen: state.isOpen,
      });
    }
    case "CLEAR_CART":
      // After a successful order (cash or HYP success page) the coupon is used up.
      return { ...state, items: [], ...NO_COUPON };
    case "OPEN_CART":
      return { ...state, isOpen: true };
    case "CLOSE_CART":
      return { ...state, isOpen: false };
    case "TOGGLE_CART":
      return { ...state, isOpen: !state.isOpen };
    case "SET_COUPON":
      return {
        ...state,
        couponCode: action.code,
        couponDiscount: action.discount,
        couponFixed: action.fixed ?? 0,
        couponMinOrder: action.minOrder ?? 0,
        couponName: action.name ?? null,
      };
    case "REMOVE_COUPON":
      return { ...state, ...NO_COUPON };
    default:
      return state;
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, {
    items: [],
    isOpen: false,
    ...NO_COUPON,
  });
  const [hydrated, setHydrated] = useState(false);
  const lastCouponMinOrderRef = useRef(0);
  const saleClock = useSaleClock();
  // While the cart has products: the live menu (same query as the menu, so the listener is shared),
  // for prices changed meanwhile (a sale ended in the admin, a new price).
  const [liveProducts, setLiveProducts] = useState<ReadonlyMap<string, Product>>(new Map());
  const hasItems = state.items.length > 0;
  useEffect(() => {
    if (!hasItems) return;
    return subscribeToProducts(
      undefined,
      (list) => setLiveProducts(new Map(list.map((p) => [p.id, p]))),
      () => {}
    );
  }, [hasItems]);
  // Each line priced now (sale price while a sale is on + add-ons at full price), as the server will.
  const items: CartItem[] = useMemo(
    () =>
      state.items.map((item) => {
        const live = liveProducts.get(item.product.id);
        const priced = priceCartLine(item, live, saleClock || Date.now());
        return { ...item, ...(live ? { product: live } : {}), unitPrice: priced.unitPrice, regularUnitPrice: priced.regularUnitPrice, sale: priced.sale };
      }),
    [state.items, liveProducts, saleClock]
  );
  const saleSavings = Math.round(items.reduce((sum, i) => sum + Math.max(0, (i.regularUnitPrice ?? i.unitPrice) - i.unitPrice) * i.quantity, 0) * 100) / 100;
  // A sale that started or ended while the product is in the cart: say so once.
  const seenSales = useRef(new Map<string, string | null>());
  const [saleNotices, setSaleNotices] = useState<Array<SaleChange & { product: Product }>>([]);
  const saleKey = items.map((i) => `${i.lineId}:${i.sale?.saleId ?? ""}`).join("|");
  useEffect(() => {
    const lines = items.map((i) => ({ lineId: i.lineId, productId: i.product.id, saleId: i.sale?.saleId ?? null }));
    const changes = saleChanges(seenSales.current, lines);
    seenSales.current = new Map(lines.map((l) => [l.lineId, l.saleId]));
    if (changes.length > 0) {
      setSaleNotices((prev) => [
        ...prev.filter((n) => !changes.some((c) => c.lineId === n.lineId)),
        ...changes.map((c) => ({ ...c, product: items.find((i) => i.lineId === c.lineId)!.product })),
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a line's sale changes
  }, [saleKey]);
  const dismissSaleNotices = useCallback(() => setSaleNotices([]), []);
  const lastCouponMinOrder = useCallback(() => lastCouponMinOrderRef.current, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<CartState>;
        if (Array.isArray(saved.items)) {
          dispatch({ type: "HYDRATE", state: saved });
        }
      }
    } catch {
      localStorage.removeItem(CART_STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        items: state.items,
        couponCode: state.couponCode,
        couponDiscount: state.couponDiscount,
        couponFixed: state.couponFixed ?? 0,
        couponMinOrder: state.couponMinOrder ?? 0,
        couponName: state.couponName ?? null,
      })
    );
  }, [hydrated, state.couponCode, state.couponDiscount, state.couponFixed, state.couponMinOrder, state.couponName, state.items]);

  const addItem = useCallback((product: Product, options?: AddItemOptions) => {
    if (
      typeof window !== "undefined" &&
      isViewOnlyMenuSurface(window.location.hostname, window.location.pathname)
    ) {
      return;
    }
    const selections = options?.selections ?? [];
    const unitPrice =
      options?.unitPrice ?? calculateUnitPrice(priceNow(product, Date.now()).price, selections);
    dispatch({
      type: "ADD_CONFIGURED_ITEM",
      product,
      selections,
      unitPrice,
      quantity: options?.quantity ?? 1,
      notes: options?.notes,
      configurable: options?.configurable,
    });
  }, []);

  const removeItem = useCallback((lineId: string) => {
    dispatch({ type: "REMOVE_ITEM", lineId });
  }, []);

  const updateQuantity = useCallback((lineId: string, quantity: number) => {
    dispatch({ type: "UPDATE_QUANTITY", lineId, quantity });
  }, []);

  const updateConfiguredItem = useCallback(
    (
      lineId: string,
      options: Required<
        Pick<AddItemOptions, "selections" | "unitPrice" | "quantity">
      > &
        Pick<AddItemOptions, "notes">
    ) => {
      dispatch({
        type: "UPDATE_CONFIGURED_ITEM",
        lineId,
        selections: options.selections,
        unitPrice: options.unitPrice,
        quantity: options.quantity,
        notes: options.notes,
      });
    },
    []
  );

  const clearCart = useCallback(() => dispatch({ type: "CLEAR_CART" }), []);
  const openCart = useCallback(() => dispatch({ type: "OPEN_CART" }), []);
  const closeCart = useCallback(() => dispatch({ type: "CLOSE_CART" }), []);
  const toggleCart = useCallback(() => dispatch({ type: "TOGGLE_CART" }), []);

  // A personal club code restored from this browser is checked again (used elsewhere, expired,
  // logged out…); an invalid one is removed, a valid one gets the server's rate.
  // A store coupon restored from this browser is checked again too (disabled, expired, club only…);
  // below its minimum it stays (the cart shows what is missing), anything else removes it.
  const recheckedCode = useRef("");
  const subtotalRef = useRef(0);
  useEffect(() => {
    if (!hydrated || !state.couponCode || recheckedCode.current === state.couponCode) return;
    const code = state.couponCode;
    recheckedCode.current = code;
    if (isPersonalCouponCode(code)) {
      void checkPersonalCoupon(code).then((answer) => {
        if (!answer) return;
        if (answer.ok) dispatch({ type: "SET_COUPON", code, discount: answer.percent / 100 });
        else dispatch({ type: "REMOVE_COUPON" });
      });
      return;
    }
    void checkStoreCouponOnServer(code, subtotalRef.current).then((answer) => {
      if (!answer) return;
      if (answer.ok) dispatch({ type: "SET_COUPON", code, ...termsOf(answer.coupon) });
      else if (answer.reason !== "min_order") dispatch({ type: "REMOVE_COUPON" });
    });
  }, [hydrated, state.couponCode]);

  const applyCoupon = useCallback(
    async (code: string): Promise<CouponCheck> => {
      const normalized = normalizeCouponCode(code);
      if (isPersonalCouponCode(normalized)) {
        const answer = await checkPersonalCoupon(normalized);
        if (!answer) return "invalid";
        if (!answer.ok) return answer.reason && answer.reason !== "ok" ? answer.reason : "invalid";
        recheckedCode.current = normalized;
        dispatch({ type: "SET_COUPON", code: normalized, discount: answer.percent / 100 });
        return "ok";
      }
      if (!normalized) return "invalid";
      const currentSubtotal = items.reduce((sum, item) => sum + calculateLineTotal(item.unitPrice, item.quantity), 0);
      // One coupon per order: a new code replaces the one applied (store or personal).
      const answer = await checkStoreCouponOnServer(normalized, currentSubtotal);
      if (!answer) return "invalid";
      if (!answer.ok) {
        if (answer.reason === "min_order") lastCouponMinOrderRef.current = Number(answer.minOrder) || 0;
        return answer.reason && answer.reason !== "ok" ? answer.reason : "invalid";
      }
      recheckedCode.current = normalized;
      dispatch({ type: "SET_COUPON", code: normalized, ...termsOf(answer.coupon) });
      return "ok";
    },
    [items]
  );

  const removeCoupon = useCallback(() => dispatch({ type: "REMOVE_COUPON" }), []);

  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce(
    (sum, item) =>
      sum + calculateLineTotal(item.unitPrice, item.quantity),
    0
  );
  subtotalRef.current = subtotal;
  const couponMinOrder = state.couponMinOrder ?? 0;
  const couponBelowMinimum = !!state.couponCode && couponMinOrder > 0 && subtotal < couponMinOrder;
  const discount = couponBelowMinimum
    ? 0
    : (state.couponFixed ?? 0) > 0
      ? Math.min(state.couponFixed ?? 0, subtotal)
      : subtotal * state.couponDiscount;
  const deliveryFee = 0;
  const total = subtotal - discount;

  return (
    <CartContext.Provider
      value={{
        items,
        isOpen: state.isOpen,
        itemCount,
        subtotal,
        discount,
        deliveryFee,
        total,
        couponCode: state.couponCode,
        couponName: state.couponName ?? null,
        couponBelowMinimum,
        couponMinOrder,
        lastCouponMinOrder,
        orderType: NEW_ORDER_FULFILLMENT,
        saleSavings,
        saleNotices,
        dismissSaleNotices,
        addItem,
        removeItem,
        updateQuantity,
        updateConfiguredItem,
        applyCoupon,
        removeCoupon,
        clearCart,
        openCart,
        closeCart,
        toggleCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within CartProvider");
  return context;
}
