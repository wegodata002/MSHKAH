import { emailShell, escapeHtml } from "@/lib/email/templates";

/**
 * Loyalty-club email templates, in the language the customer used on the site
 * (Hebrew / Arabic right-to-left, English left-to-right).
 *
 * No customer details in the subject line. They reuse the shared `emailShell` so they match the
 * rest of the Mishkat mail, and return the same `{ subject, html, text }` shape so
 * `sendMishkahEmail` can route them unchanged.
 */

export type ClubEmailLocale = "he" | "ar" | "en";

export function clubEmailLocale(value: unknown): ClubEmailLocale {
  return value === "ar" || value === "en" ? value : "he";
}

const DATE_LOCALES: Record<ClubEmailLocale, string> = { he: "he-IL", ar: "ar-u-nu-latn", en: "en-GB" };

/** 24.12.2026 / 24/12/2026, in Israel time. */
export function formatClubDate(iso: string, locale: ClubEmailLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(DATE_LOCALES[locale], {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  }).format(date);
}

const CODE_TEXT = {
  he: {
    subject: "קוד אימות למועדון משכאת",
    preheader: "קוד חד־פעמי להצטרפות למועדון",
    intro: (m: number) =>
      `הזן את הקוד הבא בדף ההצטרפות כדי לאמת את כתובת המייל שלך. הקוד תקף ל־${m} דקות ולשימוש חד־פעמי בלבד.`,
    welcomeLine: (p: number) => `אחרי האימות תקבלו קוד הנחה ${p}% לקנייה הראשונה.`,
    ignore: "אם לא ביקשת את הקוד — אפשר להתעלם מההודעה. אימות המייל מוכיח גישה לתיבה בלבד ואינו משמש כאימות זהות מלא.",
    textValid: (m: number) => `תקף ל־${m} דקות, לשימוש חד־פעמי בלבד.`,
    textIgnore: "אם לא ביקשת, אפשר להתעלם מההודעה.",
  },
  ar: {
    subject: "رمز التحقق لنادي مشكاة",
    preheader: "رمز لمرة واحدة للانضمام إلى النادي",
    intro: (m: number) =>
      `أدخلوا الرمز التالي في صفحة النادي لتأكيد بريدكم الإلكتروني. الرمز صالح لمدة ${m} دقائق ولاستخدام واحد فقط.`,
    welcomeLine: (p: number) => `بعد التحقق ستحصلون على كود خصم ${p}% لأول عملية شراء.`,
    ignore: "إذا لم تطلبوا هذا الرمز، يمكنكم تجاهل هذه الرسالة.",
    textValid: (m: number) => `صالح لمدة ${m} دقائق، لاستخدام واحد فقط.`,
    textIgnore: "إذا لم تطلبوا الرمز، يمكنكم تجاهل الرسالة.",
  },
  en: {
    subject: "Your Mishkat Club verification code",
    preheader: "A one-time code for the club",
    intro: (m: number) =>
      `Enter this code on the club page to verify your email. It is valid for ${m} minutes and can be used once.`,
    welcomeLine: (p: number) => `After verifying, you'll get a ${p}% discount code for your first purchase.`,
    ignore: "If you didn't ask for this code, you can ignore this email.",
    textValid: (m: number) => `Valid for ${m} minutes, one-time use.`,
    textIgnore: "If you didn't ask for it, you can ignore this email.",
  },
} as const;

