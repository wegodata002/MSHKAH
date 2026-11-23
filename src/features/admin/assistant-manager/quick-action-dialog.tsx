"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AdminModal,
  AdminModalBody,
  AdminModalFooter,
  AdminModalHeader,
  AdminModalTitle,
} from "@/features/admin/components/admin-modal";
import { LocalizedEditor } from "@/features/admin/assistant-manager/localized-editor";
import { ASSISTANT_QUICK_ICONS, resolveAssistantIcon } from "@/lib/icons/assistant-icons";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { cn } from "@/lib/utils";
import type {
  AssistantQuickAction,
  LocalizedText,
  QuickActionType,
} from "@/lib/assistant/types";
import type { Category, Product } from "@/types";

/**
 * Picker lists in this dialog: always open downward, capped height, and an always-visible
 * scrollbar so it's obvious the list scrolls. Radix hides the viewport scrollbar by default
 * (scrollbar-width:none + ::-webkit-scrollbar{display:none}); these overrides apply only here.
 */
const PICKER_LIST_CLASS = cn(
  "max-h-[min(18rem,var(--radix-select-content-available-height))]",
  // Square corners: the default rounded-xl clipped the scrollbar and its arrows.
  "rounded-none",
  "[&_[data-radix-select-viewport]]:overflow-y-scroll!",
  "[&_[data-radix-select-viewport]]:[scrollbar-width:thin]!",
  "[&_[data-radix-select-viewport]]:[scrollbar-color:rgba(61,43,36,0.4)_transparent]!",
  "[&_[data-radix-select-viewport]::-webkit-scrollbar]:block!",
  "[&_[data-radix-select-viewport]::-webkit-scrollbar]:w-2!",
  "[&_[data-radix-select-viewport]::-webkit-scrollbar-thumb]:rounded-full",
  "[&_[data-radix-select-viewport]::-webkit-scrollbar-thumb]:bg-coffee/40"
);

const EMPTY_TEXT: LocalizedText = { he: "", ar: "", en: "" };
const NEW_TYPES: QuickActionType[] = ["category", "product", "page", "whatsapp", "question"];

/**
 * Select list for this dialog with a bottom fade shown only while there is more to scroll
 * (also a cue on iOS, where Safari auto-hides scrollbars). The fade is sticky inside the
 * scrolling viewport and takes no space (-mt-8), so it never pushes or hides the last item at the end.
 */
function hasMoreToScroll(viewport: Element | null | undefined): boolean | null {
  if (!(viewport instanceof HTMLElement)) return null;
  return viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 4;
}

