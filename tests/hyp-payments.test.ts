import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  amountFromOrderItems,
  authoritativeOrderAmount,
  amountsMatch,
  chargeFromCatalogSum,
  formatHypAmount,
  parseHypAmount,
} from "@/lib/payments/hyp/amounts";
import { couponRate } from "@/lib/orders/coupons";
import { applyHypCustomerParams } from "@/lib/payments/hyp/client";
import { splitHypCustomerName } from "@/lib/payments/hyp/names";
import { normalizeCustomerEmail } from "@/lib/orders/customer-email";
import { hasRequiredHypCredentials } from "@/lib/payments/hyp/config";
import { decidePaymentUpdate } from "@/lib/payments/hyp/decide";
import {
  isHypSuccessCCode,
  parseHypRedirect,
  parseOrderedQuery,
  stripSecretsFromQuery,
} from "@/lib/payments/hyp/query";
import { getHypReturnUrl, getPaymentPublicOrigin } from "@/lib/payments/hyp/urls";
import { isMenuBlockedApiPath } from "@/lib/domains/host-routing";

const baseOrder = {
  id: "order-1",
  total: 44.5,
  status: "pending",
  paymentStatus: "pending",
};

const basePayment = {
  id: "pay-1",
  orderId: "order-1",
  amount: 44.5,
  status: "pending",
};

describe("HYP amount handling", () => {
  it("formats and parses two-decimal amounts", () => {
    expect(formatHypAmount(44.5)).toBe("44.50");
    expect(formatHypAmount(10)).toBe("10.00");
    expect(parseHypAmount("10.5")).toBe(10.5);
    expect(amountsMatch(10, "10.00")).toBe(true);
    expect(amountsMatch(44.5, "1")).toBe(false);
  });

  it("reads only the stored order total and ignores a client amount", () => {
    const clientBody = { orderId: "order-1", amount: 1 };
    expect(authoritativeOrderAmount({ total: 44.5 })).toBe(44.5);
    expect(authoritativeOrderAmount({ total: clientBody.amount })).not.toBe(44.5);
    expect(authoritativeOrderAmount({ total: 0 })).toBe(0);
  });

  it("ignores a manipulated checkout total when line items exist", () => {
    const order = {
      total: 1,
      discount: 0,
      delivery: 0,
      items: [
        { price: 36, quantity: 1 },
        { price: 8, quantity: 2 },
      ],
    };
    expect(amountFromOrderItems(order)).toBe(52);
    expect(authoritativeOrderAmount(order)).toBe(52);
  });
});

describe("HYP server-side coupon discount", () => {
  it("ignores a forged client discount when there is no coupon", () => {
    const forgedOrder = { discount: 99.99, total: 0.01, delivery: 0 };
    const charge = chargeFromCatalogSum(100, forgedOrder);
    expect(charge).toEqual({ amount: 100, discount: 0, subtotal: 100 });
  });

  it("applies exactly 10% for MISHKAT10 (case/space-insensitive)", () => {
    expect(chargeFromCatalogSum(100, { couponCode: "MISHKAT10" })).toEqual({
      amount: 90,
      discount: 10,
      subtotal: 100,
    });
    expect(chargeFromCatalogSum(44.5, { couponCode: "  mishkat10 " })).toEqual({
      amount: 40.05,
      discount: 4.45,
      subtotal: 44.5,
    });
  });

  it("applies exactly 15% for WELCOME15", () => {
    expect(chargeFromCatalogSum(100, { couponCode: "WELCOME15" })).toEqual({
      amount: 85,
      discount: 15,
      subtotal: 100,
    });
    expect(chargeFromCatalogSum(33, { couponCode: "welcome15" })).toEqual({
      amount: 28.05,
      discount: 4.95,
      subtotal: 33,
    });
  });

  it("gives no discount for unknown or empty codes", () => {
    for (const code of ["FREE100", "MISHKAT", "", undefined, null, 15, "toString"]) {
      expect(couponRate(code)).toBe(0);
      expect(chargeFromCatalogSum(100, { couponCode: code })).toEqual({
        amount: 100,
        discount: 0,
        subtotal: 100,
      });
    }
  });
});

