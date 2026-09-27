/**
 * «مسیرهای من»: the kinds of work a person mostly uses the assistant for. Chosen once at
 * onboarding (up to PATH_MAX) and changeable in «شخصی‌سازی». A path never hides a feature; it
 * picks starters, menu shortcuts, a suggested ready-made assistant, a short system-prompt hint
 * and optional deadline reminders. Everything here is app-defined (trusted) and pure.
 */
import {
  gregorianToJalali,
  jalaliMonthLength,
  jalaliToGregorian,
  tehranDate,
} from "./iran-holidays.ts";

export const PATH_MAX = 3;

export const PATH_IDS = [
  "finance",
  "business",
  "office",
  "legal",
  "university",
  "konkur",
  "developer",
] as const;
export type PathId = (typeof PATH_IDS)[number];

/** lucide-react-native icon names; the app maps each to a component (see mobile profile.tsx). */
export const PATH_ICONS = [
  "calculator",
  "store",
  "file-text",
  "scale",
  "graduation-cap",
  "pencil-line",
  "code",
  "chart-pie",
  "camera",
  "receipt",
  "message-square-reply",
  "clipboard-list",
  "landmark",
  "handshake",
  "book-open",
  "languages",
  "book-open-check",
  "timer",
  "bug",
  "terminal",
  "wallet",
  "users",
  "calendar-clock",
  "megaphone",
] as const;
export type PathIcon = (typeof PATH_ICONS)[number];

export interface PathOption {
  id: string;
  /** Persian chip label. */
  label: string;
  /** Persian phrase that makes sense without the question, e.g. «مشمول ارزش افزوده». */
  summary?: string;
}

/** One optional follow-up question; ids are globally unique ("<path>.<name>"). */
export interface PathQuestion {
  id: string;
  label: string;
  options: PathOption[];
  multi?: boolean;
}

/** One tappable starter on the empty chat screen (same shape as the app's StarterSuggestion). */
export interface PathStarter {
  id: string;
  label: string;
  prompt: string;
  icon: PathIcon;
}

/**
 * One «میان‌برهای شما» item in the menu. `prompt` opens a new conversation with that text ready
 * to send; `personaId` starts a new conversation with that ready-made assistant.
 */
export interface PathShortcut {
  id: string;
  label: string;
  icon: PathIcon;
  prompt?: string;
  personaId?: string;
}

export type PathResponseLength = "short" | "normal" | "long";

export interface PathDefinition {
  id: PathId;
  /** Persian name, e.g. «امور مالی و حسابداری». */
  name: string;
  /** Short Persian name for tags, e.g. «امور مالی». */
  shortName: string;
  icon: PathIcon;
  /** One Persian line under the name on the picker card. */
  description: string;
  /** Ready-made assistant (PERSONAS id) suggested for this path. */
  personaId?: string;
  /** English system-prompt hint (trusted, app-defined). */
  hint: string;
  starters: PathStarter[];
  shortcuts: PathShortcut[];
  questions: PathQuestion[];
  /** Persian words that mark a conversation as this path's topic (for the persona suggestion). */
  keywords: string[];
  /** Answer length used only while the person never chose one themselves. */
  defaultLength?: PathResponseLength;
}

const VAT_OPTIONS: PathOption[] = [
  { id: "yes", label: "هستم", summary: "مشمول ارزش افزوده" },
  { id: "no", label: "نیستم", summary: "غیرمشمول ارزش افزوده" },
  { id: "unknown", label: "نمی‌دانم", summary: "وضعیت ارزش افزوده نامعلوم" },
];

