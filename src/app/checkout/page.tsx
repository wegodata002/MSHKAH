"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { rememberMyOrder } from "@/lib/orders/my-orders";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  Phone,
  User,
  MessageSquare,
  CheckCircle2,
  Banknote,
  CreditCard,
  ShoppingBag,
  Tag,
  X,
  Trash2,
} from "lucide-react";
import { Header } from "@/components/layout/header";
import { CheckoutProgress } from "@/components/checkout/checkout-progress";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT, useLocale } from "@/components/providers/locale-provider";
import { useLocalizedProduct } from "@/hooks/useLocalizedContent";
import { useCart } from "@/features/cart/cart-context";
import { getOrCreateGuestCustomer, GUEST_CUSTOMER_ID } from "@/services";
import { cartToOrderItems, submitOrder, type SubmitOrderResult } from "@/lib/orders/submit-order-client";
import { couponMessageKey } from "@/lib/orders/coupons";
import { ClubCouponOffer } from "@/features/club/club-coupon-offer";
import { EditLineButton, useCartLineEditor } from "@/features/cart/cart-line-editor";
import { requestNewOrderEmailNotification, requestNewOrderPrintJob, requestCriticalCheckoutFailureNotification } from "@/lib/email/client-notify";
import { formatPrice, cn } from "@/lib/utils";
import { calculateLineTotal } from "@/lib/product-builder/engine";
import { formatLocalTime } from "@/lib/fulfillment/availability";
import { checkoutFingerprint } from "@/features/checkout/checkout-fingerprint";
import { zoneName } from "@/lib/fulfillment/settings";
import { useFulfillmentAvailability, describeNext } from "@/features/checkout/use-fulfillment-availability";
import {
  DeliveryZonePicker,
  OrderTypePicker,
  PickupTimeSelect,
  StoreContact,
  type CheckoutOrderType,
  type ZoneChoice,
} from "@/features/checkout/checkout-fulfillment";

function OrderLineItem({
  item,
  onRemove,
  onEdit,
}: {
  item: import("@/types").CartItem;
  onRemove: () => void;
  onEdit: (item: import("@/types").CartItem) => void;
}) {
  const t = useT();
  const localized = useLocalizedProduct(item.product);
  return (
    <div className="space-y-0.5 text-sm" data-summary-line={item.lineId}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 text-coffee/70">
          {item.quantity}× {localized.name}
        </span>
        <span>{formatPrice(calculateLineTotal(item.unitPrice, item.quantity))}</span>
        {/* Pen: change add-ons, quantity or note in the product window. */}
        <EditLineButton item={item} onEdit={onEdit} className="h-11 w-11 rounded-full hover:bg-beige/50" iconClassName="h-4 w-4" />
        {/* Same as the cart: remove right away, no confirmation. */}
        <button
          type="button"
          onClick={onRemove}
          data-remove-line
          className="-me-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-coffee/40 transition-colors hover:bg-red-50 hover:text-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-turquoise"
          aria-label={`${t("cart.remove")} ${localized.name}`}
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
      {item.selections.map((s) => (
        <p key={`${s.groupId}-${s.optionId}`} className="ps-3 text-xs text-coffee/45">
          + {s.optionName}
        </p>
      ))}
      {item.notes && (
        <p className="ps-3 text-xs text-coffee/45">
          {t("builder.notes")}: {item.notes}
        </p>
      )}
    </div>
  );
}

