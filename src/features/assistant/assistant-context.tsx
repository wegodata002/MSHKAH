"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_ASSISTANT_CONFIG,
  type AssistantConfig,
  type AssistantChatResponse,
  type AssistantProduct,
} from "@/lib/assistant/types";
import { subscribeToAssistantConfig } from "@/services/assistantService";
import { subscribeToSettings, type AppSettings } from "@/services/settingsService";
import { DEFAULT_OPENING_HOURS, openingHoursText } from "@/lib/settings/opening-hours";
import { DEFAULT_FULFILLMENT } from "@/lib/fulfillment/settings";
import { buildAssistantContext } from "@/lib/assistant/build-context";
import { cartReply, processMessage, processQuickAction } from "@/lib/assistant/engine";
import type { AssistantChatRequest } from "@/lib/assistant/types";
import type { Category, Product } from "@/types";
import { useCart } from "@/features/cart/cart-context";
import { useLocale, useT } from "@/components/providers/locale-provider";
import { useAllProducts, useAllCategories } from "@/hooks/useProducts";
import type { Locale } from "@/lib/i18n/types";

const STORAGE_KEY = "mishkat-assistant-chat";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  products?: AssistantProduct[];
  showContact?: boolean;
  showCart?: boolean;
  timestamp: number;
}

type AssistantContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  messages: AssistantMessage[];
  isLoading: boolean;
  config: AssistantConfig;
  settings: AppSettings | null;
  enabled: boolean;
  selectedProduct: AssistantProduct | null;
  suggestions: string[];
  sendMessage: (text: string) => Promise<void>;
  sendQuickAction: (actionId: string, label: string) => Promise<void>;
  viewProduct: (product: AssistantProduct) => Promise<void>;
  addProductToCart: (productId: string, quantity?: number) => void;
  clearHistory: () => void;
  /** Header cart button: adds the cart (one live card) at the end of the conversation. */
  showCartInChat: () => void;
  setSelectedProduct: (product: AssistantProduct | null) => void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

function loadMessages(): AssistantMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AssistantMessage[]) : [];
  } catch {
    return [];
  }
}

/** The same context the server builds, from the data the browser already has. */
function clientContext(
  locale: Locale,
  products: Product[],
  categories: Category[],
  config: AssistantConfig,
  settings: AppSettings | null
) {
  return buildAssistantContext({
    locale,
    products,
    categories,
    config,
    banners: [],
    store: {
      phone: settings?.phone ?? "",
      address: settings?.address ?? "",
      hoursText: openingHoursText(settings, locale),
      whatsapp: settings?.social?.whatsapp?.trim() ?? "",
      mapsUrl: settings?.mapsUrl ?? "",
      fulfillment: settings?.fulfillment ?? DEFAULT_FULFILLMENT,
      openingHours: settings?.openingHours ?? DEFAULT_OPENING_HOURS,
    },
  });
}

/**
 * When the assistant server does not answer, the browser runs the same engine on the same kind of
 * context, so the answers match the server (no separate fallback texts that can drift).
 */
