"use client";

import { useLocale, useT } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import {
  OPENING_DAY_KEYS,
  formatOpeningHours,
  openingDayName,
  type OpeningDayHours,
  type OpeningDayKey,
  type OpeningHours,
} from "@/lib/settings/opening-hours";
import { adminInput } from "./components/admin-styles";

/** Seven rows (Sunday → Saturday): open/closed toggle + opening and closing time. */
export function OpeningHoursEditor({
  value,
  onChange,
  legacyText,
}: {
  value: OpeningHours;
  onChange: (next: OpeningHours) => void;
  /** Custom free text still shown on the site until the schedule is saved. */
  legacyText?: string;
}) {
  const t = useT();
  const { locale } = useLocale();

  const setDay = (day: OpeningDayKey, patch: Partial<OpeningDayHours>) =>
    onChange({ ...value, [day]: { ...value[day], ...patch } });

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-beige-dark/10 rounded-xl border border-beige-dark/20 dark:divide-white/10 dark:border-white/10">
        {OPENING_DAY_KEYS.map((day) => {
          const hours = value[day];
          const dayLabel = openingDayName(day, locale);
          return (
            <li key={day} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <label className="flex min-w-[7.5rem] cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={hours.open}
                  onChange={(event) => setDay(day, { open: event.target.checked })}
                  className="h-4 w-4 rounded border-beige-dark text-turquoise focus:ring-turquoise"
                  aria-label={`${dayLabel} – ${t("admin.settings.hoursOpen")}`}
                />
                <span className="font-medium text-dark-brown dark:text-warm-white">{dayLabel}</span>
              </label>
              {hours.open ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <input
                    type="time"
                    value={hours.from}
                    onChange={(event) => event.target.value && setDay(day, { from: event.target.value })}
                    aria-label={`${dayLabel} – ${t("admin.settings.hoursFrom")}`}
                    className={cn("h-9 w-[6.5rem] rounded-lg px-2", adminInput)}
                  />
                  <span aria-hidden className="text-coffee/50">–</span>
                  <input
                    type="time"
                    value={hours.to}
                    onChange={(event) => event.target.value && setDay(day, { to: event.target.value })}
                    aria-label={`${dayLabel} – ${t("admin.settings.hoursTo")}`}
                    className={cn("h-9 w-[6.5rem] rounded-lg px-2", adminInput)}
                  />
                  {hours.from === hours.to ? (
                    <span className="text-xs text-red-700">{t("admin.settings.hoursSameTime")}</span>
                  ) : hours.to < hours.from ? (
                    <span className="text-xs text-coffee/55">{t("admin.settings.hoursOvernight")}</span>
                  ) : null}
                </div>
              ) : (
                <span className="text-sm text-coffee/50">{t("admin.settings.hoursClosed")}</span>
              )}
            </li>
          );
        })}
      </ul>
      {legacyText ? (
        <p className="text-xs text-amber-700">
          {t("admin.settings.hoursLegacyNote").replace("{text}", legacyText)}
        </p>
      ) : null}
      <div className="rounded-xl bg-beige/30 px-3 py-2 text-xs text-coffee/70 dark:bg-white/5">
        <p className="mb-1 font-medium">{t("admin.settings.hoursPreview")}</p>
        <p className="whitespace-pre-line">{formatOpeningHours(value, locale)}</p>
      </div>
    </div>
  );
}