export default function CheckoutPage() {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const {
    items, subtotal, discount, total,
    clearCart, couponCode, applyCoupon, removeCoupon, removeItem,
  } = useCart();
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState<string | null>(null);
  // Pen in the order summary: edit a line (add-ons, quantity, note) in the product window.
  const { edit: editLine, editor: lineEditor } = useCartLineEditor();

  // Same logic as the cart panel (shared coupon table in cart-context).
  const handleCoupon = async () => {
    if (!couponInput.trim()) return;
    const check = await applyCoupon(couponInput);
    setCouponError(check === "ok" ? null : t(couponMessageKey(check)));
  };

  // Clearing the whole field cancels an applied coupon (same as ✕); partial edits don't.
  const handleCouponInputChange = (value: string) => {
    setCouponInput(value);
    // Any change to the code hides the old coupon message.
    setCouponError(null);
    if (!value.trim() && couponCode) removeCoupon();
  };

  // Keep an applied coupon visible in the field (e.g. applied in the cart or after reload).
  useEffect(() => {
    if (couponCode) setCouponInput((current) => (current.trim() ? current : couponCode));
  }, [couponCode]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  // What can be ordered now (opening hours, delivery hours and areas from the settings).
  // The browser only shows it; the server checks it again and prices the order.
  const availability = useFulfillmentAvailability();
  const [orderTypeChoice, setOrderType] = useState<CheckoutOrderType>("pickup");
  const [pickupTimeChoice, setPickupTime] = useState("");
  const [zoneChoice, setZoneChoice] = useState<ZoneChoice>("");
  const [address, setAddress] = useState("");
  const pickupOk = availability.pickup.available;
  const deliveryOk = availability.delivery?.available === true;
  // A type that is not available falls back to the one that is.
  const orderType: CheckoutOrderType =
    orderTypeChoice === "delivery"
      ? deliveryOk ? "delivery" : "pickup"
      : !pickupOk && deliveryOk ? "delivery" : "pickup";
  const slotTimes = availability.pickup.available ? availability.pickup.slots.map((s) => formatLocalTime(s)) : [];
  // A chosen time that has passed falls back to the earliest one.
  const pickupTime = slotTimes.includes(pickupTimeChoice) ? pickupTimeChoice : slotTimes[0] ?? "";
  const deliveryZone = availability.zones.find((z) => z.id === zoneChoice);
  const deliveryFee = orderType === "delivery" && deliveryZone ? deliveryZone.fee : 0;
  const belowMinimum = Boolean(deliveryZone && deliveryZone.minOrder > 0 && subtotal < deliveryZone.minOrder);
  const nothingAvailable = !availability.loading && !pickupOk && !deliveryOk;
  const canOrder =
    !availability.loading &&
    (orderType === "pickup" ? pickupOk && Boolean(pickupTime) : deliveryOk && Boolean(deliveryZone) && !belowMinimum);
  const displayTotal = total + deliveryFee;
  const [payment, setPayment] = useState<"cash" | "card">("cash");
  const [hypAvailability, setHypAvailability] = useState<"unknown" | "enabled" | "disabled">("unknown");
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Tracking link of the order just placed ("Track your order" on the confirmation screen).
  const [trackingHref, setTrackingHref] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments/hyp/status")
      .then(async (res) => {
        const data = (await res.json()) as { enabled?: boolean; missing?: string[] };
        if (cancelled) return;
        const hypAvailable = res.ok && data.enabled === true;
        setHypAvailability(hypAvailable ? "enabled" : "disabled");
        if (!hypAvailable) {
          const missing = Array.isArray(data.missing) && data.missing.length > 0
            ? data.missing.join(", ")
            : "status endpoint unavailable";
          console.warn(`[checkout] HYP disabled: missing ${missing}`);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHypAvailability("disabled");
          console.warn("[checkout] HYP disabled: status endpoint unavailable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (hypAvailability === "disabled" && payment === "card") setPayment("cash");
  }, [hypAvailability, payment]);

  // A card order that was created but not paid (the payment page failed to open) is reused on the
  // next try — but only while nothing changed. Any change to the cart, coupon, order type, area,
  // address, pickup time or payment method needs a new order, so forget the old one.
  const orderFingerprint = checkoutFingerprint({
    items,
    couponCode,
    orderType,
    zoneId: orderType === "delivery" ? deliveryZone?.id ?? "" : "",
    address: orderType === "delivery" ? address.trim() : "",
    pickupTime: orderType === "pickup" ? pickupTime : "",
    payment,
  });
  useEffect(() => {
    setPendingOrderId(null);
  }, [orderFingerprint]);

  const cardDisabled = hypAvailability === "disabled";

  if (items.length === 0 && !success) {
    return (
      <>
        <Header searchQuery="" onSearchChange={() => {}} />
        <div className="mx-auto max-w-lg px-4 py-12">
          <EmptyState
            icon={ShoppingBag}
            title={t("cart.empty")}
            description={t("cart.emptyHint")}
            actionLabel={t("cart.continueShopping")}
            actionHref="/"
          />
        </div>
      </>
    );
  }

  /** A clear message for orders the server turned down. */
  const orderErrorMessage = (result: Extract<SubmitOrderResult, { ok: false }>): string => {
    if (result.code === "PRODUCT_UNAVAILABLE" && result.productNames?.length) {
      return t("checkout.productUnavailable").replace("{items}", result.productNames.join(", "));
    }
    if (result.code === "PRODUCT_NOT_FOUND" || result.code === "PRODUCT_UNAVAILABLE") {
      return t("checkout.productMissing");
    }
    if (result.code === "RATE_LIMITED") return t("checkout.tooManyOrders");
    if (result.code === "PICKUP_TIME_UNAVAILABLE") return t("checkout.pickupTimeGone");
    if (result.code === "PICKUP_CLOSED" || result.code === "DELIVERY_UNAVAILABLE") {
      const next = result.nextAt ? new Date(result.nextAt) : null;
      return next && !Number.isNaN(next.getTime())
        ? t("checkout.closedNow").replace("{when}", describeNext(t, locale, next, new Date(), "at"))
        : t(result.code === "PICKUP_CLOSED" ? "checkout.pickupUnavailable" : "checkout.deliveryUnavailable");
    }
    if (result.code === "UNKNOWN_ZONE") return t("checkout.unknownZone");
    if (result.code === "COUPON_INVALID") {
      const reason = result.reason;
      return t(
        couponMessageKey(reason === "login_required" || reason === "used" || reason === "expired" ? reason : "invalid")
      );
    }
    if (result.code === "BELOW_MINIMUM" && result.minOrder) {
      return t("checkout.minimumError").replace("{min}", formatPrice(result.minOrder));
    }
    return t("checkout.orderSaveError");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) { setError(t("validation.required")); return; }
    if (!canOrder) return;
    if (orderType === "delivery" && !address.trim()) { setError(t("validation.required")); return; }

    setLoading(true);
    setError(null);
    try {
      void getOrCreateGuestCustomer();
      const customerResponse = await fetch("/api/checkout/customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      }).catch(() => null);
      const customerData = customerResponse?.ok
        ? ((await customerResponse.json()) as { customerId?: string })
        : null;
      const customerId = customerData?.customerId || GUEST_CUSTOMER_ID;

      // Same notes text as before (the printout drops the pickup line).
      const orderNotes = [
        notes.trim(),
        phone.trim() ? `${t("checkout.phone")}: ${phone.trim()}` : "",
        orderType === "delivery" ? t("checkout.delivery") : t("checkout.pickupFromStore", "איסוף עצמי מהעסק"),
        orderType === "delivery" ? `${t("checkout.address")}: ${address.trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      let orderId = pendingOrderId;
      let tracking: { token: string; orderNumber: string } | null = null;
      if (!orderId) {
        const result = await submitOrder({
          items: cartToOrderItems(items),
          customer: {
            id: customerId,
            name: name.trim(),
            phone: phone.trim(),
          },
          notes: orderNotes || undefined,
          locale,
          couponCode: couponCode || undefined,
          payment: payment === "card" ? "online" : orderType === "delivery" ? "courier" : "counter",
          fulfillment:
            orderType === "delivery" && deliveryZone
              ? { type: "delivery", zoneId: deliveryZone.id, address: address.trim() }
              : { type: "pickup", pickupTime: pickupTime || undefined },
        });
        if (!result.ok) {
          console.error("[checkout] order failed:", result.code, result.status);
          if (result.status >= 500 || result.status === 0) {
            requestCriticalCheckoutFailureNotification({
              message: `Order create failed (${result.status})`,
              code: result.code,
            });
          }
          setError(orderErrorMessage(result));
          return;
        }
        orderId = result.id;
        if (result.trackingToken) tracking = { token: result.trackingToken, orderNumber: result.orderNumber };
        if (customerId !== GUEST_CUSTOMER_ID) {
          await fetch("/api/checkout/customer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ customerId, orderId }),
          }).catch(() => null);
        }
      }

      if (payment === "card") {
        setPendingOrderId(orderId);
        const payRes = await fetch("/api/payments/hyp/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId,
            customerName: name.trim(),
            customerPhone: phone.trim(),
          }),
        });
        const payData = (await payRes.json()) as { ok?: boolean; paymentUrl?: string };
        if (!payRes.ok || !payData.ok || !payData.paymentUrl) {
          setError(t("checkout.hypOpenError"));
          return;
        }
        window.location.assign(payData.paymentUrl);
        return;
      }

      requestNewOrderEmailNotification(orderId);
      requestNewOrderPrintJob(orderId);

      // Cash: the order is final now. Keep it in "My orders" on this device and open its tracking page.
      // (Card: kept once the payment succeeds, on the payment success page.)
      const nextHref = tracking ? `/orders/${encodeURIComponent(tracking.token)}` : "/orders";
      if (tracking) rememberMyOrder(tracking);
      setTrackingHref(nextHref);
      setSuccess(true);
      clearCart();
      setTimeout(() => router.push(nextHref), 2800);
    } catch (err) {
      console.error("[checkout] unexpected error:", err);
      requestCriticalCheckoutFailureNotification({
        message: err instanceof Error ? err.message : "Unexpected checkout failure",
        code: "CHECKOUT_UNEXPECTED",
      });
      setError(t("checkout.orderSaveError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header searchQuery="" onSearchChange={() => {}} />
      {/* Extra bottom space so the end of the page (Place order) scrolls clear of the floating
          accessibility button: above the mobile nav below lg, bottom corner (24-80px) on desktop. */}
      <div className="mx-auto max-w-4xl px-4 pt-8 pb-36 md:px-6 lg:pb-28">
        <CheckoutProgress current={success ? "confirm" : "details"} />

        <AnimatePresence mode="wait">
          {success ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center rounded-3xl bg-warm-white px-6 py-16 text-center shadow-soft"
            >
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-turquoise/15 text-turquoise">
                <CheckCircle2 className="h-10 w-10" strokeWidth={1.75} />
              </div>
              <h2 className="mt-6 font-display text-2xl font-bold text-dark-brown">{t("checkout.success")}</h2>
              <p className="mt-2 text-sm text-coffee/60">{t("checkout.successHint")}</p>
              {trackingHref && (
                <Button asChild variant="turquoise" size="lg" className="mt-6">
                  <Link href={trackingHref} data-track-order>
                    {t("tracking.trackOrder")}
                  </Link>
                </Button>
              )}
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <h1 className="font-display text-3xl font-bold text-dark-brown">{t("checkout.title")}</h1>

              <form onSubmit={handleSubmit} className="mt-8 grid gap-8 lg:grid-cols-5">
                <div className="space-y-6 lg:col-span-3">
                  {availability.loading ? (
                    <div className="flex justify-center rounded-2xl bg-warm-white p-5 shadow-soft">
                      <Loader2 className="h-5 w-5 animate-spin text-turquoise" aria-label={t("common.loading", "Loading")} />
                    </div>
                  ) : (
                    <>
                      <OrderTypePicker value={orderType} onChange={setOrderType} availability={availability} />
                      {nothingAvailable ? (
                        <StoreContact
                          message={
                            availability.pickup.available === false && availability.pickup.nextAt
                              ? t("checkout.closedNow").replace(
                                  "{when}",
                                  describeNext(t, locale, availability.pickup.nextAt, availability.now, "at")
                                )
                              : t("checkout.pickupUnavailable")
                          }
                          phone={availability.storePhone}
                        />
                      ) : orderType === "pickup" ? (
                        <PickupTimeSelect slots={availability.pickup.available ? availability.pickup.slots : []} value={pickupTime} onChange={setPickupTime} />
                      ) : (
                        <DeliveryZonePicker
                          zones={availability.zones}
                          value={zoneChoice}
                          onChange={setZoneChoice}
                          address={address}
                          onAddressChange={setAddress}
                          subtotal={subtotal}
                          storePhone={availability.storePhone}
                        />
                      )}
                    </>
                  )}

                  <div className="rounded-2xl bg-warm-white p-5 shadow-soft">
                    <h2 className="text-sm font-semibold">{t("checkout.details")}</h2>
                    <div className="mt-4 space-y-4">
                      <div>
                        <Label className="flex items-center gap-1"><User className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("checkout.name")}</Label>
                        <Input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          autoComplete="name"
                          name="name"
                          className="mt-1"
                          required
                        />
                      </div>
                      <div>
                        <Label className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("checkout.phone")}</Label>
                        <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className="mt-1" required />
                      </div>
                      <div>
                        <Label className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("checkout.notes")}</Label>
                        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" placeholder={t("checkout.notes")} />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl bg-warm-white p-5 shadow-soft">
                    <h2 className="text-sm font-semibold">{t("checkout.payment")}</h2>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setPayment("cash")}
                        className={cn(
                          "flex min-h-11 w-full flex-col items-start gap-1 rounded-2xl border-2 px-4 py-4 text-start transition-all",
                          payment === "cash"
                            ? "border-turquoise bg-turquoise/5"
                            : "border-beige-dark/30 bg-warm-white"
                        )}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2">
                            <Banknote className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                            <span className="font-semibold">
                              {orderType === "delivery" ? t("checkout.payCourier") : t("checkout.paymentCash")}
                            </span>
                          </span>
                          {payment === "cash" && (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-turquoise" strokeWidth={1.75} />
                          )}
                        </div>
                        <span className="ps-7 text-xs text-coffee/55">
                          {orderType === "delivery" ? t("checkout.payCourierHint") : t("checkout.paymentCashHint")}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!cardDisabled) setPayment("card");
                        }}
                        disabled={cardDisabled}
                        className={cn(
                          "flex min-h-11 w-full flex-col items-start gap-1 rounded-2xl border-2 px-4 py-4 text-start transition-all",
                          cardDisabled && "cursor-not-allowed opacity-55",
                          !cardDisabled && payment === "card"
                            ? "border-turquoise bg-turquoise/5"
                            : "border-beige-dark/30 bg-warm-white"
                        )}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-2">
                            <CreditCard className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                            <span className="font-semibold">{t("checkout.paymentCard")}</span>
                          </span>
                          {!cardDisabled && payment === "card" && (
                            <CheckCircle2 className="h-5 w-5 shrink-0 text-turquoise" strokeWidth={1.75} />
                          )}
                        </div>
                        <span className="ps-7 text-xs text-coffee/55">{t("checkout.paymentCardHint")}</span>
                      </button>
                    </div>
                    {cardDisabled && (
                      <p className="mt-3 text-sm text-coffee/60">{t("checkout.hypUnavailable")}</p>
                    )}
                    {!cardDisabled && payment === "card" && (
                      <p className="mt-3 text-sm text-coffee/60">{t("checkout.hypRedirectHint")}</p>
                    )}
                  </div>
                </div>

                <div className="lg:col-span-2">
                  <div className="sticky top-24 rounded-2xl bg-warm-white p-5 shadow-soft">
                    <h2 className="text-sm font-semibold">{t("checkout.orderSummary")}</h2>
                    <div className="mt-4 space-y-2">
                      {items.map((item) => (
                        <OrderLineItem key={item.lineId} item={item} onRemove={() => removeItem(item.lineId)} onEdit={editLine} />
                      ))}
                    </div>
                    {/* Coupon field — same look as the cart. Inside the order <form>, so the
                        button is type="button" and Enter applies the coupon instead of submitting. */}
                    <div className="mt-4 flex gap-2">
                      <Input
                        value={couponInput}
                        onChange={(e) => handleCouponInputChange(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCoupon();
                          }
                        }}
                        placeholder={t("cart.coupon", "Coupon code")}
                        aria-label={t("cart.coupon", "Coupon code")}
                        className="h-9 text-base md:text-sm"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleCoupon()}
                        className="shrink-0"
                        aria-label={t("cart.coupon", "Coupon code")}
                      >
                        <Tag className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {couponError && <p className="mt-2 text-xs text-red-600">{couponError}</p>}
                    <ClubCouponOffer className="mt-2" />
                    <div className="mt-4 space-y-1.5 border-t border-beige-dark/20 pt-4 text-sm">
                      <div className="flex justify-between"><span>{t("cart.subtotal")}</span><span>{formatPrice(subtotal)}</span></div>
                      {discount > 0 && (
                        <div className="flex justify-between text-emerald-600">
                          <span className="inline-flex items-center gap-1">
                            {t("cart.discount")} ({couponCode})
                            <button
                              type="button"
                              onClick={() => {
                                removeCoupon();
                                setCouponInput("");
                                setCouponError(null);
                              }}
                              aria-label={t("cart.removeCoupon", "Remove coupon")}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-coffee/50 transition-colors hover:bg-beige/60 hover:text-coffee"
                            >
                              <X className="h-3.5 w-3.5" strokeWidth={2} />
                            </button>
                          </span>
                          <span>-{formatPrice(discount)}</span>
                        </div>
                      )}
                      {orderType === "delivery" && deliveryZone ? (
                        <div className="flex justify-between" data-summary="delivery-fee">
                          <span>
                            {t("checkout.deliveryFeeLabel")} · {zoneName(deliveryZone, locale)}
                          </span>
                          <span>{formatPrice(deliveryFee)}</span>
                        </div>
                      ) : (
                        <p className="text-xs text-coffee/50">
                          {orderType === "delivery"
                            ? t("checkout.delivery")
                            : pickupTime
                              ? `${t("checkout.pickupFromStore")} · ${pickupTime}`
                              : t("checkout.pickupFromStore")}
                        </p>
                      )}
                      <div className="flex justify-between pt-2 text-lg font-bold">
                        <span>{t("cart.total")}</span>
                        <span className="text-turquoise" data-summary="total">{formatPrice(displayTotal)}</span>
                      </div>
                    </div>
                    {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
                    <Button type="submit" variant="turquoise" size="lg" className="mt-4 w-full" disabled={loading || !canOrder || (payment === "card" && cardDisabled)}>
                      {loading ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {payment === "card" ? t("checkout.redirecting") : t("checkout.placeOrder")}
                        </span>
                      ) : payment === "card" ? (
                        t("checkout.paySecure")
                      ) : (
                        t("checkout.placeOrder")
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {lineEditor}
    </>
  );
}
