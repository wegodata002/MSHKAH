import type { FaqItem, InfoPageCopy, InfoPageId } from "@/lib/info-pages/content";

/**
 * First drafts of the info pages, written from what the site does today. They are only a starting
 * point in the admin editor (nothing is saved or shown until the manager saves and publishes).
 * "[[...]]" = details only the business can give; publishing is blocked until they are filled.
 * Not legal advice: the terms and the privacy policy should be reviewed before publishing.
 * Opening hours and delivery areas are not written here: the FAQ page shows them from the settings.
 */

const text = (body: string) => ({ body: body.trim(), items: [] as FaqItem[] });
const faq = (items: Array<[string, string]>) => ({ body: "", items: items.map(([q, a]) => ({ q, a })) });

const FAQ: InfoPageCopy = {
  he: faq([
    ["מתי אתם פתוחים?", "שעות הפתיחה מופיעות בראש העמוד ובתחתית כל עמוד באתר, והן מתעדכנות אוטומטית. בעמוד התשלום רואים מה אפשר להזמין עכשיו, ואם סגור — מתי נפתח שוב."],
    ["אילו סוגי הזמנה יש?", "איסוף עצמי (בוחרים שעת איסוף), משלוח לאזורים שמופיעים בראש העמוד, והזמנה לשולחן בבית הקפה אחרי סריקת קוד ה-QR שעל השולחן."],
    ["לאן אתם שולחים, וכמה זה עולה?", "אזורי המשלוח, דמי המשלוח והמינימום להזמנה בכל אזור מופיעים בראש העמוד. אם האזור שלכם לא ברשימה — בחרו \"אזור אחר\" בעמוד התשלום ופנו אלינו בטלפון או בוואטסאפ."],
    ["איך משלמים?", "באיסוף — בקופה או בכרטיס אשראי באתר. במשלוח — לשליח או בכרטיס אשראי באתר. בהזמנה לשולחן משלמים בסוף, למלצרית או בקופה. תשלום בכרטיס עובר בעמוד המאובטח של חברת הסליקה; אנחנו לא רואים ולא שומרים את פרטי הכרטיס."],
    ["איך עוקבים אחרי ההזמנה?", "אחרי ההזמנה נפתח עמוד מעקב שמראה את מצב ההזמנה. ההזמנות האחרונות שמורות גם ב\"ההזמנות שלי\" באותו מכשיר."],
    ["אפשר לשנות או לבטל הזמנה?", "פנו אלינו בטלפון בהקדם. הזמנה שכבר נכנסה להכנה לא תמיד אפשר לשנות או לבטל."],
    ["מה זה מועדון הלקוחות?", "ההצטרפות בחינם, עם כתובת מייל. חברי מועדון צוברים נקודות על הזמנות, מקבלים קוד הנחה אישי של 10% לקנייה הראשונה (בתוקף 30 יום) ויכולים לאסוף כוסות בכרטיס הקפה הדיגיטלי. את הכרטיס והיתרה רואים בעמוד המועדון."],
    ["איך משתמשים בקופון?", "מקלידים את הקוד בעגלה או בעמוד התשלום. קוד אישי של המועדון עובד רק כשמחוברים למועדון באותו מכשיר."],
    ["למה הפרטים שלי כבר מופיעים בעמוד התשלום?", "כדי לחסוך הקלדה, האתר ממלא את הפרטים מההזמנה הקודמת: לחברי מועדון מחוברים — מהחשבון, ולכל השאר — מהמכשיר, למשך 180 יום. אפשר לשנות כל שדה."],
    ["האתר נגיש?", "כן. כפתור הנגישות שבפינת המסך פותח תפריט עם הגדלת טקסט, ניגודיות, הדגשת קישורים ועוד. פרטים מלאים בהצהרת הנגישות."],
  ]),
  ar: faq([
    ["متى تفتحون؟", "ساعات العمل تظهر في أعلى هذه الصفحة وفي أسفل كل صفحة في الموقع، وتتحدّث تلقائيًا. في صفحة الدفع ترون ما يمكن طلبه الآن، وإذا كنّا مغلقين — متى نفتح من جديد."],
    ["ما أنواع الطلب المتاحة؟", "استلام ذاتي (تختارون وقت الاستلام)، توصيل إلى المناطق المذكورة في أعلى الصفحة، وطلب إلى الطاولة في المقهى بعد مسح رمز QR الموجود على الطاولة."],
    ["إلى أين توصّلون، وكم يكلّف ذلك؟", "مناطق التوصيل ورسومه والحدّ الأدنى للطلب في كل منطقة تظهر في أعلى الصفحة. إذا لم تكن منطقتكم في القائمة — اختاروا \"منطقة أخرى\" في صفحة الدفع وتواصلوا معنا هاتفيًا أو عبر واتساب."],
    ["كيف أدفع؟", "عند الاستلام — في الصندوق أو ببطاقة ائتمان في الموقع. في التوصيل — للمندوب أو ببطاقة ائتمان في الموقع. في الطلب إلى الطاولة تدفعون في النهاية للنادلة أو في الصندوق. الدفع بالبطاقة يتمّ في الصفحة الآمنة لشركة المقاصّة؛ نحن لا نرى تفاصيل البطاقة ولا نحفظها."],
    ["كيف أتابع طلبي؟", "بعد الطلب تُفتح صفحة متابعة تُظهر حالة الطلب. الطلبات الأخيرة محفوظة أيضًا في \"طلباتي\" على نفس الجهاز."],
    ["هل يمكن تغيير الطلب أو إلغاؤه؟", "اتصلوا بنا في أقرب وقت. الطلب الذي بدأ تحضيره لا يمكن دائمًا تغييره أو إلغاؤه."],
    ["ما هو نادي الزبائن؟", "الانضمام مجاني بواسطة البريد الإلكتروني. أعضاء النادي يجمعون نقاطًا على الطلبات، ويحصلون على كود خصم شخصي 10% لأول شراء (صالح 30 يومًا)، ويمكنهم جمع الأكواب في بطاقة القهوة الرقمية. البطاقة والرصيد يظهران في صفحة النادي."],
    ["كيف أستخدم القسيمة؟", "اكتبوا الكود في السلة أو في صفحة الدفع. الكود الشخصي للنادي يعمل فقط عند تسجيل الدخول إلى النادي على نفس الجهاز."],
    ["لماذا تظهر تفاصيلي مسبقًا في صفحة الدفع؟", "لتوفير الكتابة، يملأ الموقع التفاصيل من الطلب السابق: لأعضاء النادي المسجّلين — من الحساب، ولغيرهم — من الجهاز لمدة 180 يومًا. يمكن تغيير أي حقل."],
    ["هل الموقع متاح لذوي الإعاقة؟", "نعم. زرّ إمكانية الوصول في زاوية الشاشة يفتح قائمة لتكبير النص والتباين وإبراز الروابط وغير ذلك. التفاصيل الكاملة في بيان إمكانية الوصول."],
  ]),
  en: faq([
    ["When are you open?", "Opening hours are shown at the top of this page and at the bottom of every page, and they update automatically. The checkout shows what can be ordered right now, and if we're closed, when we open again."],
    ["What kinds of orders can I place?", "Pickup (you choose a pickup time), delivery to the areas listed at the top of this page, and ordering to your table in the café after scanning the QR code on the table."],
    ["Where do you deliver, and how much does it cost?", "Delivery areas, the delivery fee and the minimum order for each area are listed at the top of this page. If your area isn't listed, choose \"Other area\" at checkout and contact us by phone or WhatsApp."],
    ["How do I pay?", "Pickup: at the counter, or by card on the site. Delivery: to the courier, or by card on the site. Table orders are paid at the end, to the waiter or at the counter. Card payments go through the payment company's secure page; we never see or keep your card details."],
    ["How do I track my order?", "After you order, a tracking page shows its status. Your recent orders are also kept under \"My orders\" on the same device."],
    ["Can I change or cancel an order?", "Call us as soon as possible. An order that is already being prepared can't always be changed or cancelled."],
    ["What is the customer club?", "Joining is free, with an email address. Members earn points on orders, get a personal 10% code for their first purchase (valid 30 days) and can collect cups on the digital coffee card. The card and balance are on the club page."],
    ["How do I use a coupon?", "Type the code in the cart or at checkout. A personal club code works only while you're signed in to the club on the same device."],
    ["Why are my details already filled in at checkout?", "To save typing, the site fills in your details from your last order: for signed-in club members from the account, for everyone else from the device, for 180 days. You can change any field."],
    ["Is the site accessible?", "Yes. The accessibility button in the corner of the screen opens a menu with larger text, contrast, highlighted links and more. Full details are in the accessibility statement."],
  ]),
};

