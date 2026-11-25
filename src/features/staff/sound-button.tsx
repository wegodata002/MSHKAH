"use client";

import { BellRing } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";

/** Shown until the browser allows sound (it needs one tap on the page): turns on the alert beep. */
export function SoundButton({ onEnable }: { onEnable: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      // On pointerdown: the tap itself turns sound on and hides this button before a click would land.
      // onClick stays for the keyboard.
      onPointerDown={onEnable}
      onClick={onEnable}
      className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900"
      data-enable-sound
    >
      <BellRing className="h-4 w-4" />
      {t("staff.sound.enable")}
    </button>
  );
}
