"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AdminCard } from "@/features/admin/components/admin-card";
import { MeasureUnitDialog } from "@/features/admin/measure-unit-select";
import { useMeasureUnits } from "@/features/admin/measure-units-provider";
import { useT } from "@/components/providers/locale-provider";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { conversionText, type MeasureUnitRecord } from "@/lib/inventory/measure-units";
import { buildMeasureUnitsListView } from "@/lib/inventory/measure-units-list";

export function MeasureUnitsSettings() {
  const t = useT();
  const { refresh, setUnitActive } = useMeasureUnits();
  const [units, setUnits] = useState<MeasureUnitRecord[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<MeasureUnitRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  /** The list could not be loaded at all (e.g. server credentials / permission). */
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const view = useMemo(
    () => buildMeasureUnitsListView(units, usage, { query, expanded, showInactive }),
    [units, usage, query, expanded, showInactive]
  );

  async function load() {
    const result = await clientAdminFetch<{ units: MeasureUnitRecord[]; usage?: Record<string, number> }>("/api/admin/measure-units", { action: "list", usage: true });
    if (!result.ok || !result.data?.units) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    setLoadFailed(false);
    setUnits(result.data.units);
    setUsage(result.data.usage ?? {});
    setError("");
    setLoading(false);
    await refresh();
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggle(unit: MeasureUnitRecord) {
    setError("");
    const result = await setUnitActive(unit.id, !unit.active);
    if (!result.ok) {
      setError(t("admin.measureUnits.failed"));
      return;
    }
    setMessage(unit.active ? t("admin.measureUnits.disabled") : t("admin.measureUnits.enabled"));
    await load();
  }

  return (
    <AdminCard title={t("admin.measureUnits.title")} className="lg:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-coffee/60">{t("admin.measureUnits.lead")}</p>
        <Button type="button" variant="outline" onClick={() => setCreating(true)}>{t("admin.measureUnits.add")}</Button>
      </div>
      {message ? <p className="mb-2 text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="mb-2 text-sm text-red-700">{error}</p> : null}
      {loading ? <Loader2 className="h-5 w-5 animate-spin text-turquoise" /> : loadFailed ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <span>{t("admin.measureUnits.loadFailed")}</span>
          <button type="button" className="font-medium underline" onClick={() => { setLoading(true); void load(); }}>
            {t("admin.measureUnits.retry")}
          </button>
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-coffee/40" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("admin.measureUnits.search")}
                aria-label={t("admin.measureUnits.search")}
                className="h-9 w-full rounded-xl border border-beige-dark/25 bg-warm-white ps-8 pe-3 text-sm outline-none focus:border-turquoise dark:border-white/10 dark:bg-white/5"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-coffee/70">
              <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
              {t("admin.measureUnits.showInactive")}
              {!showInactive && view.inactiveHidden > 0 ? ` (${view.inactiveHidden})` : ""}
            </label>
          </div>
          {view.rows.length === 0 ? <p className="py-3 text-sm text-coffee/55">{t("admin.measureUnits.noResults")}</p> : null}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="text-xs text-coffee/55">
                <tr>
                  <th className="px-2 py-2 text-start">{t("admin.measureUnits.name")}</th>
                  <th className="px-2 py-2 text-start">{t("admin.measureUnits.abbreviation")}</th>
                  <th className="px-2 py-2 text-start">{t("admin.measureUnits.kind")}</th>
                  <th className="px-2 py-2 text-start">{t("admin.measureUnits.conversion")}</th>
                  <th className="px-2 py-2 text-end">{t("admin.measureUnits.usage")}</th>
                  <th className="px-2 py-2 text-start">{t("admin.inventory.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((unit) => (
                  <tr key={unit.id} className={unit.active ? "border-t border-beige-dark/10" : "border-t border-beige-dark/10 text-coffee/50"}>
                    <td className="px-2 py-1.5">{unit.nameHe}{unit.active ? "" : ` · ${t("admin.measureUnits.inactive")}`}</td>
                    <td className="px-2 py-1.5">{unit.abbreviation}</td>
                    <td className="px-2 py-1.5">{t(`admin.measureUnits.kind.${unit.kind}`)}</td>
                    <td className="px-2 py-1.5">{conversionText(unit) || t("admin.measureUnits.none")}</td>
                    <td className="px-2 py-1.5 text-end">{usage[unit.id] ?? 0}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="text-turquoise" onClick={() => setEditing(unit)}>{t("admin.measureUnits.edit")}</button>
                        <button type="button" className="text-coffee/70" onClick={() => void toggle(unit)}>{unit.active ? t("admin.measureUnits.disable") : t("admin.measureUnits.enable")}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="divide-y divide-beige-dark/10 md:hidden">
            {view.rows.map((unit) => (
              <li key={unit.id} className={unit.active ? "flex items-center gap-3 py-2 text-sm" : "flex items-center gap-3 py-2 text-sm text-coffee/50"}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {unit.nameHe} · {unit.abbreviation}
                    {unit.active ? "" : ` · ${t("admin.measureUnits.inactive")}`}
                  </p>
                  <p className="truncate text-xs text-coffee/55">
                    {conversionText(unit) || t(`admin.measureUnits.kind.${unit.kind}`)} · {t("admin.measureUnits.usage")}: {usage[unit.id] ?? 0}
                  </p>
                </div>
                <button type="button" className="shrink-0 text-xs text-turquoise" onClick={() => setEditing(unit)}>{t("admin.measureUnits.edit")}</button>
                <button type="button" className="shrink-0 text-xs text-coffee/70" onClick={() => void toggle(unit)}>{unit.active ? t("admin.measureUnits.disable") : t("admin.measureUnits.enable")}</button>
              </li>
            ))}
          </ul>
          {!query.trim() && (view.hidden > 0 || expanded) ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="mt-2 text-sm font-medium text-turquoise"
            >
              {expanded
                ? t("admin.measureUnits.showLess")
                : t("admin.measureUnits.showMore").replace("{count}", String(view.hidden))}
            </button>
          ) : null}
        </>
      )}
      {creating ? <MeasureUnitDialog open onClose={() => setCreating(false)} onSaved={(_unit, reused) => { setMessage(t(reused ? "admin.measureUnits.duplicate" : "admin.measureUnits.saved")); void load(); }} /> : null}
      {editing ? <MeasureUnitDialog open initial={editing} onClose={() => setEditing(null)} onSaved={() => { setMessage(t("admin.measureUnits.saved")); void load(); }} /> : null}
    </AdminCard>
  );
}
