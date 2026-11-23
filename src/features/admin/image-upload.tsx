"use client";

import { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Upload, X, Loader2, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/locale-provider";

interface ImageUploadProps {
  value?: string;
  onChange: (url: string) => void;
  onUpload: (
    file: File,
    onProgress: (pct: number) => void
  ) => Promise<{ success: boolean; data?: string; error?: string }>;
  onDelete?: (url: string) => Promise<void | unknown>;
  label?: string;
  className?: string;
  /** Smaller upload zone for dialogs (e.g. category create). */
  compact?: boolean;
  /**
   * "contain": small preview frame that shows the whole image without cropping
   * (logos / branding). Default "cover" keeps the full-width cropped preview.
   */
  fit?: "cover" | "contain";
}

export function ImageUpload({
  value,
  onChange,
  onUpload,
  onDelete,
  label,
  className,
  compact = false,
  fit = "cover",
}: ImageUploadProps) {
  const contain = fit === "contain";
  const t = useT();
  const resolvedLabel = label ?? t("admin.upload.image");
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setLastFile(file);
    if (!file.type.startsWith("image/")) {
      setError(t("admin.upload.selectImage"));
      return;
    }
    setUploading(true);
    setError(null);
    setProgress(0);

    if (value && onDelete) {
      await onDelete(value).catch(() => {});
    }

    const result = await onUpload(file, setProgress);
    setUploading(false);

    if (result.success && result.data) {
      onChange(result.data);
      setProgress(100);
    } else {
      setError(result.error ?? t("admin.upload.failed"));
    }
  };

  const handleRemove = async () => {
    if (value && onDelete) await onDelete(value);
    onChange("");
    setProgress(0);
  };

  return (
    <div className={cn("space-y-2", className)}>
      {zoomed && value ? <ImageLightbox src={value} onClose={() => setZoomed(false)} /> : null}
      <p className="text-sm font-medium text-dark-brown dark:text-warm-white">{resolvedLabel}</p>

      {value ? (
        <div
          className={cn(
            "relative w-full overflow-hidden rounded-xl border border-beige-dark/30 dark:border-white/10",
            contain ? "h-40 max-w-xs bg-beige/30 dark:bg-white/5" : compact ? "h-28" : "aspect-video"
          )}
        >
          <Image
            src={value}
            alt={t("admin.upload.preview")}
            fill
            unoptimized={value.includes("firebasestorage")}
            className={contain ? "object-contain p-2" : "object-cover"}
            sizes={contain ? "320px" : "400px"}
          />
          <button
            type="button"
            onClick={() => setZoomed(true)}
            aria-label={t("admin.upload.enlarge")}
            title={t("admin.upload.enlarge")}
            className="absolute top-2 start-2 flex h-8 w-8 items-center justify-center rounded-full bg-dark-brown/70 text-warm-white hover:bg-dark-brown"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          {!uploading && (
            <button
              type="button"
              onClick={handleRemove}
              className="absolute top-2 end-2 flex h-8 w-8 items-center justify-center rounded-full bg-dark-brown/70 text-warm-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void handleFile(file);
          }}
          className={cn(
            "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-beige-dark/50 bg-beige/20 transition-colors hover:border-turquoise/50 hover:bg-beige/40 dark:border-white/10 dark:bg-white/5",
            contain ? "h-40 max-w-xs py-3" : compact ? "h-28 py-3" : "aspect-video",
            dragging && "border-turquoise bg-turquoise/10"
          )}
        >
          {uploading ? (
            <Loader2 className={cn("animate-spin text-turquoise", compact ? "h-5 w-5" : "h-8 w-8")} />
          ) : (
            <Upload className={cn("text-coffee/40", compact ? "h-5 w-5" : "h-8 w-8")} />
          )}
          <span className="text-sm text-coffee/60 dark:text-warm-white/60">
            {uploading ? t("admin.upload.uploading") : t("admin.upload.clickToUpload")}
          </span>
          {!uploading && !compact && <span className="text-xs text-coffee/40">JPG / PNG / WEBP</span>}
        </button>
      )}

      {uploading && (
        <div className="h-2 overflow-hidden rounded-full bg-beige dark:bg-white/10">
          <div
            className="h-full rounded-full bg-turquoise transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-red-600">{error}</p>
          {lastFile && (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleFile(lastFile)}>
              {t("admin.action.retry")}
            </Button>
          )}
        </div>
      )}

      {value && !uploading && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-xl"
          onClick={() => inputRef.current?.click()}
        >
          {t("admin.upload.replace")}
        </Button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Full-screen image view (admin). Closes with the ✕ button, Esc, or a click on the backdrop. */
function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("admin.upload.preview")}
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- full-size original, any host */}
      <img
        src={src}
        alt={t("admin.upload.preview")}
        className="max-h-full max-w-full object-contain"
        onClick={(event) => event.stopPropagation()}
      />
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label={t("admin.upload.close")}
        className="absolute top-[calc(env(safe-area-inset-top,0px)+1rem)] end-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"
      >
        <X className="h-5 w-5" />
      </button>
    </div>,
    document.body
  );
}
