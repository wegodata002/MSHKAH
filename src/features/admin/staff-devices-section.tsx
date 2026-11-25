"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Tablet, Unplug } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clientAdminFetch } from "@/lib/auth/client-admin-fetch";
import type { StaffDeviceView } from "@/lib/staff/device";

function dateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jerusalem" });
}

/**
 * Admin → Staff → Fixed devices: cafe tablets that stay signed in to the waiter screen for 30 days.
 * "Connect a device" makes a one-time code (6 digits, 10 minutes) to type on the tablet; "Disconnect"
 * signs the tablet out on its next request.
 */
export function StaffDevicesSection() {
  const t = useT();
  const [devices, setDevices] = useState<StaffDeviceView[] | null>(null);
  const [name, setName] = useState("");
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await clientAdminFetch<{ devices: StaffDeviceView[] }>("/api/admin/staff", { action: "devices" });
    setDevices(result.ok && result.data ? result.data.devices : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createCode = async () => {
    setBusy("pair");
    setError(null);
    const deviceName = name.trim() || t("admin.devices.defaultName");
    const result = await clientAdminFetch<{ pairing: { code: string; expiresAt: string } }>("/api/admin/staff", { action: "pair-device", deviceName });
    setBusy(null);
    if (result.ok && result.data) {
      setPairing({ ...result.data.pairing, name: deviceName });
      setName("");
    } else setError(t("admin.staff.error.generic"));
  };

  const revoke = async (device: StaffDeviceView) => {
    setBusy(device.id);
    const result = await clientAdminFetch("/api/admin/staff", { action: "revoke-device", deviceId: device.id });
    setBusy(null);
    if (result.ok) await load();
    else setError(t("admin.staff.error.generic"));
  };

  return (
    <section className="space-y-3" data-staff-devices>
      <div>
        <h2 className="flex items-center gap-2 font-display text-xl font-bold text-dark-brown dark:text-warm-white">
          <Tablet className="h-5 w-5 text-turquoise" />
          {t("admin.devices.title")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-coffee/60">{t("admin.devices.hint")}</p>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {devices === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-turquoise" />
      ) : devices.length > 0 ? (
        <ul className="grid gap-3 md:grid-cols-2" data-device-list>
          {devices.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-3 rounded-2xl bg-warm-white p-4 shadow-soft dark:bg-white/5" data-device={device.name}>
              <div className="min-w-0">
                <p className="font-semibold text-dark-brown dark:text-warm-white">{device.name}</p>
                <p className="text-xs text-coffee/60">
                  {t("admin.devices.lastSeen").replace("{when}", dateTime(device.lastSeenAt))} · {t("admin.devices.until").replace("{when}", dateTime(device.expiresAt))}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" className="shrink-0 border-red-200 text-red-700" disabled={busy === device.id} onClick={() => void revoke(device)} data-device-revoke>
                {busy === device.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                {t("admin.devices.disconnect")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-coffee/60">{t("admin.devices.none")}</p>
      )}

      <div className="rounded-2xl border border-dashed border-beige-dark/40 p-4">
        {pairing ? (
          <div className="text-center" data-pairing-code>
            <p className="text-sm text-coffee/70">{t("admin.devices.codeFor").replace("{name}", pairing.name)}</p>
            <p className="my-2 font-mono text-4xl font-bold tracking-[0.3em] text-turquoise" dir="ltr">
              {pairing.code.slice(0, 3)} {pairing.code.slice(3)}
            </p>
            <p className="text-xs text-coffee/60">{t("admin.devices.codeHint").replace("{when}", dateTime(pairing.expiresAt))}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => { setPairing(null); void load(); }}>
              {t("admin.devices.done")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <Label htmlFor="device-name">{t("admin.devices.name")}</Label>
              <Input id="device-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("admin.devices.defaultName")} className="mt-1 h-11" maxLength={40} />
            </div>
            <Button type="button" className="h-11" disabled={busy === "pair"} onClick={() => void createCode()} data-device-connect>
              {busy === "pair" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t("admin.devices.connect")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