const ACCESSIBILITY: InfoPageCopy = {
  he: text(`
## מחויבות לנגישות
בית הקפה משקאת רואה חשיבות במתן שירות שוויוני לכל הלקוחות, כולל אנשים עם מוגבלות. האתר נבנה במטרה לעמוד בדרישות תקנות שוויון זכויות לאנשים עם מוגבלות (התאמות נגישות לשירות), התשע"ג-2013, ובהנחיות התקן הישראלי ת"י 5568 המבוסס על הנחיות WCAG 2.0 ברמה AA.

## מה עשינו באתר
- תפריט נגישות שנפתח מהכפתור בפינת המסך: הגדלת טקסט, ניגודיות גבוהה, גווני אפור, הדגשת קישורים, גופן קריא, ריווח שורות ואותיות, עצירת אנימציות, סמן גדול ומצב כהה.
- קישור "דילוג לתוכן" בתחילת כל עמוד, וסימון ברור של המיקום בזמן ניווט במקלדת.
- האתר זמין בעברית, בערבית ובאנגלית, עם כיוון כתיבה מתאים לכל שפה.
- כפתורים ושדות בגודל נוח למגע, ותיאורים לכפתורים שיש בהם רק סמל.
- התאמה למסכים בכל גודל: טלפון, טאבלט ומחשב.

## הנגשה בבית הקפה
[[פרטו את הסידורים בבית הקפה: כניסה, חניית נכים, שירותים נגישים, מקומות ישיבה]]

## אם נתקלתם בבעיה
אנחנו ממשיכים לשפר את הנגישות. אם מצאתם חלק באתר שאינו נגיש, נשמח שתספרו לנו כדי שנוכל לתקן.
- רכז/ת הנגישות: [[שם]]
- טלפון: [[טלפון]]
- דוא"ל: [[דוא"ל]]

הצהרה זו עודכנה לאחרונה ב-[[תאריך]].
`),
  ar: text(`
## التزامنا بإمكانية الوصول
يحرص مقهى مشكاة على تقديم خدمة متساوية لجميع الزبائن، بمن فيهم الأشخاص ذوو الإعاقة. بُني الموقع بهدف استيفاء متطلبات أنظمة المساواة في الحقوق للأشخاص ذوي الإعاقة (ملاءمات إمكانية الوصول للخدمة) لسنة 2013، وإرشادات المعيار الإسرائيلي 5568 المبني على إرشادات WCAG 2.0 بمستوى AA.

## ما قمنا به في الموقع
- قائمة إمكانية الوصول تُفتح من الزر في زاوية الشاشة: تكبير النص، تباين عالٍ، تدرّج رمادي، إبراز الروابط، خط سهل القراءة، تباعد الأسطر والأحرف، إيقاف الحركة، مؤشر كبير ووضع داكن.
- رابط "تخطَّ إلى المحتوى" في بداية كل صفحة، وتمييز واضح للموضع عند التنقّل بلوحة المفاتيح.
- الموقع متاح بالعربية والعبرية والإنجليزية، مع اتجاه كتابة مناسب لكل لغة.
- أزرار وحقول بحجم مريح للّمس، ووصف للأزرار التي تحتوي على رمز فقط.
- ملاءمة لكل أحجام الشاشات: الهاتف والجهاز اللوحي والحاسوب.

## إمكانية الوصول في المقهى
[[اذكروا الترتيبات في المقهى: المدخل، موقف لذوي الإعاقة، مراحيض متاحة، أماكن الجلوس]]

## إذا واجهتم مشكلة
نواصل تحسين إمكانية الوصول. إذا وجدتم جزءًا في الموقع غير متاح، يسعدنا أن تخبرونا لنتمكّن من إصلاحه.
- منسّق/ة إمكانية الوصول: [[الاسم]]
- الهاتف: [[الهاتف]]
- البريد الإلكتروني: [[البريد الإلكتروني]]

آخر تحديث لهذا البيان: [[التاريخ]].
`),
  en: text(`
## Our commitment
Mishkat Café wants to give every customer equal service, including people with disabilities. The site was built to meet the Israeli Equal Rights for Persons with Disabilities (Service Accessibility Adjustments) Regulations, 2013, and Israeli Standard 5568, which is based on WCAG 2.0 level AA.

## What we did on the site
- An accessibility menu, opened from the button in the corner of the screen: larger text, high contrast, grayscale, highlighted links, a readable font, line and letter spacing, pausing animations, a large cursor and dark mode.
- A "Skip to content" link at the top of every page, and a clear focus outline when navigating by keyboard.
- The site is available in Hebrew, Arabic and English, with the right text direction for each.
- Buttons and fields sized for touch, and labels for buttons that show only an icon.
- Layouts for every screen size: phone, tablet and computer.

## Accessibility at the café
[[Describe the arrangements at the café: entrance, accessible parking, accessible restroom, seating]]

## If something doesn't work for you
We keep improving accessibility. If you find a part of the site that isn't accessible, please tell us so we can fix it.
- Accessibility coordinator: [[name]]
- Phone: [[phone]]
- Email: [[email]]

This statement was last updated on [[date]].
`),
};