export const PATHS: readonly PathDefinition[] = [
  {
    id: "finance",
    name: "امور مالی و حسابداری",
    shortName: "امور مالی",
    icon: "calculator",
    description: "خرج و درآمد، فاکتور، مالیات و چک",
    personaId: "accountant",
    hint: "The user mostly works on personal or business finance in Iran: budgeting, invoices, cheques (چک), loans and instalments, VAT (مالیات بر ارزش افزوده), سامانهٔ مودیان, income tax and insurance. Show amounts in تومان with Persian digits and state when a figure is ریال, use Jalali dates, show calculations step by step, and flag tax rates or deadlines that must be checked against the current year's rules.",
    starters: [
      {
        id: "finance-spending",
        label: "خرج‌های این ماه را از فایل بانک تحلیل کن",
        prompt:
          "می‌خواهم خرج‌های این ماهم را تحلیل کنم. فایل صورت‌حساب بانک (CSV یا اکسل) را می‌فرستم؛ خرج‌ها را دسته‌بندی کن، جمع هر دسته را به تومان بگو و سه پیشنهاد برای صرفه‌جویی بده.",
        icon: "chart-pie",
      },
      {
        id: "finance-vat",
        label: "ارزش افزودهٔ یک فاکتور را حساب کن",
        prompt:
          "ارزش افزودهٔ یک فاکتور فروش را برایم حساب کن. اول مبلغ فاکتور را از من بپرس، نرخی را که فرض می‌کنی بگو و جمع کل را به تومان بنویس.",
        icon: "receipt",
      },
      {
        id: "finance-cheques",
        label: "فهرست چک‌ها و قسط‌های این ماه",
        prompt:
          "می‌خواهم سررسید چک‌ها و قسط‌های وامم را مرتب کنم. از من بپرس هر کدام چه مبلغ و چه تاریخی دارد، سپس یک جدول به ترتیب تاریخ شمسی با جمع هر هفته بساز.",
        icon: "wallet",
      },
    ],
    shortcuts: [
      {
        id: "finance-spending",
        label: "تحلیل خرج",
        icon: "chart-pie",
        prompt:
          "می‌خواهم خرج‌هایم را تحلیل کنم. فایل صورت‌حساب بانک (CSV یا اکسل) را می‌فرستم؛ خرج‌ها را دسته‌بندی کن و جمع هر دسته را به تومان بگو.",
      },
      {
        id: "finance-invoice",
        label: "پیش‌فاکتور",
        icon: "receipt",
        prompt:
          "یک پیش‌فاکتور PDF برایم بساز. نام فروشنده و خریدار، شرح هر کالا یا خدمت با تعداد و مبلغ واحد به تومان، و اینکه ارزش افزوده حساب شود یا نه را در یک پیام از من بپرس و بعد پیش‌فاکتور را بساز.",
      },
      { id: "finance-accountant", label: "حسابدار", icon: "calculator", personaId: "accountant" },
    ],
    questions: [
      {
        id: "finance.scope",
        label: "بیشتر برای کدام؟",
        options: [
          { id: "personal", label: "امور شخصی" },
          { id: "business", label: "کسب‌وکار" },
          { id: "both", label: "هر دو" },
        ],
      },
      { id: "finance.vat", label: "مشمول مالیات بر ارزش افزوده هستید؟", options: VAT_OPTIONS },
      {
        id: "finance.employees",
        label: "کارمند بیمه‌شده دارید؟",
        options: [
          { id: "yes", label: "دارم", summary: "کارمند بیمه‌شده دارد" },
          { id: "no", label: "ندارم", summary: "بدون کارمند بیمه‌شده" },
        ],
      },
    ],
    keywords: [
      "مالیات",
      "ارزش افزوده",
      "فاکتور",
      "اظهارنامه",
      "سامانهٔ مودیان",
      "سامانه مودیان",
      "حسابداری",
      "ترازنامه",
      "سود و زیان",
      "بیمه تامین اجتماعی",
      "بیمهٔ تأمین اجتماعی",
      "لیست بیمه",
      "چک برگشتی",
      "بودجه",
    ],
  },
  {
    id: "business",
    name: "کسب‌وکار و فروش آنلاین",
    shortName: "فروش آنلاین",
    icon: "store",
    description: "اینستاگرام، دیوار، پاسخ به مشتری",
    personaId: "marketer",
    hint: "The user runs or works in a small Iranian business that sells online (Instagram, Telegram, Divar, Torob, their own site) or in person. Favour ready-to-use Persian copy (captions, listings, replies to customers, price lists), practical sales and customer-service advice for the Iranian market, and amounts in تومان.",
    starters: [
      {
        id: "business-caption",
        label: "برای محصول جدید کپشن اینستاگرام بنویس",
        prompt:
          "برای معرفی یک محصول جدید در اینستاگرام سه کپشن کوتاه با هشتگ بنویس. اول نام محصول، قیمت و مخاطبش را از من بپرس.",
        icon: "camera",
      },
      {
        id: "business-reply",
        label: "جواب مؤدبانه برای مشتری ناراضی",
        prompt:
          "یک مشتری از سفارشش ناراضی است. پیامش را برایت می‌فرستم؛ یک جواب مؤدبانه و کوتاه بنویس که مشکل را بپذیرد و راه‌حل بدهد.",
        icon: "message-square-reply",
      },
      {
        id: "business-divar",
        label: "متن آگهی دیوار بنویس",
        prompt:
          "برای یک آگهی در دیوار عنوان و متن جذاب و صادقانه بنویس. اول بپرس چه چیزی، با چه قیمت و در کدام شهر می‌فروشم.",
        icon: "megaphone",
      },
    ],
    shortcuts: [
      {
        id: "business-plan",
        label: "برنامهٔ محتوا",
        icon: "camera",
        prompt:
          "برای صفحهٔ اینستاگرام کسب‌وکارم یک برنامهٔ محتوای یک‌ماهه بساز که مناسبت‌های ماه جاری شمسی را هم در نظر بگیرد. اول دربارهٔ کسب‌وکار و مخاطبم بپرس.",
      },
      {
        id: "business-invoice",
        label: "پیش‌فاکتور",
        icon: "receipt",
        prompt:
          "یک پیش‌فاکتور PDF برایم بساز. نام فروشنده و خریدار، شرح هر کالا یا خدمت با تعداد و مبلغ واحد به تومان، و اینکه ارزش افزوده حساب شود یا نه را در یک پیام از من بپرس و بعد پیش‌فاکتور را بساز.",
      },
      { id: "business-marketer", label: "بازاریاب", icon: "megaphone", personaId: "marketer" },
    ],
    questions: [
      {
        id: "business.channels",
        label: "کجا می‌فروشید؟",
        multi: true,
        options: [
          { id: "instagram", label: "اینستاگرام" },
          { id: "divar", label: "دیوار" },
          { id: "torob", label: "ترب" },
          { id: "telegram", label: "تلگرام یا ایتا" },
          { id: "website", label: "سایت خودم" },
          { id: "inperson", label: "حضوری" },
        ],
      },
    ],
    keywords: [
      "اینستاگرام",
      "کپشن",
      "دیوار",
      "ترب",
      "مشتری",
      "فروش",
      "تبلیغ",
      "محتوا",
      "هشتگ",
      "آگهی",
      "فروشگاه",
    ],
  },
  {
    id: "office",
    name: "کارهای اداری و نامه‌نگاری",
    shortName: "کارهای اداری",
    icon: "file-text",
    description: "نامهٔ اداری، صورت‌جلسه، بخشنامه",
    hint: "The user does office and administrative work in Iran. Favour correct formal Persian letter conventions (سربرگ، شماره، تاریخ شمسی، پیوست، رونوشت), meeting minutes (صورت‌جلسه), summaries of circulars (بخشنامه) and clear, polite administrative wording. Ask for missing names, titles and dates instead of inventing them.",
    starters: [
      {
        id: "office-leave",
        label: "نامهٔ اداری درخواست مرخصی",
        prompt:
          "یک نامهٔ اداری رسمی برای درخواست مرخصی بنویس؛ اول نام، سمت، تاریخ‌های شمسی و نام گیرنده را از من بپرس.",
        icon: "file-text",
      },
      {
        id: "office-minutes",
        label: "صورت‌جلسه بنویس",
        prompt:
          "یک صورت‌جلسهٔ رسمی بنویس. یادداشت‌های جلسه را برایت می‌فرستم؛ حاضران، مصوبات، مسئول هر کار و مهلت شمسی آن را جدا کن.",
        icon: "clipboard-list",
      },
    ],
    shortcuts: [
      {
        id: "office-letter",
        label: "نامهٔ اداری",
        icon: "file-text",
        prompt: "یک نامهٔ اداری رسمی بنویس. اول موضوع، فرستنده، گیرنده و تاریخ شمسی را از من بپرس.",
      },
      {
        id: "office-minutes",
        label: "صورت‌جلسه",
        icon: "clipboard-list",
        prompt:
          "یک صورت‌جلسهٔ رسمی بنویس. یادداشت‌های جلسه را برایت می‌فرستم؛ حاضران، مصوبات و مسئول هر کار را جدا کن.",
      },
    ],
    questions: [
      {
        id: "office.sector",
        label: "کجا کار می‌کنید؟",
        options: [
          { id: "government", label: "اداره یا سازمان دولتی" },
          { id: "private", label: "شرکت خصوصی" },
          { id: "other", label: "جای دیگر" },
        ],
      },
    ],
    keywords: ["نامهٔ اداری", "نامه اداری", "صورت‌جلسه", "صورتجلسه", "بخشنامه", "مکاتبه", "ابلاغ"],
  },
  {
    id: "legal",
    name: "حقوقی و قرارداد",
    shortName: "حقوقی",
    icon: "scale",
    description: "اجاره‌نامه، قرارداد کار، اظهارنامه",
    personaId: "lawyer",
    hint: "The user often needs general legal information under Iranian law: leases, employment contracts, family matters, inheritance, cheques and claims. Explain in plain Persian, name the relevant law when confident, list practical next steps (e.g. ثنا، دفاتر خدمات الکترونیک قضایی) and recommend a licensed lawyer for their specific case.",
    starters: [
      {
        id: "legal-lease",
        label: "این قرارداد اجاره را بررسی کن",
        prompt:
          "یک قرارداد اجاره را برایت می‌فرستم. بندهای مهم، نکته‌های به ضرر مستأجر یا موجر و چیزهایی را که پیش از امضا باید بپرسم فهرست کن.",
        icon: "handshake",
      },
      {
        id: "legal-notice",
        label: "متن اظهارنامهٔ مطالبهٔ وجه",
        prompt:
          "می‌خواهم برای مطالبهٔ طلبم اظهارنامه بفرستم. مراحل ارسال از طریق ثنا را توضیح بده و یک متن نمونه بنویس؛ اول مبلغ و ماجرا را از من بپرس.",
        icon: "landmark",
      },
    ],
    shortcuts: [
      {
        id: "legal-contract",
        label: "بررسی قرارداد",
        icon: "handshake",
        prompt:
          "یک قرارداد را برایت می‌فرستم. بندهای مهم، ریسک‌ها و چیزهایی را که پیش از امضا باید بپرسم فهرست کن.",
      },
      {
        id: "legal-draft",
        label: "تنظیم قرارداد",
        icon: "file-text",
        prompt:
          "یک قرارداد نمونه به صورت PDF برایم تنظیم کن: اجاره‌نامهٔ مسکونی یا قرارداد کار موقت. اول بپرس کدام را می‌خواهم، بعد نام طرفین، مشخصات ملک یا شغل، مبالغ به تومان، تاریخ شروع و مدت را در یک پیام از من بپرس و هر چه را نمی‌دانم خالی بگذار.",
      },
      { id: "legal-lawyer", label: "وکیل", icon: "scale", personaId: "lawyer" },
    ],
    questions: [
      {
        id: "legal.topics",
        label: "بیشتر با کدام موضوع‌ها سروکار دارید؟",
        multi: true,
        options: [
          { id: "lease", label: "اجاره و ملک" },
          { id: "labor", label: "کار و بیمه" },
          { id: "family", label: "خانواده" },
          { id: "contracts", label: "قرارداد و طلب" },
          { id: "inheritance", label: "ارث" },
        ],
      },
    ],
    keywords: [
      "قرارداد",
      "اجاره",
      "دادگاه",
      "شکایت",
      "وکیل",
      "اظهارنامه",
      "مهریه",
      "ارث",
      "قانون کار",
      "دادخواست",
      "ثنا",
    ],
  },
  {
    id: "university",
    name: "دانشجو و پژوهش",
    shortName: "دانشجو",
    icon: "graduation-cap",
    description: "مقاله، پروپوزال، ترجمهٔ تخصصی",
    personaId: "tutor",
    hint: "The user is a university student or researcher in Iran. Help with reading and summarising papers, proposals and theses, academic Persian and English writing, citations, and explaining concepts step by step. Never fabricate references or data; say when a source must be checked.",
    starters: [
      {
        id: "university-paper",
        label: "این مقاله را خلاصه کن",
        prompt:
          "یک مقاله را برایت می‌فرستم. هدف، روش، یافته‌های اصلی و محدودیت‌هایش را به فارسی روان و کوتاه خلاصه کن.",
        icon: "book-open",
      },
      {
        id: "university-abstract",
        label: "چکیدهٔ پایان‌نامه‌ام را ترجمه کن",
        prompt:
          "چکیدهٔ پایان‌نامه‌ام را برایت می‌فرستم. آن را به انگلیسی آکادمیک و روان ترجمه کن و اصطلاحات تخصصی را دست نزن.",
        icon: "languages",
      },
    ],
    shortcuts: [
      {
        id: "university-summary",
        label: "خلاصهٔ مقاله",
        icon: "book-open",
        prompt: "یک مقاله را برایت می‌فرستم. هدف، روش، یافته‌ها و محدودیت‌هایش را کوتاه خلاصه کن.",
      },
      {
        id: "university-translate",
        label: "ترجمهٔ تخصصی",
        icon: "languages",
        prompt:
          "یک متن تخصصی برایت می‌فرستم؛ آن را دقیق و روان ترجمه کن و اصطلاحات مهمش را توضیح بده.",
      },
    ],
    questions: [
      {
        id: "university.level",
        label: "در چه مقطعی هستید؟",
        options: [
          { id: "bachelor", label: "کارشناسی" },
          { id: "master", label: "کارشناسی ارشد" },
          { id: "phd", label: "دکتری" },
          { id: "researcher", label: "پژوهشگر یا استاد" },
        ],
      },
    ],
    keywords: [
      "مقاله",
      "پایان‌نامه",
      "پایان نامه",
      "پروپوزال",
      "رساله",
      "منابع",
      "رفرنس",
      "چکیده",
      "استاد راهنما",
    ],
  },
  {
    id: "konkur",
    name: "دانش‌آموز و کنکور",
    shortName: "کنکور",
    icon: "pencil-line",
    description: "برنامهٔ مطالعه، حل تمرین",
    personaId: "konkur",
    hint: "The user is an Iranian school student, often preparing for کنکور. Explain step by step with short examples aligned with the Iranian curriculum, prefer guiding over giving homework answers outright, keep answers short and encouraging, and tell them to confirm سازمان سنجش rules and dates on sanjesh.org.",
    starters: [
      {
        id: "konkur-plan",
        label: "برنامهٔ مطالعهٔ هفتگی برایم بچین",
        prompt:
          "برای کنکور یک برنامهٔ مطالعهٔ هفتگی واقع‌بینانه برایم بچین. اول رشته، پایه و ساعت‌های آزادم را بپرس.",
        icon: "calendar-clock",
      },
      {
        id: "konkur-solve",
        label: "این تست را قدم‌به‌قدم حل کن",
        prompt:
          "یک تست را برایت می‌فرستم. قدم‌به‌قدم حلش کن و در پایان بگو برای تست‌های مشابه به چه نکته‌ای دقت کنم.",
        icon: "book-open-check",
      },
    ],
    shortcuts: [
      {
        id: "konkur-plan",
        label: "برنامهٔ مطالعه",
        icon: "calendar-clock",
        prompt: "برای کنکور یک برنامهٔ مطالعهٔ هفتگی برایم بچین. اول رشته و ساعت‌های آزادم را بپرس.",
      },
      { id: "konkur-advisor", label: "مشاور کنکور", icon: "book-open-check", personaId: "konkur" },
    ],
    questions: [
      {
        id: "konkur.group",
        label: "گروه آزمایشی شما؟",
        options: [
          { id: "math", label: "ریاضی" },
          { id: "science", label: "تجربی" },
          { id: "humanities", label: "انسانی" },
          { id: "art", label: "هنر" },
          { id: "language", label: "زبان" },
        ],
      },
    ],
    keywords: ["کنکور", "تست", "آزمون", "برنامهٔ مطالعه", "برنامه مطالعه", "تراز", "رتبه", "درس"],
    defaultLength: "short",
  },
  {
    id: "developer",
    name: "برنامه‌نویسی و فنی",
    shortName: "برنامه‌نویسی",
    icon: "code",
    description: "کد، خطایابی، اسکریپت",
    hint: "The user is a software developer or technical person. Answer with precise technical detail, complete runnable code blocks, and short explanations of errors and trade-offs. Keep code, commands, file paths and identifiers in English and left-to-right; explain in Persian.",
    starters: [
      {
        id: "developer-error",
        label: "این خطا را توضیح بده",
        prompt: "یک پیام خطا برایت می‌فرستم؛ علتش را توضیح بده و راه رفع آن را با کد نشان بده.",
        icon: "bug",
      },
      {
        id: "developer-script",
        label: "یک اسکریپت پشتیبان‌گیری بنویس",
        prompt:
          "یک اسکریپت ساده برای پشتیبان‌گیری روزانه از یک پوشه بنویس. اول سیستم‌عامل و محل ذخیره را از من بپرس.",
        icon: "terminal",
      },
    ],
    shortcuts: [
      {
        id: "developer-review",
        label: "بازبینی کد",
        icon: "code",
        prompt:
          "یک تکه کد برایت می‌فرستم؛ بازبینی‌اش کن و اشکال‌ها، خطرهای امنیتی و راه ساده‌تر را بگو.",
      },
    ],
    questions: [
      {
        id: "developer.stack",
        label: "بیشتر با کدام‌ها کار می‌کنید؟",
        multi: true,
        options: [
          { id: "python", label: "Python" },
          { id: "javascript", label: "JavaScript/TypeScript" },
          { id: "java", label: "Java/Kotlin" },
          { id: "csharp", label: "C#/.NET" },
          { id: "php", label: "PHP" },
          { id: "devops", label: "لینوکس و DevOps" },
        ],
      },
    ],
    keywords: [
      "کد",
      "برنامه‌نویسی",
      "خطا",
      "اسکریپت",
      "پایتون",
      "python",
      "javascript",
      "error",
      "api",
    ],
    defaultLength: "long",
  },
];