function clientFallback(
  actionId: string | undefined,
  req: AssistantChatRequest,
  ctx: ReturnType<typeof clientContext>
): AssistantChatResponse {
  return actionId ? processQuickAction(actionId, ctx, req) : processMessage(req, ctx);
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const t = useT();
  const router = useRouter();
  const { items, addItem, removeItem } = useCart();
  const { products } = useAllProducts();
  const { categories } = useAllCategories();

  const [isOpen, setIsOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<AssistantProduct | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [config, setConfig] = useState<AssistantConfig>(DEFAULT_ASSISTANT_CONFIG);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setMessages(loadMessages());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-50)));
  }, [messages, hydrated]);

  useEffect(() => subscribeToAssistantConfig(setConfig, () => {}), []);
  useEffect(() => subscribeToSettings(setSettings, () => {}), []);

  // The suggested questions from the settings stay above the input at all times (after
  // questions and after a refresh), not only before the first message.
  const suggestions = useMemo(
    () => config.suggestedQuestions.map((q) => q[locale]).filter(Boolean).slice(0, 6),
    [config.suggestedQuestions, locale]
  );

  const cartProductIds = useMemo(
    () => items.flatMap((i) => Array.from({ length: i.quantity }, () => i.product.id)),
    [items]
  );

  const cartItems = useMemo(
    () => items.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
    [items]
  );

  const applyAction = useCallback(
    (response: AssistantChatResponse) => {
      const action = response.clientAction;
      if (!action) return;
      switch (action.type) {
        case "show_cart":
          // The cart card is part of the reply message (showCart); nothing else to open.
          break;
        case "checkout":
          // "My order": close the chat and go to the checkout.
          setIsOpen(false);
          router.push("/checkout");
          break;
        case "open_url":
          if (action.url.startsWith("/")) {
            router.push(action.url);
          } else {
            try {
              const url = new URL(action.url);
              if (url.protocol === "https:" || url.protocol === "http:") {
                window.open(url.toString(), "_blank", "noopener,noreferrer");
              }
            } catch {
              // Ignore invalid admin-configured URLs.
            }
          }
          break;
        case "remove_from_cart": {
          const line = items.find((i) => i.product.id === action.productId);
          if (line) removeItem(line.lineId);
          break;
        }
      }
    },
    [removeItem, router, items]
  );

  const fetchAssistant = useCallback(
    async (body: Record<string, unknown>): Promise<AssistantChatResponse> => {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.message) {
          return { message: data.message, products: data.products || [], suggestions: data.suggestions || [] };
        }
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<AssistantChatResponse>;
    },
    []
  );

  const appendReply = useCallback(
    (response: AssistantChatResponse) => {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: response.message,
          products: response.products,
          showContact: response.showContact,
          showCart: response.showCart,
          timestamp: Date.now(),
        },
      ]);
      applyAction(response);
    },
    [applyAction]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      setSelectedProduct(null);
      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", content: trimmed, timestamp: Date.now() },
      ]);
      setIsLoading(true);

      try {
        const response = await fetchAssistant({
          message: trimmed,
          locale,
          cartProductIds,
          cartItems,
        });
        appendReply(response);
      } catch (err) {
        console.error("[MISHKAT_ASSISTANT]", err);
        const fallback = clientFallback(
          undefined,
          { message: trimmed, locale, cartProductIds, cartItems },
          clientContext(locale, products, categories, config, settings)
        );
        appendReply(fallback);
      } finally {
        setIsLoading(false);
      }
    },
    [isLoading, fetchAssistant, locale, cartProductIds, cartItems, appendReply, products, categories, config, settings]
  );

  const sendQuickAction = useCallback(
    async (actionId: string, label: string) => {
      setSelectedProduct(null);
      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", content: label, timestamp: Date.now() },
      ]);
      setIsLoading(true);
      try {
        const response = await fetchAssistant({
          message: "",
          locale,
          cartProductIds,
          cartItems,
          quickActionId: actionId,
        });
        appendReply(response);
      } catch (err) {
        console.error("[MISHKAT_ASSISTANT]", err);
        const fallback = clientFallback(
          actionId,
          { message: "", locale, cartProductIds, cartItems, quickActionId: actionId },
          clientContext(locale, products, categories, config, settings)
        );
        appendReply(fallback);
      } finally {
        setIsLoading(false);
      }
    },
    [fetchAssistant, locale, cartProductIds, cartItems, appendReply, products, categories, config, settings]
  );

  const viewProduct = useCallback(
    async (product: AssistantProduct) => {
      setSelectedProduct(product);
      setIsLoading(true);
      try {
        const response = await fetchAssistant({
          message: "",
          locale,
          cartProductIds,
          cartItems,
          productId: product.id,
        });
        appendReply(response);
      } catch {
        appendReply({
          message: product.name,
          products: [product],
          suggestions: [],
        });
      } finally {
        setIsLoading(false);
      }
    },
    [fetchAssistant, locale, cartProductIds, cartItems, appendReply]
  );

  const addProductToCart = useCallback(
    (productId: string, quantity = 1) => {
      const product = products.find((p) => p.id === productId);
      if (!product?.available) return;
      for (let i = 0; i < quantity; i++) addItem(product);
      const name =
        locale === "he"
          ? product.name_he || product.name_en
          : locale === "ar"
            ? product.name_ar || product.name_he
            : product.name_en || product.name_he;
      const addedMsg = t("assistant.addedToCart", `✓ ${name} added to cart`).replace("{name}", name);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: addedMsg,
          showCart: true,
          timestamp: Date.now(),
        },
      ]);
    },
    [products, addItem, locale, t]
  );

  const showCartInChat = useCallback(() => {
    setSelectedProduct(null);
    const reply = cartReply(clientContext(locale, products, categories, config, settings), {
      message: "",
      locale,
      cartProductIds,
      cartItems,
    });
    setMessages((prev) => [
      ...prev,
      { id: `a-${Date.now()}`, role: "assistant", content: reply.message, showCart: reply.showCart, timestamp: Date.now() },
    ]);
  }, [locale, products, categories, config, settings, cartProductIds, cartItems]);

  const clearHistory = useCallback(() => {
    setMessages([]);
    setSelectedProduct(null);
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((p) => !p),
      messages,
      isLoading,
      config,
      settings,
      enabled: config.enabled,
      selectedProduct,
      suggestions,
      sendMessage,
      sendQuickAction,
      viewProduct,
      addProductToCart,
      clearHistory,
      showCartInChat,
      setSelectedProduct,
    }),
    [
      isOpen,
      messages,
      isLoading,
      config,
      settings,
      selectedProduct,
      suggestions,
      sendMessage,
      sendQuickAction,
      viewProduct,
      addProductToCart,
      clearHistory,
      showCartInChat,
    ]
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant() {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used within AssistantProvider");
  return ctx;
}

export function useAssistantCart() {
  return useCart();
}