const TERMS: InfoPageCopy = {
  he: text(`
## כללי
האתר מופעל על ידי [[שם העסק וח.פ/ע.מ]] ("משקאת", "אנחנו"). השימוש באתר ובהזמנה דרכו כפוף לתנאים אלה. אם אינכם מסכימים להם, אנא אל תשתמשו באתר.

## הזמנות
- ההזמנה נקלטת אחרי שהיא נשמרת באתר ומופיע עמוד האישור. הזמנה בכרטיס נקלטת אחרי שהתשלום אושר.
- המחירים, דמי המשלוח והמינימום להזמנה הם אלה שמופיעים בזמן ההזמנה, כולל מע"מ.
- זמני האיסוף והמשלוח הם הערכה, ועשויים להשתנות בשעות עומס.
- מוצרים עשויים לאזול; במקרה כזה ניצור קשר להצעת חלופה או להחזר.

## ביטולים והחזרים
אפשר לבקש לבטל הזמנה בטלפון כל עוד לא התחלנו להכין אותה. הזמנה ששולמה בכרטיס ובוטלה תזוכה לאותו כרטיס. [[השלימו את מדיניות הביטולים וההחזרים של העסק]]

## מועדון לקוחות וקופונים
ההצטרפות למועדון בחינם. נקודות, קופונים וכרטיס הקפה כפופים לתנאי המועדון שמופיעים בעמוד ההצטרפות, ואינם ניתנים להמרה לכסף. אנחנו רשאים לשנות את הטבות המועדון מעת לעת.

## אלרגנים
המטבח שלנו מטפל בגלוטן, חלב, ביצים, אגוזים ואלרגנים נוספים. אם יש לכם אלרגיה, ספרו לנו לפני ההזמנה.

## אחריות
אנחנו עושים מאמץ שהמידע באתר יהיה מדויק, אך ייתכנו טעויות בתמונות או בתיאורים. לא נהיה אחראים לנזק עקיף שנגרם משימוש באתר, ככל שהחוק מתיר.

## יצירת קשר
[[טלפון, דוא"ל וכתובת לפניות]]
`),
  ar: text(`
## عام
يُشغَّل الموقع من قبل [[اسم المصلحة ورقمها]] ("مشكاة"، "نحن"). استخدام الموقع والطلب من خلاله يخضعان لهذه الشروط. إذا كنتم لا توافقون عليها، يُرجى عدم استخدام الموقع.

## الطلبات
- يُستقبل الطلب بعد حفظه في الموقع وظهور صفحة التأكيد. الطلب بالبطاقة يُستقبل بعد الموافقة على الدفع.
- الأسعار ورسوم التوصيل والحدّ الأدنى للطلب هي الظاهرة وقت الطلب، وتشمل ضريبة القيمة المضافة.
- أوقات الاستلام والتوصيل تقديرية وقد تتغيّر في أوقات الضغط.
- قد تنفد بعض المنتجات؛ في هذه الحالة سنتواصل معكم لاقتراح بديل أو لإعادة المبلغ.

## الإلغاء والاسترجاع
يمكن طلب إلغاء الطلب هاتفيًا ما دمنا لم نبدأ بتحضيره. الطلب المدفوع بالبطاقة والملغى يُعاد مبلغه إلى نفس البطاقة. [[أكملوا سياسة الإلغاء والاسترجاع الخاصة بالمصلحة]]

## نادي الزبائن والقسائم
الانضمام إلى النادي مجاني. النقاط والقسائم وبطاقة القهوة تخضع لشروط النادي الظاهرة في صفحة الانضمام، ولا يمكن استبدالها بالمال. يحقّ لنا تغيير مزايا النادي من وقت لآخر.

## مسبّبات الحساسية
يتعامل مطبخنا مع الغلوتين والحليب والبيض والمكسّرات ومسبّبات حساسية أخرى. إذا كانت لديكم حساسية، أخبرونا قبل الطلب.

## المسؤولية
نبذل جهدًا لتكون المعلومات في الموقع دقيقة، لكن قد تقع أخطاء في الصور أو الأوصاف. لن نكون مسؤولين عن ضرر غير مباشر ناتج عن استخدام الموقع، بالقدر الذي يسمح به القانون.

## التواصل
[[الهاتف والبريد الإلكتروني والعنوان للتواصل]]
`),
  en: text(`
## General
The site is operated by [[business name and registration number]] ("Mishkat", "we"). Using the site and ordering through it are subject to these terms. If you don't agree to them, please don't use the site.

## Orders
- An order is received once it is saved on the site and the confirmation page appears. A card order is received once the payment is approved.
- Prices, delivery fees and minimum orders are those shown at the time of ordering, including VAT.
- Pickup and delivery times are estimates and may change at busy times.
- Items may run out; if so, we will contact you to offer an alternative or a refund.

## Cancellations and refunds
You can ask to cancel an order by phone as long as we haven't started preparing it. A cancelled card order is refunded to the same card. [[Complete the business's cancellation and refund policy]]

## Customer club and coupons
Joining the club is free. Points, coupons and the coffee card are subject to the club terms shown on the sign-up page and cannot be exchanged for cash. We may change club benefits from time to time.

## Allergens
Our kitchen handles gluten, milk, eggs, nuts and other allergens. If you have an allergy, tell us before ordering.

## Liability
We make an effort to keep the information on the site accurate, but pictures or descriptions may contain mistakes. To the extent the law allows, we are not liable for indirect damage caused by using the site.

## Contact
[[phone, email and address for enquiries]]
`),
};

