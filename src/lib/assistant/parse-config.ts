import {
  DEFAULT_ASSISTANT_CONFIG,
  PREVIOUS_DEFAULT_GREETING,
  type AssistantConfig,
} from "@/lib/assistant/types";

/** A greeting still equal to the old default (never edited) shows the new default; edited ones stay. */
function upgradeGreeting(greeting: AssistantConfig["greeting"]): AssistantConfig["greeting"] {
  if (!greeting || typeof greeting !== "object") return greeting;
  const next = { ...greeting };
  for (const locale of ["he", "ar", "en"] as const) {
    if (typeof next[locale] === "string" && next[locale].trim() === PREVIOUS_DEFAULT_GREETING[locale]) {
      next[locale] = DEFAULT_ASSISTANT_CONFIG.greeting[locale];
    }
  }
  return next;
}

export function parseAssistantConfig(
  data: Record<string, unknown> | undefined
): AssistantConfig {
  if (!data) return { ...DEFAULT_ASSISTANT_CONFIG };

  const greeting = upgradeGreeting(
    (data.greeting as AssistantConfig["greeting"]) ??
      (data.welcomeMessage as AssistantConfig["greeting"]) ??
      DEFAULT_ASSISTANT_CONFIG.greeting
  );

  const rawActions =
    (data.quickActions as AssistantConfig["quickActions"]) ??
    DEFAULT_ASSISTANT_CONFIG.quickActions;

  return {
    ...DEFAULT_ASSISTANT_CONFIG,
    ...(data as Partial<AssistantConfig>),
    greeting,
    quickActions: rawActions.map((a, i) => ({
      ...a,
      enabled: a.enabled ?? true,
      sortOrder: a.sortOrder ?? i,
    })),
    suggestedQuestions:
      (data.suggestedQuestions as AssistantConfig["suggestedQuestions"]) ??
      DEFAULT_ASSISTANT_CONFIG.suggestedQuestions,
    faq: ((data.faq as AssistantConfig["faq"]) ?? []).map((f, i) => ({
      ...f,
      enabled: f.enabled ?? true,
      sortOrder: f.sortOrder ?? i,
    })),
    featuredProductIds:
      (data.featuredProductIds as string[]) ??
      DEFAULT_ASSISTANT_CONFIG.featuredProductIds,
    links: (data.links as AssistantConfig["links"]) ?? DEFAULT_ASSISTANT_CONFIG.links,
  };
}
