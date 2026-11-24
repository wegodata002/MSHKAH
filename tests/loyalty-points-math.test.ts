import { describe, it, expect } from "vitest";
import {
  pointsForAmount,
  pointsToReverseForRefund,
  planRedemption,
  qualifyingAmountMinor,
  toMinor,
  fromMinor,
} from "@/lib/loyalty/points-math";

describe("pointsForAmount — every ₪X = 1 point (default ₪100)", () => {
  const P100 = toMinor(100); // ₪100 per point

  it("₪100 → 1 point; ₪250 → 2 points (rounds down)", () => {
    expect(pointsForAmount({ qualifyingAmountMinor: toMinor(100), spendPerPointMinor: P100 }).points).toBe(1);
    expect(pointsForAmount({ qualifyingAmountMinor: toMinor(250), spendPerPointMinor: P100 }).points).toBe(2);
  });

  it("below the threshold never fabricates a point: ₪99.99 → 0", () => {
    expect(pointsForAmount({ qualifyingAmountMinor: 9999, spendPerPointMinor: P100 }).points).toBe(0);
  });

  it("the manager's value: ₪10 per point → ₪149 = 14 points", () => {
    expect(pointsForAmount({ qualifyingAmountMinor: toMinor(149), spendPerPointMinor: toMinor(10) }).points).toBe(14);
  });

  it("nearest rounding: ₪150 at ₪100 per point → 2", () => {
    expect(
      pointsForAmount({ qualifyingAmountMinor: toMinor(150), spendPerPointMinor: P100, roundingMode: "nearest" }).points
    ).toBe(2);
    expect(
      pointsForAmount({ qualifyingAmountMinor: toMinor(149), spendPerPointMinor: P100, roundingMode: "nearest" }).points
    ).toBe(1);
  });

  it("0 amount or 0 ratio → 0 points", () => {
    expect(pointsForAmount({ qualifyingAmountMinor: 0, spendPerPointMinor: P100 }).points).toBe(0);
    expect(pointsForAmount({ qualifyingAmountMinor: toMinor(500), spendPerPointMinor: 0 }).points).toBe(0);
  });

  it("carry keeps the leftover across small orders", () => {
    // Twenty ₪5 orders at ₪100 per point → exactly 1 point overall.
    let carry = 0;
    let total = 0;
    for (let i = 0; i < 20; i += 1) {
      const result = pointsForAmount({ qualifyingAmountMinor: toMinor(5), spendPerPointMinor: P100, carryMinor: carry });
      total += result.points;
      carry = result.carryMinor;
    }
    expect(total).toBe(1);
    expect(carry).toBe(0);
  });
});

describe("qualifyingAmountMinor — exclusions", () => {
  it("excludes the join fee portion", () => {
    expect(
      qualifyingAmountMinor({
        paidAmountMinor: toMinor(120),
        joinFeePortionMinor: toMinor(20),
      })
    ).toBe(toMinor(100));
  });

  it("excludes the redeemed-points value portion", () => {
    expect(
      qualifyingAmountMinor({
        paidAmountMinor: toMinor(100),
        redeemedValueMinor: toMinor(10),
      })
    ).toBe(toMinor(90));
  });

  it("never returns a negative qualifying amount", () => {
    expect(
      qualifyingAmountMinor({
        paidAmountMinor: toMinor(10),
        joinFeePortionMinor: toMinor(20),
      })
    ).toBe(0);
  });
});

