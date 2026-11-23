"use client";

import { Button } from "@/components/ui/button";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/locale-provider";
import type { ProductFilters } from "@/types";

interface FiltersProps {
  filters: ProductFilters;
  onFiltersChange: (filters: ProductFilters) => void;
}

type CatalogSort = "menu" | "price-asc" | "price-desc" | "name-asc";

/** Sort options shown to customers. "Popular" / "New" are filters, not sorts. */
const SORT_OPTIONS: { value: CatalogSort; labelKey: string }[] = [
  { value: "menu", labelKey: "filters.sortMenu" },
  { value: "price-asc", labelKey: "filters.sortPriceAsc" },
  { value: "price-desc", labelKey: "filters.sortPriceDesc" },
  { value: "name-asc", labelKey: "filters.sortName" },
];

function isDefaultSort(sortBy: ProductFilters["sortBy"]): boolean {
  return !sortBy || sortBy === "menu";
}

/** Active filters + 1 when the sort is not the default menu order (badge count). */
export function countActiveFilters(filters: ProductFilters): number {
  return (
    [
      filters.isPopular,
      filters.isNew,
      filters.available === true,
      filters.minPrice,
      filters.maxPrice,
    ].filter(Boolean).length + (isDefaultSort(filters.sortBy) ? 0 : 1)
  );
}

/** Single "Filter & sort" toggle: compact icon (mobile row) or labelled button (desktop). */
export function FilterSortButton({
  filters,
  open,
  onClick,
  variant = "full",
}: {
  filters: ProductFilters;
  open: boolean;
  onClick: () => void;
  variant?: "full" | "icon";
}) {
  const t = useT();
  const count = countActiveFilters(filters);
  const label = t("filters.filterAndSort", "Filter & sort");

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-expanded={open}
        className={cn(
          "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-warm-white transition-colors",
          open || count > 0 ? "border-turquoise text-turquoise" : "border-beige-dark/30 text-coffee"
        )}
      >
        <SlidersHorizontal className="h-4 w-4" strokeWidth={1.75} />
        {count > 0 && (
          <span className="absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-turquoise px-1 text-[10px] font-bold text-warm-white">
            {count}
          </span>
        )}
      </button>
    );
  }

  return (
    <Button
      variant={open ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      className="shrink-0"
      aria-expanded={open}
    >
      <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.75} />
      {label}
      {count > 0 && (
        <span className="ms-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-turquoise px-1 text-[10px] text-warm-white">
          {count}
        </span>
      )}
    </Button>
  );
}

/** One panel with two titled parts: "Filter" (toggles) and "Sort" (single choice). */
export function FilterSortPanel({ filters, onFiltersChange }: FiltersProps) {
  const t = useT();
  const count = countActiveFilters(filters);
  const sortBy: CatalogSort = SORT_OPTIONS.some((o) => o.value === filters.sortBy)
    ? (filters.sortBy as CatalogSort)
    : "menu";

  const clearAll = () => {
    onFiltersChange({
      ...filters,
      isPopular: undefined,
      isNew: undefined,
      available: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      sortBy: "menu",
    });
  };

  return (
    <div className="space-y-3 rounded-xl border border-beige-dark/20 bg-warm-white/60 p-3">
      <div>
        <p className="mb-2 text-xs font-semibold text-coffee/70">{t("filters.title")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Chip
            label={t("filters.sortPopular")}
            active={!!filters.isPopular}
            onClick={() => onFiltersChange({ ...filters, isPopular: filters.isPopular ? undefined : true })}
          />
          <Chip
            label={t("catalog.new")}
            active={!!filters.isNew}
            onClick={() => onFiltersChange({ ...filters, isNew: filters.isNew ? undefined : true })}
          />
          <Chip
            label={t("filters.available")}
            active={filters.available === true}
            onClick={() => onFiltersChange({ ...filters, available: filters.available ? undefined : true })}
          />
          <Chip
            label={t("filters.under25")}
            active={filters.maxPrice === 25 && !filters.minPrice}
            onClick={() => {
              const on = filters.maxPrice === 25 && !filters.minPrice;
              onFiltersChange({ ...filters, minPrice: undefined, maxPrice: on ? undefined : 25 });
            }}
          />
          <Chip
            label={t("filters.range2540")}
            active={filters.minPrice === 25 && filters.maxPrice === 40}
            onClick={() => {
              const on = filters.minPrice === 25 && filters.maxPrice === 40;
              onFiltersChange({ ...filters, minPrice: on ? undefined : 25, maxPrice: on ? undefined : 40 });
            }}
          />
          <Chip
            label={t("filters.over40")}
            active={filters.minPrice === 40 && !filters.maxPrice}
            onClick={() => {
              const on = filters.minPrice === 40 && !filters.maxPrice;
              onFiltersChange({ ...filters, minPrice: on ? undefined : 40, maxPrice: undefined });
            }}
          />
        </div>
      </div>

      <div>
        <p id="catalog-sort-label" className="mb-2 text-xs font-semibold text-coffee/70">
          {t("filters.sort")}
        </p>
        <div role="radiogroup" aria-labelledby="catalog-sort-label" className="flex flex-wrap items-center gap-2">
          {SORT_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              role="radio"
              label={t(option.labelKey)}
              active={sortBy === option.value}
              onClick={() => onFiltersChange({ ...filters, sortBy: option.value })}
            />
          ))}
        </div>
      </div>

      {count > 0 && (
        <Button variant="ghost" size="sm" onClick={clearAll} className="text-xs text-coffee/60">
          <X className="me-1 h-3 w-3" strokeWidth={1.75} />
          {t("filters.clear")}
        </Button>
      )}
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
  role,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  role?: "radio";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role={role}
      aria-checked={role === "radio" ? active : undefined}
      aria-pressed={role === "radio" ? undefined : active}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200",
        active ? "bg-turquoise text-warm-white" : "bg-beige/60 text-coffee hover:bg-beige"
      )}
    >
      {label}
    </button>
  );
}