/** Stored per person (server: kind "agent-settings", id "profile"). */
export interface UserProfile {
  /** Chosen paths in the order picked; empty means «عمومی». */
  paths: PathId[];
  /**
   * Follow-up answers: question id → chosen option ids. Answers of a path that was switched off
   * are kept so switching it on again restores them; only selected paths are ever used.
   */
  details: Record<string, string[]>;
  /** Deadline reminders (e.g. tax returns) on the chat screen. */
  reminders: boolean;
  /** The existing-user invitation card was closed. */
  inviteDismissed: boolean;
  /** When paths were last chosen or skipped; null means never (show the invitation). */
  chosenAt: string | null;
  updatedAt?: string;
}

export const EMPTY_PROFILE: UserProfile = {
  paths: [],
  details: {},
  reminders: true,
  inviteDismissed: false,
  chosenAt: null,
};

export function findPath(id: string | undefined | null): PathDefinition | undefined {
  return id ? PATHS.find((path) => path.id === id) : undefined;
}

export function findQuestion(id: string): PathQuestion | undefined {
  for (const path of PATHS) {
    const question = path.questions.find((item) => item.id === id);
    if (question) return question;
  }
  return undefined;
}

/** The selected path definitions, in the person's order. */
export function selectedPaths(profile: Pick<UserProfile, "paths">): PathDefinition[] {
  return profile.paths.map(findPath).filter((path): path is PathDefinition => Boolean(path));
}