describe("HYP name split", () => {
  it("keeps a single token as first name", () => {
    expect(splitHypCustomerName("תסנים")).toEqual({ firstName: "תסנים", lastName: "" });
  });

  it("uses first token / remainder for multi-word names", () => {
    expect(splitHypCustomerName("תסנים אבוליל")).toEqual({
      firstName: "תסנים",
      lastName: "אבוליל",
    });
    expect(splitHypCustomerName("تسنيم أبو ليل")).toEqual({
      firstName: "تسنيم",
      lastName: "أبو ليل",
    });
    expect(splitHypCustomerName("Tasneem Abuliel")).toEqual({
      firstName: "Tasneem",
      lastName: "Abuliel",
    });
  });
});

describe("HYP customer prefill", () => {
  it("uses documented email / ClientName / cell and never Fild fields", () => {
    const params = applyHypCustomerParams(new URLSearchParams(), {
      amount: "84.00",
      orderRef: "pay-1",
      clientName: "Test Customer",
      cell: "0500000000",
      email: "guest@example.com",
      info: "Mishkat #1001",
      pageLang: "HEB",
    });
    expect(params.get("email")).toBe("guest@example.com");
    expect(params.get("ClientName")).toBe("Test");
    expect(params.get("ClientLName")).toBe("Customer");
    expect(params.get("UTF8")).toBe("True");
    expect(params.get("UTF8out")).toBe("True");
    expect(params.get("cell")).toBe("0500000000");
    expect(params.get("phone")).toBe("0500000000");
    expect(params.get("Order")).toBe("pay-1");
    expect(params.get("Fild1")).toBeNull();
    expect(params.get("Fild2")).toBeNull();
    expect(params.toString().includes("%25")).toBe(false);
  });

  it("encodes Hebrew and Arabic names once for HYP", () => {
    const he = applyHypCustomerParams(new URLSearchParams(), {
      amount: "2.00",
      orderRef: "pay-he",
      clientName: "תסנים אבוליל",
      pageLang: "HEB",
    });
    expect(he.get("ClientName")).toBe("תסנים");
    expect(he.get("ClientLName")).toBe("אבוליל");
    expect(decodeURIComponent(he.toString())).toContain("תסנים");

    const ar = applyHypCustomerParams(new URLSearchParams(), {
      amount: "2.00",
      orderRef: "pay-ar",
      clientName: "تسنيم أبو ليل",
      pageLang: "HEB",
    });
    expect(ar.get("ClientName")).toBe("تسنيم");
    expect(ar.get("ClientLName")).toBe("أبو ليل");
  });

  it("normalizes customer emails", () => {
    expect(normalizeCustomerEmail("  A@Ex.Com ")).toBe("a@ex.com");
    expect(normalizeCustomerEmail("user@gmal.com")).toBe("user@gmail.com");
    expect(normalizeCustomerEmail("not-an-email")).toBeNull();
    expect(normalizeCustomerEmail("")).toBeNull();
  });

  it("lowercases the HYP email parameter", () => {
    const params = applyHypCustomerParams(new URLSearchParams(), {
      amount: "10.00",
      orderRef: "pay-2",
      email: "  Guest@Example.COM ",
      pageLang: "HEB",
    });
    expect(params.get("email")).toBe("guest@example.com");
  });
});

describe("HYP redirect parsing and verification inputs", () => {
  it("preserves query parameter order for VERIFY", () => {
    const raw = "Id=408941655&CCode=0&Amount=10&ACode=0505293&Order=pay-1&Sign=abc";
    const pairs = parseOrderedQuery(raw);
    expect(pairs.map((pair) => pair.key)).toEqual([
      "Id",
      "CCode",
      "Amount",
      "ACode",
      "Order",
      "Sign",
    ]);
    const parsed = parseHypRedirect(raw);
    expect(parsed.id).toBe("408941655");
    expect(parsed.order).toBe("pay-1");
    expect(isHypSuccessCCode(parsed.cCode)).toBe(true);
  });

  it("strips secrets from logged query strings", () => {
    const stripped = stripSecretsFromQuery("Id=1&KEY=secret&PassP=hidden&Sign=abc");
    expect(stripped.toLowerCase()).not.toContain("secret");
    expect(stripped.toLowerCase()).not.toContain("hidden");
    expect(stripped).toContain("Id=1");
  });
});