const PRIVACY: InfoPageCopy = {
  he: text(`
## מי אנחנו
מדיניות זו מסבירה איזה מידע אוסף [[שם העסק וח.פ/ע.מ]] ("משקאת") באתר, למה ואיך הוא נשמר.

## איזה מידע נאסף
- בהזמנה: שם, טלפון, ובמשלוח גם כתובת, אזור וקישור מיקום (Waze / Google Maps) אם נמסר.
- במועדון הלקוחות: כתובת מייל, שם, טלפון, היסטוריית נקודות וקופונים, והסכמה לדיוור אם ניתנה.
- בתשלום בכרטיס: פרטי הכרטיס מוקלדים בעמוד של חברת הסליקה, ואנחנו לא רואים ולא שומרים אותם.

## למה המידע משמש
להכנת ההזמנה ומסירתה, ליצירת קשר בנוגע להזמנה, לניהול המועדון וההטבות, ולשליחת עדכונים במייל למי שהסכים לכך.

## מה נשמר במכשיר שלכם
האתר שומר בדפדפן מידע שעוזר לו לעבוד: שפה, עגלה, מועדפים, "ההזמנות שלי", הגדרות נגישות, שולחן שנסרק (3 שעות), ופרטי ההזמנה האחרונה למילוי עמוד התשלום (180 יום, למי שאינו מחובר למועדון). התחברות למועדון נשמרת בעוגייה (cookie) לכ-6 חודשים. אין באתר עוגיות פרסום.

## עם מי המידע משותף
עם ספקים שמפעילים את השירות עבורנו בלבד: אחסון ומסד נתונים (Google Firebase, Vercel), סליקת אשראי (HYP), ושליחת מיילים (Brevo). השליח רואה את פרטי המשלוח הדרושים לו. איננו מוכרים מידע.

## הזכויות שלכם
אפשר לבקש לעיין במידע שלכם, לתקן אותו או למחוק אותו, ולהסיר הסכמה לדיוור בכל עת. פנו אלינו: [[דוא"ל לפניות פרטיות]]

## אבטחה ושמירה
המידע נשמר בשרתים מאובטחים, והגישה אליו מוגבלת לצוות שצריך אותה. אנחנו שומרים מידע כל עוד הוא נחוץ למטרות שלמעלה או כנדרש בחוק.

מדיניות זו עודכנה לאחרונה ב-[[תאריך]].
`),
  ar: text(`
## من نحن
توضّح هذه السياسة ما هي المعلومات التي يجمعها [[اسم المصلحة ورقمها]] ("مشكاة") في الموقع، ولماذا وكيف تُحفظ.

## ما المعلومات التي تُجمع
- عند الطلب: الاسم والهاتف، وفي التوصيل أيضًا العنوان والمنطقة ورابط الموقع (Waze / Google Maps) إذا أُعطي.
- في نادي الزبائن: البريد الإلكتروني، الاسم، الهاتف، سجلّ النقاط والقسائم، والموافقة على الرسائل التسويقية إن أُعطيت.
- عند الدفع بالبطاقة: تُكتب تفاصيل البطاقة في صفحة شركة المقاصّة، ونحن لا نراها ولا نحفظها.

## لماذا تُستخدم المعلومات
لتحضير الطلب وتسليمه، وللتواصل بشأن الطلب، ولإدارة النادي والمزايا، ولإرسال تحديثات بالبريد لمن وافق على ذلك.

## ما يُحفظ على جهازكم
يحفظ الموقع في المتصفّح معلومات تساعده على العمل: اللغة، السلة، المفضّلة، "طلباتي"، إعدادات إمكانية الوصول، الطاولة التي تمّ مسحها (3 ساعات)، وتفاصيل الطلب الأخير لملء صفحة الدفع (180 يومًا، لمن لم يسجّل الدخول إلى النادي). يُحفظ تسجيل الدخول إلى النادي في ملف تعريف ارتباط (cookie) لنحو 6 أشهر. لا توجد في الموقع ملفات تعريف ارتباط إعلانية.

## مع من تُشارك المعلومات
فقط مع مزوّدين يشغّلون الخدمة من أجلنا: الاستضافة وقاعدة البيانات (Google Firebase، Vercel)، مقاصّة البطاقات (HYP)، وإرسال البريد (Brevo). يرى المندوب تفاصيل التوصيل التي يحتاجها. نحن لا نبيع المعلومات.

## حقوقكم
يمكنكم طلب الاطّلاع على معلوماتكم أو تصحيحها أو حذفها، وسحب الموافقة على الرسائل التسويقية في أي وقت. تواصلوا معنا: [[البريد الإلكتروني لطلبات الخصوصية]]

## الأمان والحفظ
تُحفظ المعلومات في خوادم آمنة، والوصول إليها محصور بالطاقم الذي يحتاجها. نحتفظ بالمعلومات ما دامت ضرورية للأغراض المذكورة أو كما يتطلّب القانون.

آخر تحديث لهذه السياسة: [[التاريخ]].
`),
  en: text(`
## Who we are
This policy explains what information [[business name and registration number]] ("Mishkat") collects on the site, why, and how it is kept.

## What we collect
- When you order: name and phone, and for delivery also the address, area and location link (Waze / Google Maps) if you give one.
- In the customer club: email address, name, phone, points and coupon history, and marketing consent if given.
- When you pay by card: card details are typed on the payment company's page; we never see or keep them.

## Why we use it
To prepare and hand over your order, to contact you about it, to run the club and its benefits, and to send email updates to those who agreed.

## What is kept on your device
The site keeps information in your browser that helps it work: language, cart, favourites, "My orders", accessibility settings, a scanned table (3 hours), and your last order's details to fill in the checkout (180 days, if you're not signed in to the club). Club sign-in is kept in a cookie for about 6 months. The site has no advertising cookies.

## Who we share it with
Only with providers that run the service for us: hosting and database (Google Firebase, Vercel), card payments (HYP) and email delivery (Brevo). The courier sees the delivery details they need. We don't sell information.

## Your rights
You can ask to see, correct or delete your information, and withdraw marketing consent at any time. Contact us: [[email for privacy requests]]

## Security and retention
Information is kept on secure servers, and access is limited to staff who need it. We keep information as long as it is needed for the purposes above or as required by law.

This policy was last updated on [[date]].
`),
};

export const INFO_PAGE_DRAFTS: Record<InfoPageId, InfoPageCopy> = {
  faq: FAQ,
  accessibility: ACCESSIBILITY,
  terms: TERMS,
  privacy: PRIVACY,
};