/**
 * Keeps only known paths (deduplicated, at most PATH_MAX) and answers with known options to known
 * questions of any path (single-choice questions keep one).
 */
export function sanitizeProfile(input: Partial<UserProfile> | undefined | null): UserProfile {
  const paths = [
    ...new Set((input?.paths ?? []).filter((id): id is PathId => Boolean(findPath(id)))),
  ].slice(0, PATH_MAX);
  const details: Record<string, string[]> = {};
  for (const question of PATHS.flatMap((path) => path.questions)) {
    const known = new Set(question.options.map((option) => option.id));
    const raw = input?.details?.[question.id];
    const answers = [...new Set(Array.isArray(raw) ? raw : [])].filter((id) => known.has(id));
    if (answers.length) details[question.id] = question.multi ? answers : answers.slice(0, 1);
  }
  return {
    paths,
    details,
    reminders: input?.reminders ?? EMPTY_PROFILE.reminders,
    inviteDismissed: input?.inviteDismissed ?? false,
    chosenAt: typeof input?.chosenAt === "string" ? input.chosenAt : null,
    ...(input?.updatedAt ? { updatedAt: input.updatedAt } : {}),
  };
}

function answered(profile: UserProfile, questionId: string, optionId: string) {
  return (profile.details[questionId] ?? []).includes(optionId);
}