function PickerList({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(false);

  // Radix mounts the content when the list opens and positions it asynchronously:
  // measure after the first frame and again whenever the viewport is resized.
  useEffect(() => {
    let observer: ResizeObserver | null = null;
    const frame = requestAnimationFrame(() => {
      const viewport = contentRef.current?.querySelector("[data-radix-select-viewport]");
      const update = () => {
        const more = hasMoreToScroll(viewport);
        if (more !== null) setHasMore(more);
      };
      update();
      if (viewport && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(update);
        observer.observe(viewport);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  return (
    <SelectContent
      ref={contentRef}
      side="bottom"
      avoidCollisions={false}
      className={PICKER_LIST_CLASS}
      onScrollCapture={(event) => {
        const more = hasMoreToScroll(event.target as Element);
        if (more !== null) setHasMore(more);
      }}
    >
      {children}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none sticky bottom-0 -mt-8 h-8 bg-gradient-to-t from-warm-white to-transparent transition-opacity duration-150",
          hasMore ? "opacity-100" : "opacity-0"
        )}
      />
    </SelectContent>
  );
}

function emptyAction(sortOrder: number): AssistantQuickAction {
  return {
    id: `action-${Date.now()}`,
    icon: "coffee",
    label: { ...EMPTY_TEXT },
    action: "category",
    categoryId: "",
    enabled: true,
    sortOrder,
  };
}

export function QuickActionDialog({
  open,
  initial,
  sortOrder,
  categories,
  products,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initial: AssistantQuickAction | null;
  sortOrder: number;
  categories: Category[];
  products: Product[];
  onOpenChange: (open: boolean) => void;
  onSave: (action: AssistantQuickAction) => void;
}) {
  const t = useT();
  const { dir } = useLocale();
  const [step, setStep] = useState(0);
  const [action, setAction] = useState<AssistantQuickAction>(() => emptyAction(sortOrder));
  const iconNames = useMemo(() => Object.keys(ASSISTANT_QUICK_ICONS), []);

  useEffect(() => {
    if (!open) return;
    setAction(initial ? structuredClone(initial) : emptyAction(sortOrder));
    setStep(0);
  }, [initial, open, sortOrder]);

  const set = (patch: Partial<AssistantQuickAction>) =>
    setAction((current) => ({ ...current, ...patch }));

  const targetValid =
    action.action === "category"
      ? Boolean(action.categoryId)
      : action.action === "product"
        ? Boolean(action.productId)
        : action.action === "page" || action.action === "whatsapp"
          ? Boolean(action.url?.trim())
          : action.action === "question"
            ? Boolean(action.question?.he.trim())
            : true;

  return (
    <AdminModal open={open} onOpenChange={onOpenChange} size="md">
      <AdminModalHeader onClose={() => onOpenChange(false)}>
        <AdminModalTitle>
          {initial ? t("admin.assistant.editAction") : t("admin.assistant.addAction")}
        </AdminModalTitle>
        <p className="text-sm text-coffee/50">
          {t("admin.assistant.stepOf")
            .replace("{step}", String(step + 1))
            .replace("{count}", "4")}
        </p>
      </AdminModalHeader>
      <AdminModalBody>
          {step === 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {NEW_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => set({ action: type })}
                  className={cn(
                    "min-h-16 rounded-2xl border-2 px-4 text-start",
                    action.action === type
                      ? "border-turquoise bg-turquoise/10"
                      : "border-beige-dark/20 hover:border-turquoise/35"
                  )}
                >
                  {t(`admin.assistant.actionType.${type}`)}
                </button>
              ))}
              {!NEW_TYPES.includes(action.action) && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
                  {t("admin.assistant.legacyAction")}
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="mx-auto max-w-xl space-y-4">
              {action.action === "category" && (
                <div>
                  <label className="text-sm font-medium">{t("admin.assistant.chooseCategory")}</label>
                  {/* Always opens downward with a capped, scrollable height (native <select> opened upward and got cut off). */}
                  <Select
                    value={action.categoryId || ""}
                    onValueChange={(value) => set({ categoryId: value })}
                  >
                    <SelectTrigger className="mt-1 h-11" aria-label={t("admin.assistant.chooseCategory")}>
                      <SelectValue placeholder={t("admin.assistant.chooseCategory")} />
                    </SelectTrigger>
                    <PickerList>
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name_he || category.name_en}
                        </SelectItem>
                      ))}
                    </PickerList>
                  </Select>
                </div>
              )}
              {action.action === "product" && (
                <div>
                  <label className="text-sm font-medium">{t("admin.assistant.chooseProduct")}</label>
                  <Select
                    value={action.productId || ""}
                    onValueChange={(value) => set({ productId: value })}
                  >
                    <SelectTrigger className="mt-1 h-11" aria-label={t("admin.assistant.chooseProduct")}>
                      <SelectValue placeholder={t("admin.assistant.chooseProduct")} />
                    </SelectTrigger>
                    <PickerList>
                      {products.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name_he || product.name_en}
                        </SelectItem>
                      ))}
                    </PickerList>
                  </Select>
                </div>
              )}
              {(action.action === "page" || action.action === "whatsapp") && (
                <div>
                  <label className="text-sm font-medium">
                    {action.action === "whatsapp"
                      ? t("admin.assistant.whatsappLink")
                      : t("admin.assistant.pageLink")}
                  </label>
                  <Input
                    dir="ltr"
                    value={action.url || ""}
                    onChange={(event) => set({ url: event.target.value })}
                    className="mt-1 h-11"
                    placeholder={action.action === "whatsapp" ? "https://wa.me/..." : "/catalog"}
                  />
                </div>
              )}
              {action.action === "question" && (
                <LocalizedEditor
                  value={action.question || EMPTY_TEXT}
                  onChange={(question) => set({ question })}
                  multiline
                  requiredHe
                />
              )}
              {!NEW_TYPES.includes(action.action) && (
                <p className="rounded-xl bg-beige/30 p-4 text-sm">{t("admin.assistant.legacyTargetPreserved")}</p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="mx-auto max-w-xl">
              <p className="mb-3 text-sm text-coffee/55">{t("admin.assistant.actionLabelsHint")}</p>
              <LocalizedEditor value={action.label} onChange={(label) => set({ label })} requiredHe />
            </div>
          )}

          {step === 3 && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {iconNames.map((icon) => {
                const Icon = resolveAssistantIcon({ id: icon, icon });
                return (
                  <button
                    key={icon}
                    type="button"
                    onClick={() => set({ icon })}
                    className={cn(
                      "flex min-h-20 flex-col items-center justify-center gap-2 rounded-2xl border",
                      action.icon === icon
                        ? "border-turquoise bg-turquoise/10 text-turquoise"
                        : "border-beige-dark/20"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-[11px]">{t(`admin.assistant.icon.${icon}`, icon)}</span>
                  </button>
                );
              })}
            </div>
          )}
      </AdminModalBody>
      <AdminModalFooter className="justify-between">
        <Button
          variant="outline"
          onClick={() => (step === 0 ? onOpenChange(false) : setStep((current) => current - 1))}
        >
          {step === 0 ? t("admin.action.cancel") : t("common.back")}
        </Button>
        {step < 3 ? (
          <Button
            disabled={(step === 1 && !targetValid) || (step === 2 && !action.label.he.trim())}
            onClick={() => setStep((current) => current + 1)}
          >
            {t("common.continue")}
            {dir === "rtl" ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        ) : (
          <Button
            disabled={!action.label.he.trim()}
            onClick={() => {
              onSave(action);
              onOpenChange(false);
            }}
          >
            {initial ? t("admin.action.save") : t("admin.assistant.addAction")}
          </Button>
        )}
      </AdminModalFooter>
    </AdminModal>
  );
}
