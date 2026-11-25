"use client";

import { useCallback, useEffect, useState } from "react";
import { Bike, KeyRound, Loader2, Pencil, Plus, Shuffle, UtensilsCrossed } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminPageHeader } from "@/features/admin/components/admin-page-header";
import { StaffDevicesSection } from "@/features/admin/staff-devices-section";
import {
  AdminModal,
  AdminModalBody,
  AdminModalFooter,
  AdminModalHeader,
  AdminModalTitle,
} from "@/features/admin/components/admin-modal";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import { cn } from "@/lib/utils";
import type { StaffMemberView, StaffRole } from "@/lib/staff/types";

const ERROR_KEYS = new Set(["PIN_IN_USE", "PIN_WEAK", "PIN_FORMAT", "NAME", "PHONE"]);

/** 4 random digits, never an easy one (same digit ×4, straight runs). */
export function randomPin(): string {
  for (;;) {
    const values = new Uint32Array(4);
    crypto.getRandomValues(values);
    const pin = Array.from(values, (v) => String(v % 10)).join("");
    const d = pin.split("").map(Number);
    const steps = d.slice(1).map((x, i) => x - d[i]!);
    const weak = /^(\d)\1{3}$/.test(pin) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
    if (!weak) return pin;
  }
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-sm disabled:opacity-50"
    >
      <span className={cn("relative h-6 w-10 rounded-full transition-colors", checked ? "bg-turquoise" : "bg-beige-dark/60")}>
        <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "end-0.5" : "start-0.5")} />
      </span>
      <span className="text-coffee/80">{label}</span>
    </button>
  );
}