describe("planRedemption — refuses to redeem until configured and approved", () => {
  const baseSettings = {
    redemptionEnabled: true,
    pointValueMinor: 100, // 1 point = 1 ILS
    pointValueApproved: true,
    redemptionMinPoints: 10,
    redemptionMaxPoints: 500,
  };

  it("plans a clean redemption inside the limits", () => {
    const plan = planRedemption({
      requestedPoints: 20,
      balancePoints: 50,
      orderSubtotalMinor: toMinor(80),
      settings: baseSettings,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.spentPoints).toBe(20);
    expect(plan.discountMinor).toBe(toMinor(20));
  });

  it("refuses when redemption is disabled", () => {
    const plan = planRedemption({
      requestedPoints: 20,
      balancePoints: 50,
      orderSubtotalMinor: toMinor(80),
      settings: { ...baseSettings, redemptionEnabled: false },
    });
    expect(plan.ok).toBe(false);
    expect((plan as { reason: string }).reason).toBe("redemption_disabled");
  });

  it("refuses when point value has not been approved", () => {
    const plan = planRedemption({
      requestedPoints: 20,
      balancePoints: 50,
      orderSubtotalMinor: toMinor(80),
      settings: { ...baseSettings, pointValueApproved: false },
    });
    expect(plan.ok).toBe(false);
    expect((plan as { reason: string }).reason).toBe("point_value_unset");
  });

  it("refuses when the point value is 0 even if 'approved'", () => {
    const plan = planRedemption({
      requestedPoints: 20,
      balancePoints: 50,
      orderSubtotalMinor: toMinor(80),
      settings: { ...baseSettings, pointValueMinor: 0 },
    });
    expect(plan.ok).toBe(false);
    expect((plan as { reason: string }).reason).toBe("point_value_unset");
  });

  it("respects the configured min/max", () => {
    const low = planRedemption({
      requestedPoints: 5,
      balancePoints: 50,
      orderSubtotalMinor: toMinor(80),
      settings: baseSettings,
    });
    expect(low.ok).toBe(false);
    expect((low as { reason: string }).reason).toBe("below_minimum");

    const high = planRedemption({
      requestedPoints: 600,
      balancePoints: 1000,
      orderSubtotalMinor: toMinor(1000),
      settings: baseSettings,
    });
    expect(high.ok).toBe(false);
    expect((high as { reason: string }).reason).toBe("above_maximum");
  });

  it("refuses when the balance is insufficient", () => {
    const plan = planRedemption({
      requestedPoints: 30,
      balancePoints: 10,
      orderSubtotalMinor: toMinor(80),
      settings: baseSettings,
    });
    expect(plan.ok).toBe(false);
    expect((plan as { reason: string }).reason).toBe("insufficient_balance");
  });

  it("clamps the discount to the order subtotal", () => {
    const plan = planRedemption({
      requestedPoints: 100, // = 100 ILS at value 1
      balancePoints: 500,
      orderSubtotalMinor: toMinor(40),
      settings: baseSettings,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.discountMinor).toBeLessThanOrEqual(toMinor(40));
    expect(plan.spentPoints).toBeLessThan(100);
  });
});

describe("pointsToReverseForRefund — mirror the earn math on refunds", () => {
  it("reverses the full points on a full refund", () => {
    expect(
      pointsToReverseForRefund({
        originalPointsEarned: 10,
        refundedAmountMinor: toMinor(100),
        qualifyingAmountMinor: toMinor(100),
      })
    ).toBe(10);
  });

  it("reverses proportionally on a partial refund", () => {
    expect(
      pointsToReverseForRefund({
        originalPointsEarned: 10,
        refundedAmountMinor: toMinor(40),
        qualifyingAmountMinor: toMinor(100),
      })
    ).toBe(4);
  });

  it("never removes more than was granted", () => {
    expect(
      pointsToReverseForRefund({
        originalPointsEarned: 5,
        refundedAmountMinor: toMinor(1000),
        qualifyingAmountMinor: toMinor(100),
      })
    ).toBe(5);
  });

  it("returns 0 when any input is 0", () => {
    expect(
      pointsToReverseForRefund({
        originalPointsEarned: 0,
        refundedAmountMinor: toMinor(100),
        qualifyingAmountMinor: toMinor(100),
      })
    ).toBe(0);
  });
});

describe("toMinor / fromMinor — stable money boundary", () => {
  it("round-trips without drift at 2 decimals", () => {
    const samples = [0, 0.01, 0.5, 1, 7.2, 99.99, 150, 999.95];
    for (const n of samples) {
      expect(fromMinor(toMinor(n))).toBeCloseTo(n, 2);
    }
  });

  it("coerces non-finite to 0", () => {
    expect(toMinor(Number.POSITIVE_INFINITY)).toBe(0);
    expect(toMinor(Number.NaN)).toBe(0);
  });
});
