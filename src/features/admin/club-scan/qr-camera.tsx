"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useT } from "@/components/providers/locale-provider";

type Detector = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
type BarcodeDetectorCtor = {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats?: () => Promise<string[]>;
};

/** The browser's own QR reader when it has one (Chrome / Edge on Android and desktop). */
async function nativeDetector(): Promise<Detector | null> {
  const Ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return null;
  try {
    const formats = (await Ctor.getSupportedFormats?.()) ?? ["qr_code"];
    return formats.includes("qr_code") ? new Ctor({ formats: ["qr_code"] }) : null;
  } catch {
    return null;
  }
}

/**
 * Camera QR scanner for the staff screen. Uses the built-in BarcodeDetector where it exists, and
 * jsQR (loaded only here) everywhere else, e.g. Safari on iPhone / iPad. Stops the camera on the
 * first code read, on close, and when the screen is left.
 */
export function QrCamera({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<"starting" | "scanning" | "denied" | "no_camera">("starting");
  const done = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const stop = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("no_camera");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch (error) {
        const name = (error as { name?: string })?.name;
        setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "no_camera");
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      setStatus("scanning");

      const detector = await nativeDetector();
      const jsQR = detector ? null : (await import("jsqr")).default;

      const tick = async () => {
        if (stopped || done.current) return;
        let text: string | null = null;
        try {
          if (video.readyState >= 2 && video.videoWidth > 0) {
            if (detector) {
              const codes = await detector.detect(video);
              text = codes[0]?.rawValue ?? null;
            } else if (jsQR && ctx) {
              // Scaled-down frame: fast on phones, still plenty for a QR on a screen.
              const scale = Math.min(1, 640 / video.videoWidth);
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" })?.data ?? null;
            }
          }
        } catch {
          text = null;
        }
        if (text && !done.current) {
          done.current = true;
          stop();
          onResultRef.current(text);
          return;
        }
        timer = setTimeout(() => void tick(), 200);
      };
      void tick();
    })();

    return stop;
  }, []);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-black" data-qr-camera={status}>
      <video ref={videoRef} className="aspect-[4/3] w-full object-cover" playsInline muted />
      {status === "scanning" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-[60%] w-[60%] max-w-64 rounded-2xl border-4 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
      ) : null}
      {status !== "scanning" ? (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white">
          {status === "starting" ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <p>{t(status === "denied" ? "club3.scan.cameraDenied" : "club3.scan.noCamera")}</p>
          )}
        </div>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="absolute end-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white"
        aria-label={t("club3.scan.closeCamera")}
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}
