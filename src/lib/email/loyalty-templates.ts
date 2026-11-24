import { emailShell, escapeHtml } from "@/lib/email/templates";

/**
 * Loyalty-club email templates.
 *
 * These are intentionally generic (no customer PII in the subject line) and
 * reuse the shared `emailShell` so they match the rest of the Mishkat mail
 * style. Both templates return the same `{ subject, html, text }` shape as
 * the existing templates, so `sendMishkahEmail` can route them unchanged.
 */

export function renderClubVerificationCodeEmail(input: {
  code: string;
  minutesValid: number;
}): { subject: string; html: string; text: string } {
  const safeCode = escapeHtml(input.code);
  const bodyHtml = `
<h1 style="margin:0 0 12px;font-size:22px;">קוד אימות למועדון משכאת</h1>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">
  הזן את הקוד הבא בדף ההצטרפות כדי לאמת את כתובת המייל שלך.
  הקוד תקף ל־${input.minutesValid} דקות ולשימוש חד־פעמי בלבד.
</p>
<div style="margin:20px 0;text-align:center;font-family:Menlo,Consolas,monospace;font-size:32px;letter-spacing:12px;font-weight:700;background:#F5F0EA;padding:16px;border-radius:12px;">${safeCode}</div>
<p style="margin:0;font-size:12px;color:#6B5A52;line-height:1.6;">
  אם לא ביקשת את הקוד — אפשר להתעלם מההודעה. אימות המייל מוכיח גישה לתיבה בלבד
  ואינו משמש כאימות זהות מלא.
</p>
`;
  return {
    subject: "קוד אימות למועדון משכאת",
    html: emailShell({
      title: "קוד אימות למועדון משכאת",
      preheader: "קוד חד־פעמי להצטרפות למועדון",
      bodyHtml,
    }),
    text:
      `קוד אימות למועדון משכאת: ${input.code}\n` +
      `תקף ל־${input.minutesValid} דקות, לשימוש חד־פעמי בלבד.\n` +
      `אם לא ביקשת, אפשר להתעלם מההודעה.`,
  };
}

export function renderClubWelcomeEmail(input: {
  memberNumber: string;
  displayName?: string;
  /** Spend (₪) that earns one point. */
  spendPerPointIls: number;
  /** Paid join fee (older paid sign-ups); 0 for the free sign-up → not shown. */
  joinFeeIls: number;
  accountUrl: string;
  showMarketingConsent: boolean;
}): { subject: string; html: string; text: string } {
  const safeNumber = escapeHtml(input.memberNumber);
  const safeUrl = escapeHtml(input.accountUrl);
  const ratio = Number.isInteger(input.spendPerPointIls) ? String(input.spendPerPointIls) : input.spendPerPointIls.toFixed(2);
  const greeting = input.displayName?.trim() ? `, ${escapeHtml(input.displayName.trim())}` : "";
  const bodyHtml = `
<h1 style="margin:0 0 12px;font-size:22px;">ברוך הבא למועדון משכאת${greeting}</h1>
<p style="margin:0 0 10px;font-size:14px;line-height:1.6;">
  החברות שלך פעילה. בכל רכישה תצבור <strong>נקודה על כל ₪${ratio}</strong>.
</p>
<p style="margin:0 0 10px;font-size:14px;line-height:1.6;">
  מספר חבר: <strong>${safeNumber}</strong>${
    input.joinFeeIls > 0 ? `<br/>\n  דמי הצטרפות ששולמו: <strong>${input.joinFeeIls.toFixed(2)} ₪</strong>` : ""
  }
</p>
<div style="margin:22px 0;text-align:center;">
  <a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#007A80;color:#FFFFFF;border-radius:10px;text-decoration:none;font-weight:700;">צפייה בכרטיס המועדון</a>
</div>
<p style="margin:0;font-size:12px;color:#6B5A52;line-height:1.6;">
  אישרת את תנאי המועדון בעת ההצטרפות.${
    input.showMarketingConsent
      ? " הסכמה לקבלת פרסום היא נפרדת ואפשר לשנות אותה בחשבון שלך בכל עת."
      : ""
  }
</p>
`;
  return {
    subject: "ברוך הבא למועדון משכאת",
    html: emailShell({
      title: "ברוך הבא למועדון משכאת",
      preheader: "החברות שלך פעילה — צפה בכרטיס המועדון",
      bodyHtml,
    }),
    text:
      `ברוך הבא למועדון משכאת.\n` +
      `מספר חבר: ${input.memberNumber}\n` +
      `צבירה: נקודה על כל ₪${ratio}\n` +
      (input.joinFeeIls > 0 ? `דמי הצטרפות ששולמו: ${input.joinFeeIls.toFixed(2)} ₪\n` : "") +
      `כרטיס המועדון: ${input.accountUrl}`,
  };
}
