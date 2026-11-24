import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkCoupon } from "@/lib/orders/coupons";

/** Pure — no Firebase, no network. */
describe("coupon check (cart + checkout)", () => {
  it("known codes are ok, in any case and with spaces", () => {
    expect(checkCoupon("MISHKAT10", 76)).toBe("ok");
    expect(checkCoupon(" welcome15 ", 76)).toBe("ok");
  });

  it("unknown or empty codes are invalid", () => {
    expect(checkCoupon("FREE100", 76)).toBe("invalid");
    expect(checkCoupon("", 76)).toBe("invalid");
    expect(checkCoupon(undefined, 76)).toBe("invalid");
  });

  it("the shown messages are the clear ones, not the generic error", () => {
    for (const file of ["src/features/cart/cart-panel.tsx", "src/app/checkout/page.tsx"]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, file).toMatch(/cart\.couponInvalid/);
      expect(source, file).toMatch(/cart\.couponTooLarge/);
      expect(source, file).not.toMatch(/error\.generic", "Invalid coupon code"/);
      // Typing in the field hides the old message.
      expect(source, file).toMatch(/setCouponInput\(value\);\s*\/\/[^\n]*\n\s*setCouponError\(null\);/);
    }
  });

  it("the three languages have both messages", () => {
    const seed = readFileSync(resolve(process.cwd(), "src/data/ui-translations-seed.ts"), "utf8");
    expect([...seed.matchAll(/"cart\.couponInvalid": "([^"]+)"/g)].map((m) => m[1])).toEqual([
      "קופון לא תקף",
      "القسيمة غير صالحة",
      "Invalid coupon",
    ]);
    expect([...seed.matchAll(/"cart\.couponTooLarge": "([^"]+)"/g)].map((m) => m[1])).toEqual([
      "ההנחה גדולה מסכום ההזמנה",
      "الخصم أكبر من مبلغ الطلب",
      "The discount is larger than the order amount",
    ]);
  });
});
