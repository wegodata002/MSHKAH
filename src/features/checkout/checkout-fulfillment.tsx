"use client";

import { useId } from "react";
import { CheckCircle2, Clock, MapPin, Phone, Store, Truck } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatPrice } from "@/lib/utils";
import { formatLocalTime } from "@/lib/fulfillment/availability";
import { zoneName, type DeliveryZone } from "@/lib/fulfillment/settings";
import { describeNext, type FulfillmentNow } from "./use-fulfillment-availability";

export type CheckoutOrderType = "pickup" | "delivery";
/** A real area id, "other" (contact the store), or "" (nothing chosen yet). */
export type ZoneChoice = string;
export const OTHER_ZONE = "other";

const card = "rounded-2xl bg-warm-white p-5 shadow-soft";
const choice = (selected: boolean, disabled = false) =>
  cn(
    "flex min-h-11 w-full items-center gap-2 rounded-2xl border-2 px-4 py-3 text-start transition-all",
    disabled
      ? "cursor-not-allowed border-beige-dark/20 bg-beige/20 opacity-70"
      : selected
        ? "border-turquoise bg-turquoise/5"
        : "border-beige-dark/30 bg-warm-white hover:border-turquoise/50"
  );

/** "Contact the store" with a call button to the phone from the settings (no button without a phone). */
export function StoreContact({ message, phone }: { message: string; phone: string }) {
  const t = useT();
  return (
    <div className="space-y-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900" role="status">
      <p>{message}</p>
      {phone ? (
        <a
          href={`tel:${phone.replace(/[^\d+]/g, "")}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-turquoise px-4 font-semibold text-white hover:bg-turquoise/90"
        >
          <Phone className="h-4 w-4" strokeWidth={2} />
          {t("checkout.callStore")}
          <span dir="ltr">{phone}</span>
        </a>
      ) : null}
    </div>
  );
}

/** Pickup / delivery buttons. Delivery is shown only when switched on with areas; disabled outside its hours. */
export function OrderTypePicker({
  value,
  onChange,
  availability,
}: {
  value: CheckoutOrderType;
  onChange: (next: CheckoutOrderType) => void;
  availability: FulfillmentNow;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { pickup, delivery, now } = availability;

  const pickupNote = pickup.available
    ? null
    : pickup.reason === "disabled" || !pickup.nextAt
      ? t("checkout.pickupUnavailable")
      : t("checkout.closedNow").replace("{when}", describeNext(t, locale, pickup.nextAt, now, "at"));
  const deliveryNote =
    delivery && !delivery.available
      ? delivery.nextAt
        ? t("checkout.deliveryFrom").replace("{when}", describeNext(t, locale, delivery.nextAt, now, "from"))
        : t("checkout.deliveryUnavailable")
      : null;

  const options: { type: CheckoutOrderType; label: string; icon: typeof Store; enabled: boolean; note: string | null }[] = [
    { type: "pickup", label: t("checkout.pickup"), icon: Store, enabled: pickup.available, note: pickupNote },
  ];
  if (delivery) {
    options.push({ type: "delivery", label: t("checkout.delivery"), icon: Truck, enabled: delivery.available, note: deliveryNote });
  }

  return (
    <div className={card}>
      <h2 className="text-sm font-semibold">{t("checkout.orderType")}</h2>
      <div className={cn("mt-3 grid grid-cols-1 gap-3", options.length > 1 && "sm:grid-cols-2")}>
        {options.map(({ type, label, icon: Icon, enabled, note }) => {
          const selected = enabled && value === type;
          return (
            <button
              key={type}
              type="button"
              disabled={!enabled}
              aria-pressed={selected}
              data-order-type={type}
              onClick={() => enabled && onChange(type)}
              className={cn(choice(selected, !enabled), "flex-col items-start py-4")}
            >
              <span className="flex w-full items-center gap-2">
                <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
                <span className="font-semibold">{label}</span>
                {selected ? <CheckCircle2 className="ms-auto h-5 w-5 shrink-0 text-turquoise" strokeWidth={1.75} /> : null}
              </span>
              {note ? <span className="ps-7 text-xs text-coffee/60">{note}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Today's pickup times; the first one is "Earliest – HH:MM". */
export function PickupTimeSelect({
  slots,
  value,
  onChange,
}: {
  slots: Date[];
  value: string;
  onChange: (next: string) => void;
}) {
  const t = useT();
  const id = useId();
  return (
    <div className={card}>
      <Label htmlFor={id} className="flex items-center gap-1 text-sm font-semibold">
        <Clock className="h-4 w-4" strokeWidth={1.75} />
        {t("checkout.pickupTime")}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 flex h-11 w-full rounded-xl border border-beige-dark/30 bg-warm-white px-3 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-turquoise"
      >
        {slots.map((slot, index) => {
          const time = formatLocalTime(slot);
          return (
            <option key={time} value={time}>
              {index === 0 ? t("checkout.pickupEarliest").replace("{time}", time) : time}
            </option>
          );
        })}
      </select>
    </div>
  );
}

/** The delivery areas, plus "Other area" (contact the store, no ordering), and the address field. */
export function DeliveryZonePicker({
  zones,
  value,
  onChange,
  address,
  onAddressChange,
  subtotal,
  storePhone,
}: {
  zones: DeliveryZone[];
  value: ZoneChoice;
  onChange: (next: ZoneChoice) => void;
  address: string;
  onAddressChange: (next: string) => void;
  /** Products before the coupon, as the minimum is checked on the server. */
  subtotal: number;
  storePhone: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const addressId = useId();
  const chosen = zones.find((z) => z.id === value);
  const missing = chosen && chosen.minOrder > 0 && subtotal < chosen.minOrder ? chosen.minOrder - subtotal : 0;

  return (
    <div className={card}>
      <h2 className="flex items-center gap-1 text-sm font-semibold">
        <MapPin className="h-4 w-4" strokeWidth={1.75} />
        {t("checkout.deliveryArea")}
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-2" role="radiogroup" aria-label={t("checkout.deliveryArea")}>
        {zones.map((zone) => (
          <ZoneOption key={zone.id} zone={zone} locale={locale} selected={value === zone.id} onSelect={() => onChange(zone.id)} />
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={value === OTHER_ZONE}
          data-zone={OTHER_ZONE}
          onClick={() => onChange(OTHER_ZONE)}
          className={choice(value === OTHER_ZONE)}
        >
          <span className="font-semibold">{t("checkout.otherArea")}</span>
          {value === OTHER_ZONE ? <CheckCircle2 className="ms-auto h-5 w-5 shrink-0 text-turquoise" strokeWidth={1.75} /> : null}
        </button>
      </div>

      {value === OTHER_ZONE ? (
        <div className="mt-3">
          <StoreContact message={t("checkout.otherAreaMessage")} phone={storePhone} />
        </div>
      ) : null}

      {missing > 0 ? (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
          {t("checkout.belowMinimum").replace("{missing}", formatPrice(missing))}
        </p>
      ) : null}

      {chosen ? (
        <div className="mt-4 space-y-1">
          <Label htmlFor={addressId} className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("checkout.address")}
          </Label>
          <Input
            id={addressId}
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            autoComplete="street-address"
            maxLength={300}
            required
          />
          <p className="text-xs text-coffee/55">{t("checkout.deliveryAsap")}</p>
        </div>
      ) : null}
    </div>
  );
}

function ZoneOption({
  zone,
  locale,
  selected,
  onSelect,
}: {
  zone: DeliveryZone;
  locale: "he" | "ar" | "en";
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-zone={zone.id}
      onClick={onSelect}
      className={cn(choice(selected), "flex-col items-start")}
    >
      <span className="flex w-full items-center gap-2">
        <span className="font-semibold">{zoneName(zone, locale)}</span>
        <span className="ms-auto text-sm font-semibold text-coffee">
          {t("checkout.zoneFee").replace("{fee}", formatPrice(zone.fee))}
        </span>
        {selected ? <CheckCircle2 className="h-5 w-5 shrink-0 text-turquoise" strokeWidth={1.75} /> : null}
      </span>
      {zone.minOrder > 0 ? (
        <span className="text-xs text-coffee/60">{t("checkout.zoneMinimum").replace("{min}", formatPrice(zone.minOrder))}</span>
      ) : null}
    </button>
  );
}
