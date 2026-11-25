"use client";

import { AlertTriangle, Banknote, Bike, ChevronDown, Clock, Copy, FileText, Layers, Loader2, Printer, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/providers/locale-provider";
import { effectivePaymentStatus } from "@/lib/orders/operations";
import {
  OPERATIONAL_FILTERS,
  nextOperationalStatus,
  operationalStatusOf,
  toStoredOrderStatus,
  type OperationalOrderStatus,
} from "@/lib/orders/status";
import { ageIsAtLeastOneDay, formatJerusalemDateTime } from "@/lib/orders/time";
import { formatDuration, formatOrderAge } from "@/lib/orders/format-age";
import { orderAgeMs, overdueLevel, stageAgeMs } from "@/lib/orders/overdue";
import { formatDate, formatPrice, cn } from "@/lib/utils";
import type { Order, OrderStatus } from "@/types";
import { ClubMemberBadge } from "@/features/admin/club-member-badge";
import { OrderCourierPicker, type CourierOption } from "@/features/admin/orders/order-courier-picker";

const STATUS_STYLE: Record<OperationalOrderStatus, string> = {
  received: "border-amber-300 bg-amber-50 text-amber-800",
  preparing: "border-violet-300 bg-violet-50 text-violet-800",
  ready: "border-emerald-300 bg-emerald-50 text-emerald-800",
  delivered: "border-stone-300 bg-stone-100 text-stone-700",
  cancelled: "border-red-300 bg-red-50 text-red-700",
};

const STATUS_BORDER: Record<OperationalOrderStatus, string> = {
  received: "border-s-amber-500",
  preparing: "border-s-violet-500",
  ready: "border-s-emerald-500",
  delivered: "border-s-stone-500",
  cancelled: "border-s-red-500",
};

function OrderItems({
  order,
  onEditItem,
}: {
  order: Order;
  onEditItem?: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      {order.items.map((item, index) => (
        <div key={`${item.productId}-${index}`} className="text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold text-dark-brown dark:text-warm-white">
              {item.quantity}× {item.productName}
            </p>
            {onEditItem && order.status !== "delivered" && order.status !== "cancelled" && (
              <button
                type="button"
                onClick={() => onEditItem(index)}
                className="rounded-lg p-1.5 text-coffee/50 hover:bg-beige/50 hover:text-turquoise"
                aria-label="Edit extras"
              >
                <Layers className="h-4 w-4" />
              </button>
            )}
          </div>
          {item.modifiers?.map((modifier) => (
            <p key={`${modifier.groupId}-${modifier.optionId}`} className="ps-4 text-xs text-coffee/65">
              + {modifier.groupName ? `${modifier.groupName}: ` : ""}
              {modifier.optionName}
              {modifier.quantity > 1 ? ` ×${modifier.quantity}` : ""}
              {modifier.kitchenNote ? ` — ${modifier.kitchenNote}` : ""}
            </p>
          ))}
          {item.kitchenNotes?.map((note) => (
            <p key={note} className="ps-4 text-xs font-medium text-violet-700">
              • {note}
            </p>
          ))}
          {item.notes && <p className="ps-4 text-xs italic text-coffee/60">{item.notes}</p>}
        </div>
      ))}
    </div>
  );
}

export function OrderCard({
  order,
  expanded,
  updating,
  now = Date.now(),
  onToggle,
  onStatusChange,
  onCancel,
  onPrint,
  onThermalReprint,
  onResendCustomerEmail,
  onResendAdminEmail,
  onExportPdf,
  onCopyNumber,
  onEditItem,
  onPermanentDelete,
  onMarkCashPaid,
  onMarkOutForDelivery,
  couriers,
  courierSaving = false,
  onAssignCourier,
  isClubMember,
}: {
  order: Order;
  expanded: boolean;
  updating: boolean;
  now?: number;
  onToggle: () => void;
  onStatusChange: (status: OrderStatus) => void;
  onCancel: () => void;
  onPrint: () => void;
  onThermalReprint?: () => void;
  onResendCustomerEmail?: () => void;
  onResendAdminEmail?: () => void;
  onExportPdf?: () => void;
  onCopyNumber?: () => void;
  onEditItem?: (index: number) => void;
  onPermanentDelete?: () => void;
  /** Present only while the order waits for a cash payment. */
  onMarkCashPaid?: () => void;
  /** Delivery orders: stamp "out for delivery" (shown on the customer's tracking page). */
  onMarkOutForDelivery?: () => void;
  /** Delivery orders: couriers working today (null while loading) and assigning one. */
  couriers?: CourierOption[] | null;
  courierSaving?: boolean;
  onAssignCourier?: (courierId: string | null) => void;
  isClubMember?: boolean;
}) {
  const t = useT();
  const status = operationalStatusOf(order);
  const next = nextOperationalStatus(status);
  const ageMs = orderAgeMs(order, now);
  const stageMs = stageAgeMs(order, now);
  const delay = overdueLevel(order, now);
  const paymentStatus = effectivePaymentStatus(order);
  const paidByCard =
    paymentStatus === "paid" &&
    (order.paymentProvider === "HYP" || (order.paymentMethod || "").toLowerCase() === "card");
  const paymentLabelKey = paidByCard ? "admin.payment.paidCard" : `admin.payment.${paymentStatus}`;

  return (
    <article
      className={cn(
        "rounded-2xl border border-beige-dark/15 border-s-4 bg-warm-white p-3 shadow-soft dark:border-white/10 dark:bg-white/5",
        STATUS_BORDER[status],
        delay === "warning" && "ring-2 ring-amber-400/50",
        delay === "critical" && "ring-2 ring-red-400/60"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold text-dark-brown dark:text-warm-white">{order.orderNumber}</span>
            <Badge variant="outline" className={STATUS_STYLE[status]}>
              {t(`admin.status.${status}`)}
            </Badge>
            {delay !== "normal" && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                  delay === "critical" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
                )}
              >
                <AlertTriangle className="h-3 w-3" />
                {t(delay === "critical" ? "admin.orders.critical" : "admin.orders.warning")}
              </span>
            )}
            {(paymentStatus === "pending" || paymentStatus === "failed") && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                  paymentStatus === "failed" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
                )}
              >
                <Wallet className="h-3 w-3" />
                {t(paymentLabelKey)}
              </span>
            )}
            {order.isTestOrder && (
              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">TEST</span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-coffee/60">
            <span className="truncate font-medium text-coffee/80">{order.customerName}</span>
            {isClubMember ? <ClubMemberBadge compact /> : null}
            {/* What the kitchen needs at a glance: pickup time, or the delivery area. */}
            {order.orderType !== "delivery" && order.pickupTime ? (
              <span className="rounded-full bg-turquoise/10 px-1.5 py-0.5 text-[11px] font-semibold text-turquoise">
                {t("admin.orders.pickupAt").replace("{time}", order.pickupTime)}
              </span>
            ) : null}
            {order.orderType === "delivery" ? (
              <span className="rounded-full bg-turquoise/10 px-1.5 py-0.5 text-[11px] font-semibold text-turquoise">
                {order.deliveryZoneName
                  ? t("admin.orders.deliveryTo").replace("{zone}", order.deliveryZoneName)
                  : t("admin.orders.type.delivery")}
              </span>
            ) : null}
            {order.orderType === "delivery" && order.courierName ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-turquoise/10 px-1.5 py-0.5 text-[11px] font-semibold text-turquoise" data-courier-chip>
                <Bike className="h-3 w-3" />
                {order.courierName}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1" title={formatJerusalemDateTime(order.createdAt)}>
              <Clock className="h-3 w-3" />
              {ageIsAtLeastOneDay(ageMs)
                ? formatJerusalemDateTime(order.createdAt)
                : new Date(order.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        </div>
        <p className="shrink-0 text-lg font-bold text-coffee">{formatPrice(order.total)}</p>
      </div>

      <div className="mt-2 flex items-center gap-2">
        {next && (
          <Button
            type="button"
            size="sm"
            className="rounded-lg"
            disabled={updating}
            onClick={() => onStatusChange(toStoredOrderStatus(next))}
          >
            {updating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t(`admin.orders.next.${status}`)}
          </Button>
        )}
        {/* Delivery, ready: "out for delivery" first (customer tracking), then "delivered". */}
        {order.orderType === "delivery" && status === "ready" && !order.outForDeliveryAt && onMarkOutForDelivery && (
          <Button type="button" size="sm" variant="outline" className="rounded-lg" onClick={onMarkOutForDelivery} data-out-for-delivery>
            <Bike className="h-3.5 w-3.5" />
            {t("admin.orders.markOutForDelivery")}
          </Button>
        )}
        {order.orderType === "delivery" && status === "ready" && order.outForDeliveryAt && (
          <span className="inline-flex items-center gap-1 rounded-full bg-turquoise/10 px-2 py-0.5 text-[11px] font-semibold text-turquoise">
            <Bike className="h-3 w-3" />
            {t("admin.orders.outForDeliveryAt").replace(
              "{time}",
              new Date(order.outForDeliveryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            )}
          </span>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="ms-auto inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-turquoise hover:bg-turquoise/10"
        >
          {t(expanded ? "admin.orders.hideDetails" : "admin.orders.showDetails")}
          {!expanded && order.items.length > 0 ? ` (${order.items.length})` : ""}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
        </button>
      </div>
      {onAssignCourier && (
        <OrderCourierPicker order={order} couriers={couriers ?? null} saving={courierSaving} onAssign={onAssignCourier} />
      )}

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-beige-dark/15 pt-3">
          {(status === "received" || status === "preparing" || status === "ready") && (
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-coffee/60">
              <span className={cn("inline-flex items-center gap-1", delay !== "normal" && "font-bold text-amber-800")}>
                <Clock className="h-3.5 w-3.5" />
                {formatOrderAge(t, ageMs)}
              </span>
              <span>{t(`admin.orders.stage.${status}`).replace("{age}", formatDuration(t, stageMs))}</span>
              {order.orderType && <span>{t(`admin.orders.type.${order.orderType}`)}</span>}
            </p>
          )}
          <div className="rounded-xl bg-cream/55 p-3 dark:bg-white/5">
            <OrderItems order={order} onEditItem={onEditItem} />
          </div>
          <div className="grid gap-4 text-sm md:grid-cols-2">
            <div className="space-y-1">
              <p className="font-semibold">{t("orders.customer")}</p>
              <p>{order.customerFullName || order.customerName}</p>
              {order.customerPhone && <p dir="ltr" className="text-start">{order.customerPhone}</p>}
              {order.customerEmail && <p dir="ltr" className="text-start">{order.customerEmail}</p>}
              {order.deliveryZoneName && <p className="font-semibold">{order.deliveryZoneName}</p>}
              {order.deliveryAddress && <p>{order.deliveryAddress}</p>}
            </div>
            <div className="space-y-1">
              <p className="font-semibold">{t("orders.date")}</p>
              <p>{formatDate(order.createdAt)}</p>
              <p>
                {t("admin.orders.paymentMethod")}:{" "}
                {order.paymentProvider === "HYP" || (order.paymentMethod || "").toLowerCase() === "card"
                  ? t("admin.payment.methodCardHyp")
                  : t("admin.payment.methodCash")}
              </p>
              {order.paymentProvider && (
                <p>{t("admin.payment.provider")}: {order.paymentProvider}</p>
              )}
              {paymentStatus === "paid" && (
                <p>{t("admin.payment.paidAmount")}: {formatPrice(order.total)}</p>
              )}
              {(order.paidVia === "courier_cash" || order.paidVia === "courier_card") && (
                <p className="font-medium text-emerald-800" data-paid-via-courier>
                  {t(order.paidVia === "courier_card" ? "admin.payment.paidCourierCard" : "admin.payment.paidCourierCash")}
                </p>
              )}
              {onMarkCashPaid && (
                <Button type="button" size="sm" variant="outline" className="mt-1 border-emerald-300 text-emerald-800" onClick={onMarkCashPaid}>
                  <Banknote className="h-4 w-4" />
                  {t("admin.orders.markCashPaid")}
                </Button>
              )}
              {order.paymentTransactionId && (
                <p dir="ltr" className="text-start">
                  {t("admin.payment.transaction")}: {order.paymentTransactionId}
                </p>
              )}
              <p>
                {t("admin.payment.customerEmail")}:{" "}
                {t(`admin.payment.notify.${order.customerConfirmationStatus || "PENDING"}`)}
              </p>
              <p>
                {t("admin.payment.adminEmail")}:{" "}
                {t(`admin.payment.notify.${order.adminNotificationStatus || "PENDING"}`)}
              </p>
              <p>{t("admin.payment.invoice")}: {t("admin.payment.notify.PROVIDER_REQUIRED")}</p>
              <p>{t("admin.payment.message")}: {t("admin.payment.notify.NOT_CONFIGURED")}</p>
            </div>
            {order.notes && (
              <div className="rounded-xl bg-amber-50 p-3 text-amber-900 md:col-span-2">
                <p className="font-semibold">{t("builder.notes")}</p>
                <p className="whitespace-pre-line">{order.notes}</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-beige-dark/15 pt-3">
            <Select
              value={status}
              onValueChange={(value) => onStatusChange(toStoredOrderStatus(value as OperationalOrderStatus))}
              disabled={updating}
            >
              <SelectTrigger className="h-10 w-[145px]">
                {updating ? <Loader2 className="h-4 w-4 animate-spin" /> : <SelectValue />}
              </SelectTrigger>
              <SelectContent>
                {OPERATIONAL_FILTERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`admin.status.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button type="button" variant="outline" size="icon" onClick={onPrint} title={t("admin.orders.printTicket")}>
              <Printer className="h-4 w-4" />
            </Button>
            {onThermalReprint && (
              <Button
                type="button"
                variant="outline"
                onClick={onThermalReprint}
                title={t("admin.orders.thermalReprint", "הדפס מחדש")}
              >
                {t("admin.orders.thermalReprint", "הדפס מחדש")}
              </Button>
            )}
            {onResendCustomerEmail && order.customerEmail && (
              <Button type="button" variant="outline" onClick={onResendCustomerEmail}>
                {t("admin.payment.resendEmail")}
              </Button>
            )}
            {onResendAdminEmail && (
              <Button type="button" variant="outline" onClick={onResendAdminEmail}>
                {t("admin.payment.resendAdminEmail")}
              </Button>
            )}
            {onExportPdf && (
              <Button type="button" variant="outline" size="icon" onClick={onExportPdf} title={t("admin.orders.exportPdf")}>
                <FileText className="h-4 w-4" />
              </Button>
            )}
            {onCopyNumber && (
              <Button type="button" variant="outline" size="icon" onClick={onCopyNumber} title={t("admin.orders.copyNumber")}>
                <Copy className="h-4 w-4" />
              </Button>
            )}
            {status !== "cancelled" && status !== "delivered" && (
              <Button type="button" variant="ghost" className="text-red-600" onClick={onCancel}>
                {t("admin.orders.cancel")}
              </Button>
            )}
            {onPermanentDelete && (
              <Button type="button" variant="ghost" className="text-red-700" onClick={onPermanentDelete}>
                {t("admin.orders.permanentDelete")}
              </Button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
