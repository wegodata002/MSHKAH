/**
 * Loyalty-club domain types.
 *
 * The club has three independent capabilities (per spec, section 1):
 *   - enrollment is open or closed
 *   - points earning is on or off
 *   - points redemption is on or off
 *
 * They are three separate booleans so the admin can pause one lane without
 * affecting the others, and so turning the whole club off never deletes
 * any member or balance.
 */

import type { LoyaltyCouponView } from "@/lib/loyalty/coupons";

export type LoyaltyRoundingMode = "down" | "nearest";

export interface LoyaltySettings {
  /** New sign-ups accepted. Existing members are unaffected when `false`. */
  enrollmentEnabled: boolean;
  /** Paid orders award points when `true`. Membership keeps balance either way. */
  earnEnabled: boolean;
  /** Members can spend points on new orders when `true`. */
  redemptionEnabled: boolean;
  /** One-time join fee, in minor currency units (agorot/ils cents). */
  joinFeeMinor: number;
  /**
   * Spend (minor units, agorot) that earns one point: 10000 = "every ₪100 = 1 point".
   * Set by the manager. Replaces the old "points per ₪100" (earnPointsPer100), which is no longer read.
   */
  spendPerPointMinor: number;
  /** Discount value of 1 point, in minor units. 0 ⇒ redemption not yet configured. */
  pointValueMinor: number;
  /** Minimum points per single redemption; 0 means no minimum. */
  redemptionMinPoints: number;
  /** Maximum points per single redemption; 0 means no maximum. */
  redemptionMaxPoints: number;
  /** Rounding policy applied once per order; defaults to `"down"` so points can only
   *  be awarded, never fabricated. */
  roundingMode: LoyaltyRoundingMode;
  /**
   * New members get a personal 10% code for their first purchase (30 days).
   * Off = no new codes; codes already given stay valid.
   */
  welcomeCouponEnabled: boolean;
  /** Digital coffee card: 5 cups (added by staff) → the 6th cup is free. */
  coffeeCardEnabled: boolean;
  /** Hebrew/Arabic/English terms shown on the join card. */
  termsHe?: string;
  termsAr?: string;
  termsEn?: string;
  /** Admin flag: redemption remains locked until an admin confirms the point value. */
  pointValueApproved: boolean;
  /** ISO timestamp of the last update, for the audit footer. */
  updatedAt?: string;
  updatedBy?: string;
}

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enrollmentEnabled: false,
  earnEnabled: false,
  redemptionEnabled: false,
  joinFeeMinor: 2000, // 20 ILS
  spendPerPointMinor: 10000, // ₪100 = 1 point
  pointValueMinor: 0,
  redemptionMinPoints: 0,
  redemptionMaxPoints: 0,
  roundingMode: "down",
  pointValueApproved: false,
  welcomeCouponEnabled: true,
  coffeeCardEnabled: true,
  termsHe: "",
  termsAr: "",
  termsEn: "",
};

// ──────────────────────────────────────────────────────────────────────
// Member
// ──────────────────────────────────────────────────────────────────────

/**
 * Membership lifecycle:
 *   none              — no record for this email
 *   email_verified    — code sent + confirmed, but payment pending
 *   awaiting_payment  — HYP attempt created, waiting for VERIFY callback
 *   active            — paid (card or manual cash) and welcome email queued
 *   suspended         — admin suspended; balance frozen, no earn/redeem
 */
export type LoyaltyMemberStatus =
  | "email_verified"
  | "awaiting_payment"
  | "active"
  | "suspended";

