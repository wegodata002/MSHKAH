"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Pencil, Tablet, Unplug, X } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import type { StaffDeviceView } from "@/lib/staff/device";

function dateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" });
}

/**
 * Admin → Staff → Waiter devices: phones and tablets signed in to the waiter screen (joined with the
 * waiters' QR for 90 days, or linked earlier with a code). Rename (actions are recorded under the
 * name) or disconnect each one; "Replace QR" on the QR page disconnects all QR devices at once.
 */
export function StaffDevicesSection() {
  const t = useT();
  const [devices, setDevices] = useState<StaffDeviceView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await clientAdminFetch<{ devices: StaffDeviceView[] }>("/api/admin/staff", { action: "devices" });
    setDevices(result.ok && result.data ? result.data.devices : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (device: StaffDeviceView) => {
    setBusy(device.id);
    setError(null);
    const result = await clientAdminFetch("/api/admin/staff", { action: "revoke-device", deviceId: device.id });
    setBusy(null);
    if (result.ok) await load();
    else setError(t("admin.staff.error.generic"));
  };

  const rename = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    setBusy(editing.id);
    setError(null);
    const result = await clientAdminFetch("/api/admin/staff", { action: "rename-device", deviceId: editing.id, name });
    setBusy(null);
    if (result.ok) {
      setEditing(null);
      await load();
    } else setError(t(result.code === "DEVICE_NAME" ? "admin.devices.nameInvalid" : "admin.staff.error.generic"));
  };

  return (
    <section className="space-y-3" data-staff-devices>
      <div>
        <h2 className="flex items-center gap-2 font-display text-xl font-bold text-dark-brown dark:text-warm-white">
          <Tablet className="h-5 w-5 text-turquoise" />
          {t("admin.devices.title")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-coffee/60">
          {t("admin.devices.hint")}{" "}
          <Link href="/admin/qr" className="font-medium text-turquoise underline" data-devices-qr-link>
            {t("admin.devices.qrLink")}
          </Link>
        </p>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {devices === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-turquoise" />
      ) : devices.length > 0 ? (
        <ul className="grid gap-3 md:grid-cols-2" data-device-list>
          {devices.map((device) => (
            <li key={device.id} className="rounded-2xl bg-warm-white p-4 shadow-soft dark:bg-white/5" data-device={device.name}>
              {editing?.id === device.id ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={editing.name}
                    onChange={(e) => setEditing({ id: device.id, name: e.target.value })}
                    maxLength={40}
                    className="h-10"
                    aria-label={t("admin.devices.name")}
                    autoFocus
                    data-device-name-input
                  />
                  <Button type="button" size="icon" className="h-10 w-10 shrink-0" disabled={busy === device.id || !editing.name.trim()} onClick={() => void rename()} aria-label={t("admin.staff.save")} data-device-rename-save>
                    {busy === device.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="h-10 w-10 shrink-0" onClick={() => setEditing(null)} aria-label={t("admin.staff.cancel")}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-dark-brown dark:text-warm-white">{device.name}</p>
                    <p className="text-xs text-coffee/60">
                      {t(device.source === "qr" ? "admin.devices.viaQr" : "admin.devices.viaCode")} ·{" "}
                      {t("admin.devices.lastSeen").replace("{when}", dateTime(device.lastSeenAt))} · {t("admin.devices.until").replace("{when}", dateTime(device.expiresAt))}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditing({ id: device.id, name: device.name })} data-device-rename>
                      <Pencil className="h-3.5 w-3.5" />
                      {t("admin.devices.rename")}
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="border-red-200 text-red-700" disabled={busy === device.id} onClick={() => void revoke(device)} data-device-revoke>
                      {busy === device.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                      {t("admin.devices.disconnect")}
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-coffee/60">{t("admin.devices.none")}</p>
      )}
    </section>
  );
}
