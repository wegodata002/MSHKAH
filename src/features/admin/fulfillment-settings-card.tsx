"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Plus, Store, Trash2, Truck, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import { OpeningHoursEditor } from "@/features/admin/opening-hours-editor";
import {
  MAX_CLOSE_BEFORE_MINUTES,
  MAX_LEAD_MINUTES,
  MAX_MONEY,
  PICKUP_SLOT_CHOICES,
  newFulfillmentId,
  type DeliveryZone,
  type DineInTable,
  type FulfillmentIssue,
  type FulfillmentSettings,
  type LocalizedName,
} from "@/lib/fulfillment/settings";
import { AdminCard } from "./components/admin-card";
import { adminInput } from "./components/admin-styles";

const invalidInput = "border-red-500 focus-visible:ring-red-500 dark:border-red-400";

/** Number input that lets the field be empty while typing; the stored value stays a number. */
function NumberField({
  id,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  className,
  ariaLabel,
}: {
  id?: string;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max: number;
  step?: number;
  className?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText((current) => (Number(current) === value && current.trim() !== "" ? current : String(value)));
  }, [value]);

  return (
    <Input
      id={id}
      type="number"
      inputMode={step < 1 ? "decimal" : "numeric"}
      min={min}
      max={max}
      step={step}
      value={text}
      aria-label={ariaLabel}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n)) {
          onChange(Math.min(Math.max(n, min), max));
        } else if (e.target.value.trim() === "") {
          onChange(min);
        }
      }}
      onBlur={() => setText(String(value))}
      className={cn(adminInput, className)}
    />
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-beige-dark/15 px-3 py-2 dark:border-white/10">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-beige-dark text-turquoise focus:ring-turquoise"
      />
      <span className="text-sm font-medium text-coffee dark:text-warm-white/90">{label}</span>
    </label>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-2xl border border-beige-dark/15 p-4 dark:border-white/10">
      <h3 className="flex items-center gap-2 text-base font-semibold text-dark-brown dark:text-warm-white">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{children}</p>;
}

function FieldError({ children }: { children: ReactNode }) {
  return <p className="text-xs text-red-700 dark:text-red-400">{children}</p>;
}

const NAME_FIELDS: { key: keyof LocalizedName; labelKey: string; dir: "rtl" | "ltr" }[] = [
  { key: "he", labelKey: "admin.fulfillment.delivery.nameHe", dir: "rtl" },
  { key: "ar", labelKey: "admin.fulfillment.delivery.nameAr", dir: "rtl" },
  { key: "en", labelKey: "admin.fulfillment.delivery.nameEn", dir: "ltr" },
];