export interface LoyaltyMember {
  id: string;
  memberNumber: string;
  email: string;
  emailHash: string;
  displayName?: string;
  phone?: string;
  status: LoyaltyMemberStatus;
  balancePoints: number;
  /**
   * Spend (agorot) not yet turned into a point; carried to the next order
   * (₪60 + ₪50 at ₪100 per point = 1 point, ₪10 left). Missing on older members = 0.
   */
  pointsCarryMinor?: number;
  joinFeePaidMinor: number;
  /** "free" = joined without a fee (sign-up is free); "card"/"cash" = older paid sign-ups. */
  joinFeeSource?: "card" | "cash" | "free";
  joinFeePaymentId?: string;
  joinFeePaidAt?: string;
  activatedAt?: string;
  consentTerms: boolean;
  consentMarketing: boolean;
  welcomeEmailStatus?: "sent" | "failed" | "pending";
  /** Language the member last used on the site (club emails are sent in it). */
  locale?: "he" | "ar" | "en";
  /** Code of the member's welcome coupon (`loyaltyCoupons/{code}`), once given. */
  welcomeCouponCode?: string;
  /** Set when a member who joined before codes existed already had an order (no code given). */
  welcomeCouponSkippedAt?: string;
  /** Coffee card: cups toward the free one (extra cups carry over after a free cup). */
  coffeeCups?: number;
  coffeeRewardsRedeemed?: number;
  /** Last time staff added cups (double-scan guard). */
  coffeeLastAddAt?: string;
  welcomeEmailAttemptAt?: string;
  linkedCustomerId?: string;
  /**
   * Last checkout details, saved by the order route after an order is saved (phone; area, address
   * and location link from the last delivery). Read only by the member's own session to fill the checkout.
   */
  checkoutDetails?: { phone?: string; zoneId?: string; address?: string; locationUrl?: string; updatedAt?: string };
  createdAt: string;
  updatedAt: string;
}

// ──────────────────────────────────────────────────────────────────────
// Ledger
// ──────────────────────────────────────────────────────────────────────

export type LoyaltyLedgerKind =
  | "earn"
  | "redeem"
  | "refund"
  | "adjustment"
  | "welcome";

export type LoyaltyLedgerSource =
  | "order"
  | "admin"
  | "enrollment"
  | "import";

export interface LoyaltyLedgerEntry {
  id: string;
  memberId: string;
  kind: LoyaltyLedgerKind;
  points: number;
  source: LoyaltyLedgerSource;
  orderId?: string;
  qualifyingAmountMinor?: number;
  pointValueMinorAtTime?: number;
  reason?: string;
  actor?: string;
  createdAt: string;
}

// ──────────────────────────────────────────────────────────────────────
// Enrollment / verification tokens
// ──────────────────────────────────────────────────────────────────────

export type EnrollmentTokenStatus = "active" | "used" | "expired";

export interface LoyaltyEnrollmentToken {
  id: string;
  emailHash: string;
  codeHash: string;
  status: EnrollmentTokenStatus;
  attempts: number;
  expiresAt: string;
  createdAt: string;
  usedAt?: string;
  usedBy?: string;
}

// ──────────────────────────────────────────────────────────────────────
// API response contracts
// ──────────────────────────────────────────────────────────────────────

/** Response returned to the storefront when it asks "who am I?". */
export interface LoyaltyMeResponse {
  member: {
    id: string;
    memberNumber: string;
    displayName?: string;
    email: string;
    status: LoyaltyMemberStatus;
    balancePoints: number;
    /** Spend (agorot) toward the next point. */
    pointsCarryMinor?: number;
    joinedAt?: string;
    /** Signed card id for the member QR (`/club/card?c=…`); reveals nothing by itself. */
    cardToken?: string;
    /** Coffee card cups (0 when none yet). */
    coffeeCups?: number;
  } | null;
  /** The member's coupons (welcome code, later manager coupons). */
  coupons?: LoyaltyCouponView[];
  // Mirrors the public bits of settings so the member card can render ratio etc.
  settings: {
    enrollmentEnabled: boolean;
    earnEnabled: boolean;
    redemptionEnabled: boolean;
    joinFeeMinor: number;
    spendPerPointMinor: number;
    pointValueMinor: number;
    redemptionMinPoints: number;
    redemptionMaxPoints: number;
    pointValueApproved: boolean;
    coffeeCardEnabled?: boolean;
    termsHe?: string;
    termsAr?: string;
    termsEn?: string;
  };
  history: Array<{
    id: string;
    kind: LoyaltyLedgerKind;
    points: number;
    source: LoyaltyLedgerSource;
    reason?: string;
    orderId?: string;
    createdAt: string;
  }>;
}
