"use client";

import { Search } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import type { StaffFilter, staffCounts } from "@/lib/staff/filter";

function Chip({ on, label, count, onClick, data }: { on: boolean; label: string; count?: number; onClick: () => void; data: Record<string, string> }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-semibold",
        on ? "border-turquoise bg-turquoise text-warm-white" : "border-beige-dark/40 bg-warm-white text-coffee/70 dark:bg-white/5"
      )}
      {...data}
    >
      {label}
      {count !== undefined && <span className={cn("text-xs", on ? "text-warm-white/80" : "text-coffee/45")}>{count}</span>}
    </button>
  );
}

/** Admin → Staff (couriers): search (name or phone), status, and "works today". */
export function StaffFilters({
  filter,
  counts,
  onChange,
}: {
  filter: StaffFilter;
  counts: ReturnType<typeof staffCounts>;
  onChange: (next: StaffFilter) => void;
}) {
  const t = useT();
  const set = (patch: Partial<StaffFilter>) => onChange({ ...filter, ...patch });
  return (
    <div className="space-y-2" data-staff-filters>
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-coffee/40" />
        <input
          value={filter.query}
          onChange={(e) => set({ query: e.target.value })}
          placeholder={t("admin.staff.filter.search")}
          className="h-10 w-full rounded-xl border border-beige-dark/40 bg-warm-white ps-9 pe-3 text-sm dark:bg-white/5"
          data-staff-search
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip on={filter.status === "all"} label={t("admin.staff.filter.anyStatus")} onClick={() => set({ status: "all" })} data={{ "data-staff-status": "all" }} />
        <Chip on={filter.status === "active"} label={t("admin.staff.filter.active")} count={counts.active} onClick={() => set({ status: "active" })} data={{ "data-staff-status": "active" }} />
        <Chip on={filter.status === "disabled"} label={t("admin.staff.filter.disabled")} count={counts.disabled} onClick={() => set({ status: "disabled" })} data={{ "data-staff-status": "disabled" }} />
        {filter.role === "courier" && (
          <Chip
            on={filter.worksToday}
            label={t("admin.staff.worksToday")}
            count={counts.worksToday}
            onClick={() => set({ worksToday: !filter.worksToday })}
            data={{ "data-staff-works-today": filter.worksToday ? "on" : "off" }}
          />
        )}
      </div>
    </div>
  );
}
