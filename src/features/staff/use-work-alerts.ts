"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { titleWithBadge } from "@/lib/staff/alerts";

/**
 * New work on a staff screen: a short beep, vibration (Android; iPhones have none), and a count in
 * the tab title ("(2) MISHKAT") while the tab is in the background — cleared when it is seen.
 *
 * Browsers play sound only after a tap on the page: until then `soundReady` is false and the screen
 * shows a "turn on sound" button (`enableSound`).
 */
export function useWorkAlerts() {
  const audio = useRef<AudioContext | null>(null);
  const baseTitle = useRef<string>("");
  const [soundReady, setSoundReady] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [visible, setVisible] = useState(true);

  /** Starts sound if the browser allows it now; resolves once it is known. */
  const unlock = useCallback(async (): Promise<boolean> => {
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!audio.current && Ctor) audio.current = new Ctor();
      const ctx = audio.current;
      if (!ctx) return false;
      await ctx.resume().catch(() => undefined);
      const running = ctx.state === "running";
      setSoundReady(running);
      return running;
    } catch {
      // No sound on this browser; vibration, the title and the highlight still work.
      return false;
    }
  }, []);

  const beep = useCallback(() => {
    const ctx = audio.current;
    if (!ctx || ctx.state !== "running") return;
    try {
      for (const [offset, freq] of [[0, 880], [0.22, 1175]] as const) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = ctx.currentTime + offset;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.2);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    baseTitle.current = titleWithBadge(document.title, 0);
    // After signing in on the keypad the page was already tapped: sound may start right away.
    void unlock();
    const onTap = () => void unlock();
    window.addEventListener("pointerdown", onTap);
    const onVisibility = () => {
      const isVisible = document.visibilityState === "visible";
      setVisible(isVisible);
      if (isVisible) {
        setUnseen(0);
        // Some browsers suspend sound in the background.
        if (audio.current && audio.current.state !== "running") void audio.current.resume().then(() => setSoundReady(audio.current?.state === "running")).catch(() => undefined);
      }
    };
    setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointerdown", onTap);
      document.removeEventListener("visibilitychange", onVisibility);
      document.title = baseTitle.current;
      void audio.current?.close().catch(() => undefined);
      audio.current = null;
    };
  }, [unlock]);

  useEffect(() => {
    if (baseTitle.current) document.title = titleWithBadge(baseTitle.current, unseen);
  }, [unseen]);

  /** Something new arrived (`count` items): beep, vibrate, and count it in the title if the tab is hidden. */
  const notify = useCallback(
    (count = 1) => {
      if (count <= 0) return;
      try {
        navigator.vibrate?.([200, 100, 200]);
      } catch {
        // ignore
      }
      beep();
      if (document.visibilityState !== "visible") setUnseen((n) => n + count);
    },
    [beep]
  );

  /** The "turn on sound" button: unlock and play one beep so the user hears it works. */
  const enableSound = useCallback(() => {
    void unlock().then((running) => running && beep());
  }, [beep, unlock]);

  return { notify, soundReady, enableSound, visible, unseen };
}

/**
 * Keys highlighted on screen for new work: kept while the tab is hidden, and cleared `ms` after the
 * screen is seen (so a courier coming back from another app still sees what is new).
 */
export function useSeenHighlight(visible: boolean, ms: number) {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const add = useCallback((more: string[]) => {
    if (more.length) setKeys((prev) => new Set([...prev, ...more]));
  }, []);
  useEffect(() => {
    if (!visible || keys.size === 0) return;
    const timer = window.setTimeout(() => setKeys(new Set()), ms);
    return () => window.clearTimeout(timer);
  }, [keys, ms, visible]);
  return { keys, add };
}

/** Fixed cafe tablet: keep the screen on while the waiter screen is open (where the browser allows). */
export function useScreenWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    let stopped = false;
    const request = async () => {
      try {
        if (document.visibilityState !== "visible") return;
        lock = await (navigator as unknown as { wakeLock: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock.request("screen");
        if (stopped) void lock.release().catch(() => undefined);
      } catch {
        // Not allowed now (battery saver etc.): the tablet's own sleep setting applies.
      }
    };
    // The lock is dropped whenever the tab is hidden; take it again when it is back.
    const onVisibility = () => document.visibilityState === "visible" && void request();
    void request();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => undefined);
    };
  }, [enabled]);
}
