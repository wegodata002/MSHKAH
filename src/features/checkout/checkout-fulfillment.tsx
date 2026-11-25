"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronDown, Clock, MapPin, Phone, Store, Truck, UtensilsCrossed, Navigation } from "lucide-react";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatPrice } from "@/lib/utils";
import { formatLocalTime } from "@/lib/fulfillment/availability";
import { tableAreaName, tableDisplayName, tablesByArea, zoneName, type DeliveryZone, type DineInTable, type TableArea } from "@/lib/fulfillment/settings";
import { describeNext, type FulfillmentNow } from "./use-fulfillment-availability";
import { PICKUP_TIMES_PAGE, initialVisibleTimes, moreVisibleTimes } from "./pickup-time-list";

export type CheckoutOrderType = "pickup" | "delivery" | "dine_in";

/**
 * The order type actually used: the chosen one when it can be ordered now, else the first that can
 * (pickup, then delivery, then the table). "At the table" only exists after scanning a table QR.
 */
export function resolveOrderType(
  choice: CheckoutOrderType,
  ok: { pickup: boolean; delivery: boolean; dineIn: boolean }
): CheckoutOrderType {
  if (choice === "dine_in" && ok.dineIn) return "dine_in";
  if (choice === "delivery" && ok.delivery) return "delivery";
  if (choice === "pickup" && ok.pickup) return "pickup";
  if (ok.pickup) return "pickup";
  if (ok.delivery) return "delivery";
  if (ok.dineIn) return "dine_in";
  return "pickup";
}
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
  table = null,
}: {
  value: CheckoutOrderType;
  onChange: (next: CheckoutOrderType) => void;
  availability: FulfillmentNow;
  /** The table from a scanned table QR (still in the settings): adds "At the table". */
  table?: DineInTable | null;
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

  const options: { type: CheckoutOrderType; label: string; icon: typeof Store; enabled: boolean; note: string | null }[] = [];
  const dineIn = availability.dineIn;
  if (table && dineIn) {
    options.push({
      type: "dine_in",
      label: t("checkout.dineIn"),
      icon: UtensilsCrossed,
      enabled: dineIn.available,
      note: dineIn.available
        ? tableDisplayName(table, locale)
        : dineIn.nextAt
          ? t("checkout.closedNow").replace("{when}", describeNext(t, locale, dineIn.nextAt, now, "at"))
          : t("checkout.dineInUnavailable"),
    });
  }
  options.push({ type: "pickup", label: t("checkout.pickup"), icon: Store, enabled: pickup.available, note: pickupNote });
  if (delivery) {
    options.push({ type: "delivery", label: t("checkout.delivery"), icon: Truck, enabled: delivery.available, note: deliveryNote });
  }

  return (
    <div className={card}>
      <h2 className="text-sm font-semibold">{t("checkout.orderType")}</h2>
      <div className={cn("mt-3 grid grid-cols-1 gap-3", options.length === 2 && "sm:grid-cols-2", options.length > 2 && "sm:grid-cols-3")}>
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

/**
 * Today's pickup times. Closed: a field with the chosen time ("Earliest – HH:MM" for the first).
 * Open: the list opens downward inside the page with 6 times; "Show more" adds 6 each time.
 * Picking a time closes the list. Keyboard: Enter/Space opens, arrows move, Escape closes.
 */
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
  const labelId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(PICKUP_TIMES_PAGE);
  const fieldRef = useRef<HTMLButtonElement>(null);
  const chipRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const times = slots.map((slot) => formatLocalTime(slot));
  const selectedIndex = times.indexOf(value);
  const label = (time: string, index: number) =>
    index === 0 ? t("checkout.pickupEarliest").replace("{time}", time) : time;
  const shown = Math.min(visible, times.length);

  const openList = () => {
    setVisible(initialVisibleTimes(times.length, selectedIndex));
    setOpen(true);
  };
  const close = (focusField = true) => {
    setOpen(false);
    if (focusField) fieldRef.current?.focus();
  };
  const pick = (time: string) => {
    onChange(time);
    close();
  };

  // When the list opens, focus the selected time (or the first one).
  useEffect(() => {
    if (open) chipRefs.current[Math.max(selectedIndex, 0)]?.focus();
    // Only when it opens; moving between times is handled by the arrow keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    const current = chipRefs.current.findIndex((el) => el === document.activeElement);
    if (current < 0) return;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const step =
      event.key === "ArrowDown" ? 1
      : event.key === "ArrowUp" ? -1
      : event.key === "ArrowRight" ? (rtl ? -1 : 1)
      : event.key === "ArrowLeft" ? (rtl ? 1 : -1)
      : 0;
    if (!step) return;
    event.preventDefault();
    const next = Math.min(Math.max(current + step, 0), shown - 1);
    chipRefs.current[next]?.focus();
  };

  return (
    <div className={card}>
      <p id={labelId} className="flex items-center gap-1 text-sm font-semibold">
        <Clock className="h-4 w-4" strokeWidth={1.75} />
        {t("checkout.pickupTime")}
      </p>
      <button
        ref={fieldRef}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={labelId}
        aria-describedby={`${labelId}-value`}
        data-pickup-field
        onClick={() => (open ? close() : openList())}
        className={cn(
          "mt-2 flex h-11 w-full items-center justify-between rounded-xl border bg-warm-white px-3 text-start text-base",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-turquoise",
          open ? "border-turquoise ring-2 ring-turquoise/20" : "border-beige-dark/30"
        )}
      >
        <span id={`${labelId}-value`}>{selectedIndex >= 0 ? label(value, selectedIndex) : "—"}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-coffee/60 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div id={listId}>
          <div
            role="radiogroup"
            aria-labelledby={labelId}
            onKeyDown={onGridKeyDown}
            className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-6"
          >
            {times.slice(0, shown).map((time, index) => {
              const selected = time === value;
              return (
                <button
                  key={time}
                  ref={(el) => {
                    chipRefs.current[index] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected || (selectedIndex < 0 && index === 0) ? 0 : -1}
                  data-pickup-time={time}
                  onClick={() => pick(time)}
                  className={cn(
                    "flex min-h-11 flex-col items-center justify-center rounded-xl border-2 px-1 py-1 text-[15px] font-semibold transition-colors",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-turquoise",
                    selected
                      ? "border-turquoise bg-turquoise/5 text-turquoise"
                      : "border-beige-dark/30 bg-warm-white hover:border-turquoise/50"
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {selected ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : null}
                    {time}
                  </span>
                  {index === 0 ? (
                    <span className="text-[11px] font-medium text-coffee/60">{t("checkout.pickupEarliestShort")}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {shown < times.length ? (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                data-pickup-more
                onClick={() => setVisible((v) => moreVisibleTimes(v, times.length))}
                className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-beige-dark/30 bg-warm-white px-4 text-sm font-semibold hover:border-turquoise/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-turquoise"
              >
                {t("checkout.showMoreTimes")}
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
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
  locationLink,
  onLocationLinkChange,
  subtotal,
  storePhone,
}: {
  zones: DeliveryZone[];
  value: ZoneChoice;
  onChange: (next: ZoneChoice) => void;
  address: string;
  onAddressChange: (next: string) => void;
  /** Optional Waze / Google Maps link (the courier's navigation button opens it). */
  locationLink: string;
  onLocationLinkChange: (next: string) => void;
  /** Products before the coupon, as the minimum is checked on the server. */
  subtotal: number;
  storePhone: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const addressId = useId();
  const linkId = useId();
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
          <Label htmlFor={linkId} className="flex items-center gap-1 pt-3">
            <Navigation className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("checkout.locationLink")}
            <span className="text-xs font-normal text-coffee/50">({t("checkout.optional")})</span>
          </Label>
          <Input
            id={linkId}
            value={locationLink}
            onChange={(e) => onLocationLinkChange(e.target.value)}
            // Plain text, not type="url": a link shared with words around it ("Meet me here https://…")
            // must not be blocked by the browser — parseLocationLink finds the link in it.
            type="text"
            inputMode="url"
            dir="ltr"
            autoComplete="off"
            maxLength={1000}
            placeholder="https://waze.com/ul/…"
            data-location-link
          />
          <p className="text-xs text-coffee/55">{t("checkout.locationLinkHint")}</p>
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

/**
 * "Your order goes to Table 4 · Inside" with "Not your table? Change". The change window lists only
 * the tables saved in the settings, by area (read only); the choice is remembered like a scan.
 */
export function DineInTableCard({
  table,
  tables,
  onChange,
}: {
  table: DineInTable;
  tables: DineInTable[];
  onChange: (tableId: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const groups = tablesByArea(tables);
  const [open, setOpen] = useState(false);
  const [area, setArea] = useState<TableArea>(table.area);
  const [picked, setPicked] = useState(table.id);

  useEffect(() => {
    if (!open) return;
    setArea(table.area);
    setPicked(table.id);
  }, [open, table.area, table.id]);

  const shown = groups.find((g) => g.area === area)?.tables ?? groups[0]?.tables ?? [];

  return (
    <div className={cn(card, "text-center")} data-dine-in-table={table.id}>
      <p className="text-xs text-coffee/60">{t("checkout.dineInTo")}</p>
      <p className="mt-1 font-display text-2xl font-bold text-dark-brown">{tableDisplayName(table, locale)}</p>
      <p className="mt-1 text-xs text-coffee/60">
        {t("checkout.dineInNotYours")}{" "}
        <button type="button" onClick={() => setOpen(true)} className="font-semibold text-turquoise underline" data-change-table>
          {t("checkout.dineInChange")}
        </button>
      </p>

      {open && (
        // Above the bottom bar (z-100) and the floating buttons (z-60), below app dialogs (z-1000).
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-dark-brown/40 sm:items-center" role="dialog" aria-modal="true" data-table-sheet>
          <div className="w-full max-w-md rounded-t-3xl bg-warm-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-start shadow-premium sm:rounded-3xl">
            <p className="font-display text-lg font-bold text-dark-brown">{t("checkout.dineInWhichTable")}</p>
            {groups.length > 1 && (
              <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-beige/60 p-1" role="tablist">
                {groups.map((g) => (
                  <button
                    key={g.area}
                    type="button"
                    role="tab"
                    aria-selected={area === g.area}
                    onClick={() => setArea(g.area)}
                    data-table-area={g.area}
                    className={cn("h-10 rounded-lg text-sm font-semibold", area === g.area ? "bg-warm-white text-turquoise shadow-soft" : "text-coffee/65")}
                  >
                    {tableAreaName(g.area, locale)}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-4 grid grid-cols-5 gap-2" dir="ltr">
              {shown.map((tb) => (
                <button
                  key={tb.id}
                  type="button"
                  onClick={() => setPicked(tb.id)}
                  aria-pressed={picked === tb.id}
                  aria-label={tableDisplayName(tb, locale)}
                  data-table-option={tb.id}
                  className={cn(
                    "h-12 rounded-xl border-2 text-lg font-bold",
                    picked === tb.id ? "border-turquoise bg-turquoise/10 text-turquoise" : "border-beige-dark/40 text-dark-brown"
                  )}
                >
                  {tb.number}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                onChange(picked);
                setOpen(false);
              }}
              className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-turquoise font-bold text-warm-white"
              data-save-table
            >
              {t("checkout.dineInSave")}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="mt-2 h-10 w-full text-sm text-coffee/60">
              {t("courier.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
