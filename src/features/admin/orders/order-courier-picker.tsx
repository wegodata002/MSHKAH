"use client";

import Link from "next/link";
import { Bike, Loader2 } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { useAdminPath } from "@/hooks/useAdminPath";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { operationalStatusOf } from "@/lib/orders/status";
import type { Order } from "@/types";

export type CourierOption = { id: string; name: string };

const NONE = "__none__";

/** Open delivery orders (received / preparing / ready) can get a courier. */
export function canPickCourier(order: Pick<Order, "orderType" | "status">): boolean {
  if (order.orderType !== "delivery") return false;
  const status = operationalStatusOf(order);
  return status === "received" || status === "preparing" || status === "ready";
}

/**
 * "Courier" on a delivery order card: couriers marked "working today". The current courier stays in
 * the list even if no longer marked, so the field always shows who has it.
 */
export function OrderCourierPicker({
  order,
  couriers,
  saving,
  onAssign,
}: {
  order: Order;
  couriers: CourierOption[] | null;
  saving: boolean;
  onAssign: (courierId: string | null) => void;
}) {
  const t = useT();
  const adminPath = useAdminPath();
  if (!canPickCourier(order)) return null;

  const options = [...(couriers ?? [])];
  if (order.courierId && !options.some((c) => c.id === order.courierId)) {
    options.unshift({ id: order.courierId, name: order.courierName ?? "—" });
  }
  const noneWorking = couriers !== null && couriers.length === 0 && !order.courierId;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" data-courier-picker>
      <Bike className="h-4 w-4 shrink-0 text-turquoise" aria-hidden />
      {noneWorking ? (
        <p className="text-xs text-coffee/60" data-no-couriers>
          {t("admin.orders.courier.noneWorking")}{" "}
          <Link href={adminPath("staff")} className="font-semibold text-turquoise underline">
            {t("admin.orders.courier.markInStaff")}
          </Link>
        </p>
      ) : (
        <Select
          value={order.courierId ?? NONE}
          disabled={saving || couriers === null}
          onValueChange={(value) => onAssign(value === NONE ? null : value)}
        >
          <SelectTrigger className="h-8 w-auto min-w-[10rem] rounded-lg text-xs" aria-label={t("admin.orders.courier.label")}>
            <SelectValue placeholder={t("admin.orders.courier.choose")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("admin.orders.courier.none")}</SelectItem>
            {options.map((courier) => (
              <SelectItem key={courier.id} value={courier.id}>
                {courier.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-coffee/50" />}
    </div>
  );
}