function ZoneRow({
  zone,
  index,
  showIssues,
  nameMissing,
  onChange,
  onRemove,
}: {
  zone: DeliveryZone;
  index: number;
  showIssues: boolean;
  nameMissing: boolean;
  onChange: (next: DeliveryZone) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const baseId = useId();
  const zoneTitle = t("admin.fulfillment.delivery.zone").replace("{n}", String(index + 1));
  return (
    <li className="space-y-3 rounded-xl bg-beige/20 p-3 dark:bg-white/5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-dark-brown dark:text-warm-white">{zoneTitle}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-10 min-w-10 rounded-xl text-red-700 hover:bg-red-50 dark:text-red-400"
          aria-label={`${t("admin.fulfillment.delivery.removeZone")} – ${zoneTitle}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {NAME_FIELDS.map(({ key, labelKey, dir }) => {
          const missing = showIssues && nameMissing && !zone.name[key].trim();
          return (
            <div key={key}>
              <Label htmlFor={`${baseId}-${key}`}>{t(labelKey)}</Label>
              <Input
                id={`${baseId}-${key}`}
                dir={dir}
                value={zone.name[key]}
                maxLength={80}
                aria-invalid={missing || undefined}
                onChange={(e) => onChange({ ...zone, name: { ...zone.name, [key]: e.target.value } })}
                className={cn("mt-1", adminInput, missing && invalidInput)}
              />
            </div>
          );
        })}
      </div>
      {showIssues && nameMissing ? <FieldError>{t("admin.fulfillment.delivery.nameMissing")}</FieldError> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${baseId}-fee`}>{t("admin.fulfillment.delivery.fee")}</Label>
          <NumberField
            id={`${baseId}-fee`}
            value={zone.fee}
            max={MAX_MONEY}
            step={0.5}
            onChange={(fee) => onChange({ ...zone, fee })}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor={`${baseId}-min`}>{t("admin.fulfillment.delivery.minOrder")}</Label>
          <NumberField
            id={`${baseId}-min`}
            value={zone.minOrder}
            max={MAX_MONEY}
            step={1}
            onChange={(minOrder) => onChange({ ...zone, minOrder })}
            className="mt-1"
          />
          <p className="mt-1 text-xs text-coffee/55 dark:text-warm-white/50">
            {t("admin.fulfillment.delivery.minOrderHint")}
          </p>
        </div>
      </div>
    </li>
  );
}

function TableRow({
  table,
  issue,
  showIssues,
  onChange,
  onRemove,
}: {
  table: DineInTable;
  issue: FulfillmentIssue | undefined;
  showIssues: boolean;
  onChange: (next: DineInTable) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const invalid = showIssues && Boolean(issue);
  return (
    <li className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          value={table.label}
          maxLength={40}
          aria-label={t("admin.fulfillment.dineIn.tableLabel")}
          aria-invalid={invalid || undefined}
          placeholder={t("admin.fulfillment.dineIn.tableLabel")}
          onChange={(e) => onChange({ ...table, label: e.target.value })}
          className={cn(adminInput, invalid && invalidInput)}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-10 min-w-10 shrink-0 rounded-xl text-red-700 hover:bg-red-50 dark:text-red-400"
          aria-label={`${t("admin.fulfillment.dineIn.removeTable")} – ${table.label || "…"}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {invalid ? (
        <FieldError>
          {issue?.code === "table_label_duplicate"
            ? t("admin.fulfillment.dineIn.labelDuplicate")
            : t("admin.fulfillment.dineIn.labelMissing")}
        </FieldError>
      ) : null}
    </li>
  );
}

/** Pickup / delivery / dine-in settings. Part of the settings draft: saved by the page's save bar. */
export function FulfillmentSettingsCard({
  value,
  onChange,
  issues,
  showIssues,
}: {
  value: FulfillmentSettings;
  onChange: (next: FulfillmentSettings) => void;
  issues: FulfillmentIssue[];
  /** Mark invalid fields (after a save attempt). */
  showIssues: boolean;
}) {
  const t = useT();
  const leadId = useId();
  const slotId = useId();
  const closeId = useId();
  const { pickup, delivery, dineIn } = value;

  const setPickup = (patch: Partial<FulfillmentSettings["pickup"]>) =>
    onChange({ ...value, pickup: { ...pickup, ...patch } });
  const setDelivery = (patch: Partial<FulfillmentSettings["delivery"]>) =>
    onChange({ ...value, delivery: { ...delivery, ...patch } });
  const setDineIn = (patch: Partial<FulfillmentSettings["dineIn"]>) =>
    onChange({ ...value, dineIn: { ...dineIn, ...patch } });

  const zoneIssue = (id: string) => issues.some((i) => i.code === "zone_name_missing" && i.zoneId === id);
  const tableIssue = (id: string) =>
    issues.find((i) => (i.code === "table_label_missing" || i.code === "table_label_duplicate") && i.tableId === id);

  const slotChoices: number[] = PICKUP_SLOT_CHOICES.includes(pickup.slotMinutes as (typeof PICKUP_SLOT_CHOICES)[number])
    ? [...PICKUP_SLOT_CHOICES]
    : [...PICKUP_SLOT_CHOICES, pickup.slotMinutes].sort((a, b) => a - b);

  return (
    <AdminCard title={t("admin.fulfillment.title")} className="lg:col-span-2">
      <p className="mb-4 text-sm text-coffee/65 dark:text-warm-white/60">{t("admin.fulfillment.laterNote")}</p>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <div className="space-y-4">
          <Section icon={<Store className="h-5 w-5 text-turquoise" strokeWidth={1.75} />} title={t("admin.fulfillment.pickup.title")}>
            <Toggle
              checked={pickup.enabled}
              onChange={(enabled) => setPickup({ enabled })}
              label={t("admin.fulfillment.pickup.enabled")}
            />
            {pickup.enabled ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={leadId}>{t("admin.fulfillment.pickup.lead")}</Label>
                    <NumberField
                      id={leadId}
                      value={pickup.leadMinutes}
                      max={MAX_LEAD_MINUTES}
                      step={5}
                      onChange={(leadMinutes) => setPickup({ leadMinutes: Math.round(leadMinutes) })}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor={slotId}>{t("admin.fulfillment.pickup.slot")}</Label>
                    <select
                      id={slotId}
                      value={pickup.slotMinutes}
                      onChange={(e) => setPickup({ slotMinutes: Number(e.target.value) })}
                      className={cn(
                        "mt-1 flex w-full border px-3 text-base md:text-sm",
                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-turquoise",
                        adminInput
                      )}
                    >
                      {slotChoices.map((n) => (
                        <option key={n} value={n}>
                          {t("admin.fulfillment.minutes").replace("{n}", String(n))}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-coffee/55 dark:text-warm-white/50">{t("admin.fulfillment.pickup.hint")}</p>
              </>
            ) : null}
          </Section>

          <Section icon={<Utensils className="h-5 w-5 text-turquoise" strokeWidth={1.75} />} title={t("admin.fulfillment.dineIn.title")}>
            <Toggle
              checked={dineIn.enabled}
              onChange={(enabled) => setDineIn({ enabled })}
              label={t("admin.fulfillment.dineIn.enabled")}
            />
            <div className="space-y-2">
              <p className="text-sm font-medium text-dark-brown dark:text-warm-white">{t("admin.fulfillment.dineIn.tables")}</p>
              {dineIn.tables.length === 0 ? (
                <p className="text-sm text-coffee/55 dark:text-warm-white/50">{t("admin.fulfillment.dineIn.noTables")}</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {dineIn.tables.map((table) => (
                    <TableRow
                      key={table.id}
                      table={table}
                      issue={tableIssue(table.id)}
                      showIssues={showIssues}
                      onChange={(next) =>
                        setDineIn({ tables: dineIn.tables.map((x) => (x.id === table.id ? next : x)) })
                      }
                      onRemove={() => setDineIn({ tables: dineIn.tables.filter((x) => x.id !== table.id) })}
                    />
                  ))}
                </ul>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setDineIn({
                    tables: [...dineIn.tables, { id: newFulfillmentId("table"), label: String(dineIn.tables.length + 1) }],
                  })
                }
                className="h-11 rounded-xl"
              >
                <Plus className="h-4 w-4" />
                {t("admin.fulfillment.dineIn.addTable")}
              </Button>
            </div>
            {dineIn.enabled && dineIn.tables.length === 0 ? (
              <Warning>{t("admin.fulfillment.dineIn.noTablesWarning")}</Warning>
            ) : null}
          </Section>
        </div>

        <Section icon={<Truck className="h-5 w-5 text-turquoise" strokeWidth={1.75} />} title={t("admin.fulfillment.delivery.title")}>
          <Toggle
            checked={delivery.enabled}
            onChange={(enabled) => setDelivery({ enabled })}
            label={t("admin.fulfillment.delivery.enabled")}
          />
          {delivery.enabled && delivery.zones.length === 0 ? (
            <Warning>{t("admin.fulfillment.delivery.noZonesWarning")}</Warning>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-medium text-dark-brown dark:text-warm-white">{t("admin.fulfillment.delivery.zones")}</p>
            {delivery.zones.length === 0 ? (
              <p className="text-sm text-coffee/55 dark:text-warm-white/50">{t("admin.fulfillment.delivery.noZones")}</p>
            ) : (
              <ul className="space-y-3">
                {delivery.zones.map((zone, index) => (
                  <ZoneRow
                    key={zone.id}
                    zone={zone}
                    index={index}
                    showIssues={showIssues}
                    nameMissing={zoneIssue(zone.id)}
                    onChange={(next) =>
                      setDelivery({ zones: delivery.zones.map((z) => (z.id === zone.id ? next : z)) })
                    }
                    onRemove={() => setDelivery({ zones: delivery.zones.filter((z) => z.id !== zone.id) })}
                  />
                ))}
              </ul>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setDelivery({
                  zones: [
                    ...delivery.zones,
                    { id: newFulfillmentId("zone"), name: { he: "", ar: "", en: "" }, fee: 0, minOrder: 0 },
                  ],
                })
              }
              className="h-11 rounded-xl"
            >
              <Plus className="h-4 w-4" />
              {t("admin.fulfillment.delivery.addZone")}
            </Button>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-dark-brown dark:text-warm-white">
              {t("admin.fulfillment.delivery.hours")}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["opening", "custom"] as const).map((mode) => (
                <label
                  key={mode}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm",
                    delivery.hoursMode === mode
                      ? "border-turquoise bg-turquoise/5"
                      : "border-beige-dark/20 dark:border-white/10"
                  )}
                >
                  <input
                    type="radio"
                    name="delivery-hours-mode"
                    value={mode}
                    checked={delivery.hoursMode === mode}
                    onChange={() => setDelivery({ hoursMode: mode })}
                    className="h-4 w-4 text-turquoise focus:ring-turquoise"
                  />
                  {mode === "opening"
                    ? t("admin.fulfillment.delivery.hoursOpening")
                    : t("admin.fulfillment.delivery.hoursCustom")}
                </label>
              ))}
            </div>
            {delivery.hoursMode === "custom" ? (
              <OpeningHoursEditor
                value={delivery.customHours}
                onChange={(customHours) => setDelivery({ customHours })}
              />
            ) : null}
          </fieldset>

          <div>
            <Label htmlFor={closeId}>{t("admin.fulfillment.delivery.closeBefore")}</Label>
            <NumberField
              id={closeId}
              value={delivery.closeBeforeMinutes}
              max={MAX_CLOSE_BEFORE_MINUTES}
              step={5}
              onChange={(closeBeforeMinutes) => setDelivery({ closeBeforeMinutes: Math.round(closeBeforeMinutes) })}
              className="mt-1 sm:max-w-[12rem]"
            />
          </div>
        </Section>
      </div>
    </AdminCard>
  );
}