describe("HYP payment decision", () => {
  it("marks paid only after server verification and matching amount", () => {
    expect(
      decidePaymentUpdate({
        order: baseOrder,
        payment: basePayment,
        verified: true,
        resultCCode: "0",
        returnedAmount: "44.50",
        returnedOrder: "pay-1",
        transactionId: "408941655",
      })
    ).toEqual({ action: "mark_paid" });
  });

  it("does not mark paid from a return URL alone", () => {
    expect(
      decidePaymentUpdate({
        order: baseOrder,
        payment: basePayment,
        verified: false,
        resultCCode: "0",
        returnedAmount: "44.50",
        returnedOrder: "pay-1",
        transactionId: "408941655",
      })
    ).toEqual({ action: "reject", reason: "verify_failed" });
  });

  it("does not mark paid on cancel or failed result codes", () => {
    expect(
      decidePaymentUpdate({
        order: baseOrder,
        payment: basePayment,
        verified: true,
        resultCCode: "600",
        returnedAmount: "44.50",
        returnedOrder: "pay-1",
        transactionId: "",
      }).action
    ).toBe("mark_cancelled");

    expect(
      decidePaymentUpdate({
        order: baseOrder,
        payment: basePayment,
        verified: true,
        resultCCode: "4",
        returnedAmount: "44.50",
        returnedOrder: "pay-1",
        transactionId: "9",
      }).action
    ).toBe("mark_failed");
  });

  it("rejects a mismatched amount even if HYP says success", () => {
    expect(
      decidePaymentUpdate({
        order: baseOrder,
        payment: basePayment,
        verified: true,
        resultCCode: "0",
        returnedAmount: "1.00",
        returnedOrder: "pay-1",
        transactionId: "408941655",
      })
    ).toEqual({ action: "reject", reason: "amount_mismatch" });
  });

  it("is idempotent for an already-paid order or attempt", () => {
    expect(
      decidePaymentUpdate({
        order: { ...baseOrder, paymentStatus: "paid" },
        payment: { ...basePayment, status: "paid", hypTransactionId: "408941655" },
        verified: true,
        resultCCode: "0",
        returnedAmount: "44.50",
        returnedOrder: "pay-1",
        transactionId: "408941655",
      })
    ).toEqual({ action: "already_processed", outcome: "paid" });
  });
});

describe("HYP configuration and public URLs", () => {
  it("does not treat HYP as enabled without server credentials", () => {
    expect(hasRequiredHypCredentials({ masof: "4502465131", apiKey: "", passP: "" })).toBe(false);
    expect(hasRequiredHypCredentials({ masof: "", apiKey: "x", passP: "y" })).toBe(false);
    expect(hasRequiredHypCredentials({ masof: "4502465131", apiKey: "x", passP: "y" })).toBe(true);
  });

  it("accepts a 10-digit masof from either HYP_MASOF or the terminal alias", () => {
    expect(hasRequiredHypCredentials({ masof: "4502465131", apiKey: "x", passP: "y" })).toBe(true);
    expect(hasRequiredHypCredentials({ masof: "123", apiKey: "x", passP: "y" })).toBe(false);
  });

  it("builds production return URLs without localhost", () => {
    expect(getPaymentPublicOrigin()).toMatch(/^https:\/\//);
    expect(getPaymentPublicOrigin()).not.toContain("localhost");
    expect(getHypReturnUrl()).toBe(`${getPaymentPublicOrigin()}/api/payments/hyp/return`);
  });

  it("blocks payment APIs on the menu host", () => {
    expect(isMenuBlockedApiPath("/api/payments/hyp/create")).toBe(true);
  });
});

describe("HYP secrets stay server-side", () => {
  it("does not expose HYP credentials on NEXT_PUBLIC_ env names", () => {
    const files = collectSourceFiles(resolve(process.cwd(), "src"));
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/NEXT_PUBLIC_HYP_/);
      expect(source, file).not.toMatch(/HYP_API_KEY\s*=\s*["'][^"']+["']/);
      expect(source, file).not.toMatch(/HYP_PASSP\s*=\s*["'][^"']+["']/);
    }
  });
});

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...collectSourceFiles(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}