/** Chosen answers of one path as short Persian phrases (option summary, else its label). */
export function answerSummary(profile: Pick<UserProfile, "details">, pathId: PathId): string[] {
  return (findPath(pathId)?.questions ?? []).flatMap((question) =>
    question.options
      .filter((option) => (profile.details[question.id] ?? []).includes(option.id))
      .map((option) => option.summary ?? option.label),
  );
}

/** Up to `count` starters, one per path in turn (first path first). */
export function pathStarters(profile: Pick<UserProfile, "paths">, count = 2): PathStarter[] {
  const lists = selectedPaths(profile).map((path) => path.starters);
  const picks: PathStarter[] = [];
  for (let round = 0; picks.length < count && lists.some((list) => list[round]); round++)
    for (const list of lists) if (list[round] && picks.length < count) picks.push(list[round]);
  return picks;
}

/** «میان‌برهای شما»: shortcuts of the selected paths, one per label or assistant, at most `max`. */
export function pathShortcuts(profile: Pick<UserProfile, "paths">, max = 4): PathShortcut[] {
  const seen = new Set<string>();
  const picks: PathShortcut[] = [];
  const lists = selectedPaths(profile).map((path) => path.shortcuts);
  for (let round = 0; picks.length < max && lists.some((list) => list[round]); round++)
    for (const list of lists) {
      const item = list[round];
      if (!item || picks.length >= max) continue;
      const key = item.personaId ? `persona:${item.personaId}` : item.label;
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push(item);
    }
  return picks;
}

