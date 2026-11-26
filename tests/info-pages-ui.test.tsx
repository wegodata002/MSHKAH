import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInfoPages, type InfoPages } from "@/lib/info-pages/content";
import { INFO_PAGE_DRAFTS } from "@/lib/info-pages/drafts";

/**
 * Info pages rendered (jsdom): the public page with a published copy, and the admin editor's
 * publish flow. The database is mocked (the live site has nothing published yet, and the checks
 * never write to it).
 */

let locale: "he" | "ar" | "en" = "he";
vi.mock("@/components/providers/locale-provider", async () => {
  const { ADMIN_TRANSLATIONS } = await import("@/data/admin-translations");
  const { UI_TRANSLATIONS_SEED } = await import("@/data/ui-translations-seed");
  return {
    useT: () => (key: string, fallback?: string) => UI_TRANSLATIONS_SEED[locale][key] ?? ADMIN_TRANSLATIONS[locale][key] ?? fallback ?? key,
    useLocale: () => ({ locale, dir: locale === "en" ? "ltr" : "rtl" }),
  };
});
const setPanelOpen = vi.fn();
vi.mock("@/components/providers/accessibility-provider", () => ({ useAccessibility: () => ({ setPanelOpen }) }));
let pages: InfoPages | null = null;
vi.mock("@/hooks/useInfoPages", () => ({ useInfoPages: () => ({ pages, loading: false }) }));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ settings: null, loading: false }) }));
vi.mock("@/features/checkout/use-fulfillment-availability", () => ({
  useFulfillmentAvailability: () => ({
    loading: false,
    zones: [{ id: "z1", name: { he: "עין מאהל", ar: "عين ماهل", en: "Ein Mahil" }, fee: 15, minOrder: 50 }],
  }),
}));
const saveDraft = vi.fn(async () => {});
const publish = vi.fn(async (..._args: unknown[]) => ({ ok: true, missing: [] }));
vi.mock("@/services/infoPagesService", () => ({
  saveInfoPageDraft: (...args: unknown[]) => saveDraft(...(args as [])),
  publishInfoPage: (...args: unknown[]) => publish(...args),
  unpublishInfoPage: vi.fn(async () => {}),
}));
vi.mock("@/features/admin/components/admin-page-header", () => ({ AdminPageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));

const { InfoPageView } = await import("@/features/info-pages/info-page-view");
const { InfoPagesAdmin } = await import("@/features/admin/info-pages-admin");

const publishedTerms = {
  he: { body: "## כללי\nטקסט בעברית\n\n- פריט", items: [] },
  ar: { body: "", items: [] },
  en: { body: "## General\nEnglish text", items: [] },
};

beforeEach(() => {
  locale = "he";
  pages = parseInfoPages(
    { pages: { terms: { draft: publishedTerms, published: publishedTerms, publishedAt: "2026-11-26T08:00:00.000Z" }, faq: { draft: INFO_PAGE_DRAFTS.faq, published: INFO_PAGE_DRAFTS.faq } } },
    INFO_PAGE_DRAFTS
  );
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("public info page", () => {
  it("published: headings, paragraphs and lists; English in English", () => {
    locale = "en";
    render(<InfoPageView id="terms" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Terms of use");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("General");
    expect(screen.getByText("English text")).toBeTruthy();
  });

  it("a language left empty shows the Hebrew, right to left", () => {
    locale = "ar";
    const { container } = render(<InfoPageView id="terms" />);
    const body = container.querySelector("[data-info-body]")!;
    expect(body.getAttribute("dir")).toBe("rtl");
    expect(body.getAttribute("lang")).toBe("he");
    expect(body.textContent).toContain("טקסט בעברית");
  });

  it("not published: a short note, no text", () => {
    const { container } = render(<InfoPageView id="privacy" />);
    expect(container.querySelector("[data-info-unpublished]")).toBeTruthy();
    expect(container.querySelector("[data-info-body]")).toBeNull();
  });

  it("accessibility page opens the accessibility menu even before it is published", () => {
    const { container } = render(<InfoPageView id="accessibility" />);
    fireEvent.click(container.querySelector("[data-open-a11y]")!);
    expect(setPanelOpen).toHaveBeenCalledWith(true);
  });

  it("FAQ: hours and delivery areas from the settings, then the questions", () => {
    const { container } = render(<InfoPageView id="faq" />);
    expect(container.querySelector("[data-info-live]")!.textContent).toContain("עין מאהל");
    expect(container.querySelectorAll("[data-faq-item]")).toHaveLength(INFO_PAGE_DRAFTS.faq.he.items.length);
  });
});

describe("admin editor", () => {
  it("accessibility draft: places to fill are listed and Publish is blocked", () => {
    const { container } = render(<InfoPagesAdmin />);
    fireEvent.click(container.querySelector('[data-info-tab="accessibility"]')!);
    expect(container.querySelector("[data-info-placeholders]")!.textContent).toContain("[[שם]]");
    expect((container.querySelector("[data-info-publish]") as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector("[data-info-blocked]")).toBeTruthy();
  });

  it("FAQ: add a question, save the draft, publish", async () => {
    const { container } = render(<InfoPagesAdmin />);
    const rows = container.querySelectorAll("[data-faq-row]").length;
    fireEvent.click(container.querySelector("[data-faq-add]")!);
    expect(container.querySelectorAll("[data-faq-row]")).toHaveLength(rows + 1);
    const last = container.querySelectorAll("[data-faq-row]")[rows]!;
    fireEvent.change(last.querySelector("input")!, { target: { value: "שאלה חדשה?" } });
    fireEvent.change(last.querySelector("textarea")!, { target: { value: "תשובה." } });
    fireEvent.click(container.querySelector("[data-info-save]")!);
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(1));
    fireEvent.change(container.querySelectorAll("[data-faq-row]")[0]!.querySelector("input")!, { target: { value: "מתי פתוחים?" } });
    fireEvent.click(container.querySelector("[data-info-publish]")!);
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    const [id, draft] = publish.mock.calls[0]! as [string, { he: { items: Array<{ q: string }> } }];
    expect(id).toBe("faq");
    expect(draft.he.items[0]!.q).toBe("מתי פתוחים?");
  });
});