export function renderClubVerificationCodeEmail(input: {
  code: string;
  minutesValid: number;
  locale?: ClubEmailLocale;
  /** Shown only to someone joining (not to a member logging in), when the welcome code is on. */
  welcomeCouponPercent?: number;
}): { subject: string; html: string; text: string } {
  const locale = clubEmailLocale(input.locale);
  const c = CODE_TEXT[locale];
  const safeCode = escapeHtml(input.code);
  const welcome = input.welcomeCouponPercent ? c.welcomeLine(input.welcomeCouponPercent) : "";
  const bodyHtml = `
<h1 style="margin:0 0 12px;font-size:22px;">${c.subject}</h1>
<p style="margin:0 0 16px;font-size:14px;line-height:1.6;">${c.intro(input.minutesValid)}</p>
<div dir="ltr" style="margin:20px 0;text-align:center;font-family:Menlo,Consolas,monospace;font-size:32px;letter-spacing:12px;font-weight:700;background:#F5F0EA;padding:16px;border-radius:12px;">${safeCode}</div>
${welcome ? `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;font-weight:700;color:#007A80;" data-welcome-line>🎁 ${welcome}</p>` : ""}
<p style="margin:0;font-size:12px;color:#6B5A52;line-height:1.6;">${c.ignore}</p>
`;
  return {
    subject: c.subject,
    html: emailShell({ title: c.subject, preheader: c.preheader, bodyHtml, locale }),
    text: `${c.subject}: ${input.code}\n${c.textValid(input.minutesValid)}\n${welcome ? `${welcome}\n` : ""}${c.textIgnore}`,
  };
}

const WELCOME_TEXT = {
  he: {
    subject: "ברוך הבא למועדון משכאת",
    preheader: "החברות שלך פעילה — צפה בכרטיס המועדון",
    title: (greeting: string) => `ברוך הבא למועדון משכאת${greeting}`,
    active: (ratio: string) => `החברות שלך פעילה. בכל רכישה תצבור <strong>נקודה על כל ₪${ratio}</strong>.`,
    memberNo: "מספר חבר",
    feePaid: "דמי הצטרפות ששולמו",
    giftTitle: (p: number) => `המתנה שלך: ${p}% הנחה`,
    firstPurchase: "לקנייה הראשונה",
    validUntil: (d: string) => `בתוקף עד ${d}`,
    howTitle: "איך משתמשים:",
    howSite: "באתר: מזינים את הקוד בעגלה (כשאתם מחוברים למועדון)",
    howCounter: "בקופה: מציגים את כרטיס החבר או אומרים את הקוד",
    oneTime: "לשימוש חד־פעמי.",
    cta: "צפייה בכרטיס המועדון",
    terms: "אישרת את תנאי המועדון בעת ההצטרפות.",
    marketing: " הסכמה לקבלת פרסום היא נפרדת ואפשר לשנות אותה בחשבון שלך בכל עת.",
    textWelcome: "ברוך הבא למועדון משכאת.",
    textEarn: (ratio: string) => `צבירה: נקודה על כל ₪${ratio}`,
    textCard: "כרטיס המועדון",
  },
  ar: {
    subject: "أهلًا بكم في نادي مشكاة",
    preheader: "عضويتكم فعّالة — شاهدوا بطاقة النادي",
    title: (greeting: string) => `أهلًا بكم في نادي مشكاة${greeting}`,
    active: (ratio: string) => `عضويتكم فعّالة. مع كل عملية شراء تجمعون <strong>نقطة على كل ₪${ratio}</strong>.`,
    memberNo: "رقم العضوية",
    feePaid: "رسوم الانضمام المدفوعة",
    giftTitle: (p: number) => `هديتكم: خصم ${p}%`,
    firstPurchase: "لأول عملية شراء",
    validUntil: (d: string) => `صالح حتى ${d}`,
    howTitle: "طريقة الاستخدام:",
    howSite: "في الموقع: أدخلوا الكود في السلة (وأنتم مسجّلون في النادي)",
    howCounter: "في الصندوق: اعرضوا بطاقة العضوية أو قولوا الكود",
    oneTime: "لاستخدام واحد فقط.",
    cta: "عرض بطاقة النادي",
    terms: "وافقتم على شروط النادي عند الانضمام.",
    marketing: " الموافقة على تلقي الإعلانات منفصلة ويمكن تغييرها في حسابكم في أي وقت.",
    textWelcome: "أهلًا بكم في نادي مشكاة.",
    textEarn: (ratio: string) => `الجمع: نقطة على كل ₪${ratio}`,
    textCard: "بطاقة النادي",
  },
  en: {
    subject: "Welcome to the Mishkat Club",
    preheader: "Your membership is active. See your club card",
    title: (greeting: string) => `Welcome to the Mishkat Club${greeting}`,
    active: (ratio: string) => `Your membership is active. You earn <strong>1 point for every ₪${ratio}</strong> you spend.`,
    memberNo: "Member number",
    feePaid: "Join fee paid",
    giftTitle: (p: number) => `Your gift: ${p}% off`,
    firstPurchase: "your first purchase",
    validUntil: (d: string) => `Valid until ${d}`,
    howTitle: "How to use it:",
    howSite: "On the site: enter the code in the cart (while logged in to the club)",
    howCounter: "At the counter: show your member card or say the code",
    oneTime: "One-time use.",
    cta: "View my club card",
    terms: "You accepted the club terms when you joined.",
    marketing: " Marketing consent is separate, and you can change it in your account at any time.",
    textWelcome: "Welcome to the Mishkat Club.",
    textEarn: (ratio: string) => `Earning: 1 point for every ₪${ratio}`,
    textCard: "Your club card",
  },
} as const;

export function renderClubWelcomeEmail(input: {
  memberNumber: string;
  displayName?: string;
  /** Spend (₪) that earns one point. */
  spendPerPointIls: number;
  /** Paid join fee (older paid sign-ups); 0 for the free sign-up → not shown. */
  joinFeeIls: number;
  accountUrl: string;
  showMarketingConsent: boolean;
  locale?: ClubEmailLocale;
  /** The member's welcome code, when one was given. */
  coupon?: { code: string; percent: number; expiresAt: string };
}): { subject: string; html: string; text: string } {
  const locale = clubEmailLocale(input.locale);
  const w = WELCOME_TEXT[locale];
  const safeNumber = escapeHtml(input.memberNumber);
  const safeUrl = escapeHtml(input.accountUrl);
  const ratio = Number.isInteger(input.spendPerPointIls) ? String(input.spendPerPointIls) : input.spendPerPointIls.toFixed(2);
  const greeting = input.displayName?.trim() ? `, ${escapeHtml(input.displayName.trim())}` : "";
  const coupon = input.coupon;
  const until = coupon ? formatClubDate(coupon.expiresAt, locale) : "";
  const couponHtml = coupon
    ? `
<div style="margin:20px 0;padding:18px;border:2px dashed #007A80;border-radius:14px;background:#E6F6F7;text-align:center;" data-coupon>
  <div style="font-size:18px;font-weight:700;color:#3D2B24;">🎁 ${w.giftTitle(coupon.percent)}</div>
  <div style="margin-top:2px;font-size:14px;color:#3D2B24;">${w.firstPurchase}</div>
  <div dir="ltr" style="margin:12px auto 8px;display:inline-block;padding:10px 18px;background:#FFFFFF;border-radius:10px;font-family:Menlo,Consolas,monospace;font-size:24px;font-weight:700;letter-spacing:3px;color:#3D2B24;">${escapeHtml(coupon.code)}</div>
  <div style="font-size:13px;color:#6B5A52;">${w.validUntil(`<span dir="ltr">${escapeHtml(until)}</span>`)}</div>
</div>
<p style="margin:0 0 4px;font-size:14px;font-weight:700;">${w.howTitle}</p>
<ul style="margin:0 0 6px;padding-inline-start:20px;font-size:14px;line-height:1.7;">
  <li>${w.howSite}</li>
  <li>${w.howCounter}</li>
</ul>
<p style="margin:0 0 10px;font-size:13px;color:#6B5A52;">${w.oneTime}</p>`
    : "";
  const bodyHtml = `
<h1 style="margin:0 0 12px;font-size:22px;">${w.title(greeting)}</h1>
<p style="margin:0 0 10px;font-size:14px;line-height:1.6;">
  ${w.active(ratio)}
</p>
<p style="margin:0 0 10px;font-size:14px;line-height:1.6;">
  ${w.memberNo}: <strong dir="ltr">${safeNumber}</strong>${
    input.joinFeeIls > 0 ? `<br/>\n  ${w.feePaid}: <strong>${input.joinFeeIls.toFixed(2)} ₪</strong>` : ""
  }
</p>${couponHtml}
<div style="margin:22px 0;text-align:center;">
  <a href="${safeUrl}" style="display:inline-block;padding:12px 20px;background:#007A80;color:#FFFFFF;border-radius:10px;text-decoration:none;font-weight:700;">${w.cta}</a>
</div>
<p style="margin:0;font-size:12px;color:#6B5A52;line-height:1.6;">
  ${w.terms}${input.showMarketingConsent ? w.marketing : ""}
</p>
`;
  return {
    subject: w.subject,
    html: emailShell({ title: w.subject, preheader: w.preheader, bodyHtml, locale }),
    text:
      `${w.textWelcome}\n` +
      `${w.memberNo}: ${input.memberNumber}\n` +
      `${w.textEarn(ratio)}\n` +
      (input.joinFeeIls > 0 ? `${w.feePaid}: ${input.joinFeeIls.toFixed(2)} ₪\n` : "") +
      (coupon
        ? `${w.giftTitle(coupon.percent)} — ${w.firstPurchase}: ${coupon.code}\n${w.validUntil(until)}\n` +
          `${w.howTitle}\n- ${w.howSite}\n- ${w.howCounter}\n${w.oneTime}\n`
        : "") +
      `${w.textCard}: ${input.accountUrl}`,
  };
}