/** Ready-made assistants suggested by the selected paths, in order, without duplicates. */
export function suggestedPersonaIds(profile: Pick<UserProfile, "paths">): string[] {
  return [
    ...new Set(
      selectedPaths(profile)
        .map((path) => path.personaId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

/**
 * The selected path (with a ready-made assistant) whose keywords appear in `text`, the one with
 * the most matching keywords; undefined when none match.
 */
export function matchPathTopic(
  profile: Pick<UserProfile, "paths">,
  text: string,
): PathDefinition | undefined {
  const haystack = text.toLowerCase();
  let best: { path: PathDefinition; hits: number } | undefined;
  for (const path of selectedPaths(profile)) {
    if (!path.personaId) continue;
    const hits = path.keywords.filter((word) => haystack.includes(word.toLowerCase())).length;
    if (hits && (!best || hits > best.hits)) best = { path, hits };
  }
  return best?.path;
}

/** Answer length a path implies while the person never chose one (first path wins). */
export function pathDefaultLength(
  profile: Pick<UserProfile, "paths">,
): PathResponseLength | undefined {
  return selectedPaths(profile).find((path) => path.defaultLength)?.defaultLength;
}

/** English system-prompt text for the chosen paths and answers (trusted, app-defined only). */
export function pathPrompt(profile: UserProfile): string {
  const paths = selectedPaths(profile);
  if (!paths.length) return "";
  const lines = paths.map((path) => {
    const answers = path.questions
      .map((question) => {
        const chosen = question.options
          .filter((option) => answered(profile, question.id, option.id))
          .map((option) => option.label);
        return chosen.length ? `${question.label} ${chosen.join("، ")}` : "";
      })
      .filter(Boolean);
    return `- «${path.name}»: ${path.hint}${answers.length ? ` The user's answers (Persian): ${answers.join(" | ")}.` : ""}`;
  });
  return ` USER'S WORK FOCUS (chosen by the user in the app's «مسیرهای من»; use it to pick examples, units and defaults, but answer any topic they ask about):\n${lines.join("\n")}`;
}

// --- Deadline reminders -------------------------------------------------------------------------

export interface DeadlineRule {
  id: string;
  pathId: PathId;
  /** Persian title shown on the card. */
  title: string;
  /** Message sent when the person taps «آماده‌سازی». */
  prompt: string;
  /** Persian label of the preparation button. */
  action: string;
  /** Jalali month (1–12) and day; "end" is the last day of that month. Empty months = every month. */
  months: number[];
  day: number | "end";
  /** Applies only when this follow-up answer was chosen; an unanswered question counts as «unknown». */
  when?: { question: string; anyOf: string[] };
}

/**
 * Legal deadlines. They are extended some years by سازمان امور مالیاتی announcements, so the card
 * says «مهلت قانونی». VAT: the 15th of the second month after each season (قانون مالیات بر ارزش
 * افزوده ۱۴۰۰). Review this list each Jalali year.
 */
export const DEADLINE_RULES: readonly DeadlineRule[] = [
  ...(
    [
      [5, "بهار"],
      [8, "تابستان"],
      [11, "پاییز"],
      [2, "زمستان"],
    ] as const
  ).map(
    ([month, season]): DeadlineRule => ({
      id: `vat-${month}`,
      pathId: "finance",
      title: `مهلت قانونی اظهارنامهٔ ارزش افزودهٔ ${season}`,
      prompt: `مهلت اظهارنامهٔ مالیات بر ارزش افزودهٔ فصل ${season} نزدیک است. یک فهرست کارهای لازم برای ارسال اظهارنامه در سامانهٔ مودیان بنویس و بگو چه اطلاعاتی از فاکتورهای این فصل لازم است.`,
      action: "آماده‌سازی فهرست کارها",
      months: [month],
      day: 15,
      when: { question: "finance.vat", anyOf: ["yes", "unknown"] },
    }),
  ),
  {
    id: "income-tax",
    pathId: "finance",
    title: "مهلت قانونی اظهارنامهٔ مالیات عملکرد مشاغل",
    prompt:
      "مهلت اظهارنامهٔ مالیات عملکرد مشاغل (اشخاص حقیقی) پایان خرداد است. فهرست مدارک و مراحل ارسال در my.tax.gov.ir را بنویس.",
    action: "فهرست مدارک",
    months: [3],
    day: "end",
    when: { question: "finance.scope", anyOf: ["business", "both"] },
  },
  {
    id: "insurance-list",
    pathId: "finance",
    title: "مهلت لیست بیمه و مالیات حقوق ماه قبل",
    prompt:
      "مهلت ارسال لیست بیمهٔ تأمین اجتماعی و مالیات حقوق ماه قبل پایان همین ماه است. کارهای لازم را قدم‌به‌قدم بنویس.",
    action: "کارهای لازم",
    months: [],
    day: "end",
    when: { question: "finance.employees", anyOf: ["yes"] },
  },
];

export interface UpcomingDeadline {
  /** `${rule.id}-${legalDate}`; stays the same when the deadline is extended. */
  id: string;
  pathId: PathId;
  title: string;
  prompt: string;
  action: string;
  /** Effective due day, Gregorian YYYY-MM-DD (Asia/Tehran calendar day); the extended day if any. */
  date: string;
  /** The day the law sets, before any extension. */
  legalDate: string;
  /** Set when an admin recorded an extension for this occurrence. */
  extended?: { note?: string };
  /** 0 = today. */
  daysLeft: number;
}

/**
 * An announced extension (تمدید) of one deadline occurrence, recorded by an admin. `id` is the
 * occurrence id (`${rule.id}-${legalDate}`, e.g. "vat-8-2026-11-06"); `date` is the new due day.
 */
export interface DeadlineOverride {
  id: string;
  /** New due day, Gregorian YYYY-MM-DD (Asia/Tehran calendar day). */
  date: string;
  /** Short Persian note, e.g. «طبق اطلاعیهٔ سازمان امور مالیاتی». */
  note?: string;
  updatedAt?: string;
}

const DAY_MS = 86_400_000;

/**
 * Deadlines of the selected paths due within `windowDays` (Tehran calendar days, today included),
 * nearest first. Empty when reminders are off.
 */
export function upcomingDeadlines(
  profile: UserProfile,
  now: Date = new Date(),
  windowDays = 10,
  overrides: readonly DeadlineOverride[] = [],
): UpcomingDeadline[] {
  if (!profile.reminders) return [];
  const extensions = new Map(overrides.map((item) => [item.id, item]));
  const today = tehranDate(now);
  const { year } = gregorianToJalali(today);
  const found: UpcomingDeadline[] = [];
  for (const rule of DEADLINE_RULES) {
    if (!profile.paths.includes(rule.pathId)) continue;
    const when = rule.when;
    const answers = profile.details[when?.question ?? ""] ?? [];
    if (
      when &&
      !when.anyOf.some((id) => answers.includes(id) || (id === "unknown" && !answers.length))
    )
      continue;
    const months = rule.months.length ? rule.months : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    for (const jy of [year, year + 1])
      for (const jm of months) {
        const jd = rule.day === "end" ? jalaliMonthLength(jy, jm) : rule.day;
        const legalDate = jalaliToGregorian(jy, jm, jd);
        const id = `${rule.id}-${legalDate}`;
        const extension = extensions.get(id);
        const date = extension?.date ?? legalDate;
        const daysLeft = Math.round((Date.parse(date) - Date.parse(today)) / DAY_MS);
        if (daysLeft < 0 || daysLeft >= windowDays) continue;
        found.push({
          id,
          pathId: rule.pathId,
          title: rule.title,
          prompt: rule.prompt,
          action: rule.action,
          date,
          legalDate,
          ...(extension ? { extended: extension.note ? { note: extension.note } : {} } : {}),
          daysLeft,
        });
      }
  }
  return found.sort((a, b) => a.date.localeCompare(b.date));
}