function PinField({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const t = useT();
  return (
    <div>
      <Label htmlFor={id}>{t("admin.staff.pin")}</Label>
      <div className="mt-1 flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          autoComplete="off"
          dir="ltr"
          className="h-11 w-28 text-center text-lg tracking-[0.4em]"
        />
        <Button type="button" variant="outline" className="h-11" onClick={() => onChange(randomPin())}>
          <Shuffle className="h-4 w-4" />
          {t("admin.staff.randomPin")}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-coffee/55">{t("admin.staff.pinHint")}</p>
    </div>
  );
}

type Dialog =
  | { kind: "create" }
  | { kind: "edit"; member: StaffMemberView }
  | { kind: "pin"; member: StaffMemberView }
  | null;

/** Admin → Staff: couriers and waiters with a personal 4-digit code (Admin only). */
export function StaffAdmin() {
  const t = useT();
  const [staff, setStaff] = useState<StaffMemberView[] | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Dialog form.
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<StaffRole>("courier");
  const [pin, setPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const errorText = (code?: string) => t(code && ERROR_KEYS.has(code) ? `admin.staff.error.${code}` : "admin.staff.error.generic");

  const load = useCallback(async () => {
    const result = await clientAdminFetch<{ staff: StaffMemberView[] }>("/api/admin/staff", { action: "list" });
    if (result.ok && result.data) setStaff(result.data.staff);
    else {
      setStaff([]);
      setNotice({ text: t("admin.staff.error.generic"), tone: "error" });
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (next: Dialog) => {
    setFormError(null);
    setName(next && next.kind !== "create" ? next.member.name : "");
    setPhone(next && next.kind !== "create" ? next.member.phone : "");
    setRole(next && next.kind !== "create" ? next.member.role : "courier");
    setPin(next && next.kind === "edit" ? "" : randomPin());
    setDialog(next);
  };

  const replace = (member: StaffMemberView) =>
    setStaff((list) => {
      const rest = (list ?? []).filter((m) => m.id !== member.id);
      return [...rest, member].sort((a, b) => Number(b.active) - Number(a.active) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name, "he"));
    });

  const submitDialog = async () => {
    if (!dialog) return;
    setSaving(true);
    setFormError(null);
    const body =
      dialog.kind === "create"
        ? { action: "create", name, phone, role, pin }
        : dialog.kind === "edit"
          ? { action: "update", id: dialog.member.id, name, phone, role }
          : { action: "set-pin", id: dialog.member.id, pin };
    const result = await clientAdminFetch<{ member: StaffMemberView }>("/api/admin/staff", body);
    setSaving(false);
    if (!result.ok || !result.data) {
      setFormError(errorText(result.code));
      return;
    }
    replace(result.data.member);
    setNotice({
      text: dialog.kind === "pin" ? `${t("admin.staff.pinChanged")} (${pin})` : dialog.kind === "create" ? `${t("admin.staff.saved")} · ${result.data.member.name} · ${pin}` : t("admin.staff.saved"),
      tone: "ok",
    });
    setDialog(null);
  };

  const patch = async (member: StaffMemberView, change: { active?: boolean; worksToday?: boolean }) => {
    setBusyId(member.id);
    const result = await clientAdminFetch<{ member: StaffMemberView }>("/api/admin/staff", { action: "update", id: member.id, ...change });
    setBusyId(null);
    if (result.ok && result.data) replace(result.data.member);
    else setNotice({ text: errorText(result.code), tone: "error" });
  };

  return (
    <div className="space-y-6" data-staff-admin>
      <AdminPageHeader
        title={t("admin.staff.title")}
        subtitle={t("admin.staff.subtitle")}
        actions={
          <Button type="button" onClick={() => open({ kind: "create" })} data-staff-add>
            <Plus className="h-4 w-4" />
            {t("admin.staff.add")}
          </Button>
        }
      />
      <p className="text-sm text-coffee/60">{t("admin.staff.loginHint")}</p>

      {notice && (
        <p
          role="status"
          className={cn("rounded-xl px-4 py-3 text-sm", notice.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700")}
          data-staff-notice
        >
          {notice.text}
        </p>
      )}

      {staff === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-turquoise" />
        </div>
      ) : staff.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-beige-dark/40 p-8 text-center">
          <p className="font-semibold text-dark-brown">{t("admin.staff.empty")}</p>
          <p className="mt-1 text-sm text-coffee/60">{t("admin.staff.emptyHint")}</p>
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-staff-list>
          {staff.map((member) => {
            const Icon = member.role === "courier" ? Bike : UtensilsCrossed;
            return (
              <li
                key={member.id}
                className={cn("rounded-2xl border border-beige-dark/15 bg-warm-white p-4 shadow-soft dark:bg-white/5", !member.active && "opacity-60")}
                data-staff-member={member.name}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-turquoise/10 text-turquoise">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-dark-brown dark:text-warm-white">{member.name}</p>
                      <p className="text-xs text-coffee/60">
                        {t(`admin.staff.role.${member.role}`)} · <span dir="ltr">{member.phone}</span>
                      </p>
                    </div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", member.active ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-600")}>
                    {t(member.active ? "admin.staff.active" : "admin.staff.disabled")}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
                  {member.role === "courier" && member.active && (
                    <Toggle
                      checked={member.worksToday}
                      label={t("admin.staff.worksToday")}
                      disabled={busyId === member.id}
                      onChange={(v) => void patch(member, { worksToday: v })}
                    />
                  )}
                  <Toggle checked={member.active} label={t("admin.staff.active")} disabled={busyId === member.id} onChange={(v) => void patch(member, { active: v })} />
                </div>
                <div className="mt-4 flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => open({ kind: "edit", member })}>
                    <Pencil className="h-3.5 w-3.5" />
                    {t("admin.staff.edit")}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => open({ kind: "pin", member })} data-staff-change-pin>
                    <KeyRound className="h-3.5 w-3.5" />
                    {t("admin.staff.changePin")}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Cafe tablets that stay signed in to the waiter screen. */}
      <StaffDevicesSection />

      <AdminModal open={!!dialog} onOpenChange={(next) => !saving && !next && setDialog(null)} size="sm">
        <AdminModalHeader onClose={() => setDialog(null)}>
          <AdminModalTitle>
            {dialog?.kind === "create"
              ? t("admin.staff.add")
              : dialog?.kind === "pin"
                ? t("admin.staff.newPinFor").replace("{name}", dialog.member.name)
                : t("admin.staff.edit")}
          </AdminModalTitle>
        </AdminModalHeader>
        <AdminModalBody className="space-y-4">
          {dialog?.kind !== "pin" && (
            <>
              <div>
                <Label htmlFor="staff-name">{t("admin.staff.name")}</Label>
                <Input id="staff-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-11" />
              </div>
              <div>
                <Label htmlFor="staff-phone">{t("admin.staff.phone")}</Label>
                <Input id="staff-phone" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" dir="ltr" className="mt-1 h-11" />
              </div>
              <div>
                <span className="text-sm font-medium">{t("admin.staff.role")}</span>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  {(["courier", "waiter"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRole(value)}
                      aria-pressed={role === value}
                      className={cn(
                        "h-11 rounded-xl border-2 text-sm font-semibold",
                        role === value ? "border-turquoise bg-turquoise/10 text-turquoise" : "border-beige-dark/30 text-coffee/70"
                      )}
                    >
                      {t(`admin.staff.role.${value}`)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          {dialog?.kind !== "edit" && <PinField id="staff-pin" value={pin} onChange={setPin} />}
          {formError && (
            <p className="text-sm text-red-600" role="alert" data-staff-form-error>
              {formError}
            </p>
          )}
        </AdminModalBody>
        <AdminModalFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setDialog(null)}>
            {t("admin.staff.cancel")}
          </Button>
          <Button type="button" disabled={saving} onClick={() => void submitDialog()} data-staff-save>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("admin.staff.save")}
          </Button>
        </AdminModalFooter>
      </AdminModal>
    </div>
  );
}
