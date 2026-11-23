"use client";

import { Button } from "@/components/ui/button";
import {
  AdminModal,
  AdminModalBody,
  AdminModalFooter,
  AdminModalHeader,
  AdminModalTitle,
} from "@/features/admin/components/admin-modal";
import { useT } from "@/components/providers/locale-provider";
import { formatPrice } from "@/lib/utils";
import type { Order } from "@/types";

/**
 * Asked when a cash order that is not marked as paid is marked "delivered".
 * "Yes" → deliver + record the cash payment; "Not yet" → deliver only; closing → do nothing.
 */
export function PaymentReceivedDialog({
  order,
  onAnswer,
  onClose,
}: {
  order: Order | null;
  onAnswer: (paid: boolean) => void;
  onClose: () => void;
}) {
  const t = useT();

  return (
    <AdminModal open={order != null} onOpenChange={(open) => !open && onClose()} size="sm">
      <AdminModalHeader onClose={onClose}>
        <AdminModalTitle>{t("admin.orders.paymentReceived.title")}</AdminModalTitle>
      </AdminModalHeader>
      <AdminModalBody>
        <p className="text-sm text-coffee/80">
          {t("admin.orders.paymentReceived.body")
            .replace("{number}", order?.orderNumber ?? "")
            .replace("{amount}", formatPrice(order?.total ?? 0))}
        </p>
      </AdminModalBody>
      <AdminModalFooter>
        <Button type="button" variant="outline" onClick={() => onAnswer(false)}>
          {t("admin.orders.paymentReceived.notYet")}
        </Button>
        <Button type="button" onClick={() => onAnswer(true)}>
          {t("admin.orders.paymentReceived.yes")}
        </Button>
      </AdminModalFooter>
    </AdminModal>
  );
}
