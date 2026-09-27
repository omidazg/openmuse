import { z } from "zod";
import {
  addJalaliMonths,
  blank,
  code,
  DocumentError,
  documentStyle,
  escapeHtml,
  faMoney,
  faNumber,
  fill,
  jalaliDay,
  parseDay,
  parseInput,
  present,
  signBoxes,
  text,
  today,
} from "./format.ts";
import { numberToPersianWords } from "./num-to-words.ts";

/** Printed on every contract, in the footer of each page and at the end. */
export const CONTRACT_DISCLAIMER =
  "این متن نمونه است و جایگزین مشاورهٔ حقوقی نیست؛ پیش از امضا با کارشناس حقوقی مشورت کنید.";

export const CONTRACT_TEMPLATES = {
  residential_lease: "اجاره‌نامهٔ مسکونی",
  temporary_employment: "قرارداد کار ساده (موقت)",
} as const;
export type ContractTemplate = keyof typeof CONTRACT_TEMPLATES;

const MAX_TOMAN = 999_999_999_999_999;
const optionalText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} حداکثر ${faNumber(max)} نویسه است.`)
    .optional();
const amount = (label: string) =>
  z
    .number({ error: `${label} باید یک عدد به تومان باشد.` })
    .int(`${label} را به تومان و بدون اعشار بنویسید.`)
    .min(0, `${label} نمی‌تواند منفی باشد.`)
    .max(MAX_TOMAN, `${label} بیش از حد بزرگ است.`)
    .describe(`${label} in Toman (not Rial)`);
const day = (label: string) =>
  z
    .string()
    .max(20, `${label} نامعتبر است.`)
    .optional()
    .describe("YYYY-MM-DD, Jalali (1405-07-01) or Gregorian");
const months = (label: string) =>
  z
    .number({ error: `${label} باید تعداد ماه باشد.` })
    .int(`${label} را به ماه و بدون اعشار بنویسید.`)
    .min(1, `${label} دست‌کم یک ماه است.`)
    .max(120, `${label} حداکثر ۱۲۰ ماه است.`)
    .optional();
const payDay = z
  .number({ error: "روز پرداخت باید عددی از ۱ تا ۳۱ باشد." })
  .int("روز پرداخت باید عددی از ۱ تا ۳۱ باشد.")
  .min(1, "روز پرداخت باید عددی از ۱ تا ۳۱ باشد.")
  .max(31, "روز پرداخت باید عددی از ۱ تا ۳۱ باشد.")
  .optional()
  .describe("Day of each Jalali month the payment is due");

const partySchema = (role: string) =>
  z
    .object({
      name: optionalText(160, `نام ${role}`),
      nationalId: optionalText(30, `کد یا شناسهٔ ملی ${role}`),
      fatherName: optionalText(80, `نام پدر ${role}`),
      phone: optionalText(40, `تلفن ${role}`),
      address: optionalText(400, `نشانی ${role}`),
    })
    .optional();

const extraTerms = z
  .array(z.string().trim().min(1).max(600, "هر شرط اضافه حداکثر ۶۰۰ نویسه است."))
  .max(10, "حداکثر ۱۰ شرط اضافه می‌توان نوشت.")
  .optional()
  .describe("Additional terms the parties agreed on, one per item, in Persian");

export const leaseSchema = z.object({
  landlord: partySchema("موجر"),
  tenant: partySchema("مستأجر"),
  property: z
    .object({
      address: optionalText(400, "نشانی ملک"),
      postalCode: optionalText(20, "کد پستی"),
      deedInfo: optionalText(120, "پلاک ثبتی").describe("پلاک ثبتی / مشخصات سند"),
      area: z
        .number({ error: "مساحت باید یک عدد به متر مربع باشد." })
        .positive("مساحت باید بیشتر از صفر باشد.")
        .max(100_000, "مساحت بیش از حد بزرگ است.")
        .optional()
        .describe("Square metres"),
      rooms: z
        .number({ error: "تعداد اتاق باید یک عدد باشد." })
        .int("تعداد اتاق باید عدد صحیح باشد.")
        .min(0, "تعداد اتاق نمی‌تواند منفی باشد.")
        .max(50, "تعداد اتاق بیش از حد بزرگ است.")
        .optional(),
      floor: optionalText(30, "طبقه"),
      parking: z.boolean().optional(),
      storage: z.boolean().optional(),
      amenities: optionalText(600, "امکانات").describe("Fixtures handed over, in Persian"),
    })
    .optional(),
  deposit: amount("مبلغ ودیعه (رهن)").optional(),
  monthlyRent: amount("اجاره‌بهای ماهانه").optional(),
  paymentDay: payDay,
  startDate: day("تاریخ شروع"),
  durationMonths: months("مدت اجاره"),
  endDate: day("تاریخ پایان"),
  occupants: z
    .number({ error: "تعداد ساکنان باید یک عدد باشد." })
    .int("تعداد ساکنان باید عدد صحیح باشد.")
    .min(1, "تعداد ساکنان دست‌کم یک نفر است.")
    .max(50, "تعداد ساکنان بیش از حد بزرگ است.")
    .optional(),
  city: optionalText(80, "محل تنظیم قرارداد"),
  signDate: day("تاریخ تنظیم"),
  extraTerms,
});

export const employmentSchema = z.object({
  employer: partySchema("کارفرما"),
  employerRepresentative: optionalText(160, "نام نمایندهٔ کارفرما"),
  employee: partySchema("کارگر"),
  jobTitle: optionalText(120, "عنوان شغل"),
  duties: optionalText(1500, "شرح وظایف"),
  workplace: optionalText(400, "نشانی محل کار"),
  weeklyHours: z
    .number({ error: "ساعات کار هفتگی باید یک عدد باشد." })
    .positive("ساعات کار هفتگی باید بیشتر از صفر باشد.")
    .max(80, "ساعات کار هفتگی بیش از حد بزرگ است.")
    .optional(),
  schedule: optionalText(200, "برنامهٔ کاری").describe("e.g. شنبه تا چهارشنبه، ۸ تا ۱۶"),
  monthlyWage: amount("مزد ماهانه").optional(),
  allowances: z
    .array(
      z.object({
        title: z.string().trim().min(1, "عنوان هر مزایا را وارد کنید.").max(80),
        amount: amount("مبلغ مزایا"),
      }),
    )
    .max(10, "حداکثر ۱۰ ردیف مزایا می‌توان نوشت.")
    .optional()
    .describe("Monthly allowances such as حق مسکن or بن خواربار"),
  paymentDay: payDay,
  startDate: day("تاریخ شروع"),
  durationMonths: months("مدت قرارداد"),
  endDate: day("تاریخ پایان"),
  probationMonths: z
    .number({ error: "دورهٔ آزمایشی باید تعداد ماه باشد." })
    .int("دورهٔ آزمایشی را به ماه و بدون اعشار بنویسید.")
    .min(1, "دورهٔ آزمایشی دست‌کم یک ماه است.")
    .max(3, "دورهٔ آزمایشی حداکثر سه ماه است.")
    .optional(),
  city: optionalText(80, "محل تنظیم قرارداد"),
  signDate: day("تاریخ تنظیم"),
  extraTerms,
});

export const contractInputSchema = z.object({
  template: z
    .enum(["residential_lease", "temporary_employment"], {
      error: "نوع قرارداد باید اجاره‌نامهٔ مسکونی یا قرارداد کار موقت باشد.",
    })
    .describe("residential_lease = اجاره‌نامهٔ مسکونی; temporary_employment = قرارداد کار موقت"),
  lease: leaseSchema.optional().describe("Fields for residential_lease; omit unknown values"),
  employment: employmentSchema
    .optional()
    .describe("Fields for temporary_employment; omit unknown values"),
});
export type ContractInput = z.output<typeof contractInputSchema>;
type Party = z.output<ReturnType<typeof partySchema>>;

/** One numbered article: a heading and paragraphs or a sub-list. */
interface Article {
  title: string;
  body: string[];
  list?: boolean;
}

function amountPhrase(value: number | undefined): string {
  if (value === undefined) return `مبلغ ${blank("medium")} تومان (به حروف: ${blank("long")} تومان)`;
  return `مبلغ <strong>${faMoney(value)}</strong> (به حروف: ${escapeHtml(numberToPersianWords(value))} تومان)`;
}

function partyPhrase(role: string, party: Party | undefined, representative?: string): string {
  const parts = [`<strong>${escapeHtml(role)}:</strong> ${fill(party?.name, "long")}`];
  if (representative) parts.push(`با نمایندگی ${fill(representative)}`);
  parts.push(
    `به کد یا شناسهٔ ملی ${present(party?.nationalId) ? code(party?.nationalId as string) : blank("medium")}`,
  );
  if (role !== "کارفرما") parts.push(`فرزند ${fill(party?.fatherName, "short")}`);
  parts.push(`به نشانی ${fill(party?.address, "long")}`);
  parts.push(`و تلفن ${present(party?.phone) ? code(party?.phone as string) : blank("medium")}`);
  return `${parts.join("، ")}.`;
}

/** Start, end and duration; fills whichever can be derived and checks they agree. */
function period(input: { startDate?: string; endDate?: string; durationMonths?: number }) {
  const startText = present(input.startDate);
  const endText = present(input.endDate);
  const start = startText ? parseDay(startText, "تاریخ شروع") : undefined;
  let end = endText ? parseDay(endText, "تاریخ پایان") : undefined;
  if (start && !end && input.durationMonths) end = addJalaliMonths(start, input.durationMonths);
  if (start && end && end <= start)
    throw new DocumentError("تاریخ پایان باید بعد از تاریخ شروع باشد. تاریخ‌ها را اصلاح کنید.");
  let duration = input.durationMonths;
  if (!duration && start && end) {
    for (let count = 1; count <= 120; count++)
      if (addJalaliMonths(start, count) === end) {
        duration = count;
        break;
      }
  }
  return {
    start: start ? jalaliDay(start) : undefined,
    end: end ? jalaliDay(end) : undefined,
    duration: duration ? faNumber(duration) : undefined,
  };
}

const yesNo = (value: boolean | undefined) =>
  value === undefined ? blank("short") : value ? "دارد" : "ندارد";

function leaseArticles(lease: z.output<typeof leaseSchema>): Article[] {
  const property = lease.property ?? {};
  const time = period(lease);
  const articles: Article[] = [
    {
      title: "طرفین قرارداد",
      body: [partyPhrase("موجر", lease.landlord), partyPhrase("مستأجر", lease.tenant)],
      list: true,
    },
    {
      title: "موضوع قرارداد",
      body: [
        `موضوع قرارداد عبارت است از اجارهٔ یک واحد مسکونی به نشانی ${fill(property.address, "long")}، کد پستی ${present(property.postalCode) ? code(property.postalCode as string) : blank("medium")}، پلاک ثبتی ${fill(property.deedInfo)}، به مساحت ${property.area ? `<strong>${faNumber(property.area, 2)}</strong>` : blank("short")} متر مربع، دارای ${property.rooms !== undefined ? `<strong>${faNumber(property.rooms)}</strong>` : blank("short")} اتاق خواب، واقع در طبقهٔ ${fill(property.floor, "short")}. پارکینگ: ${yesNo(property.parking)}؛ انباری: ${yesNo(property.storage)}.`,
        `امکانات و لوازمی که همراه مورد اجاره تحویل می‌شود: ${fill(property.amenities, "long")}. وضعیت مورد اجاره هنگام تحویل در صورت‌جلسه‌ای که به امضای طرفین می‌رسد ثبت می‌شود.`,
      ],
    },
    {
      title: "مدت اجاره",
      body: [
        `مدت اجاره ${fill(time.duration, "short")} ماه شمسی، از تاریخ ${fill(time.start)} تا تاریخ ${fill(time.end)} است.`,
      ],
    },
    {
      title: "ودیعه و اجاره‌بها",
      body: [
        lease.deposit === 0
          ? "در این قرارداد ودیعه‌ای پرداخت نمی‌شود."
          : `مستأجر ${amountPhrase(lease.deposit)} را به عنوان ودیعه (رهن) به موجر پرداخت می‌کند و دریافت آن با رسید جداگانه یا در همین قرارداد تأیید می‌شود. موجر متعهد است هنگام تخلیه و تحویل مورد اجاره، ودیعه را پس از کسر بدهی‌های قطعی مستأجر به او بازگرداند.`,
        lease.monthlyRent === 0
          ? "اجاره‌بهای ماهانه‌ای تعیین نشده و قرارداد به صورت رهن کامل است."
          : `اجاره‌بهای ماهانه ${amountPhrase(lease.monthlyRent)} است که مستأجر تا روز ${lease.paymentDay ? `<strong>${faNumber(lease.paymentDay)}</strong>` : blank("short")} هر ماه شمسی به حساب موجر پرداخت می‌کند.`,
      ],
      list: true,
    },
    {
      title: "تعهدات مستأجر",
      body: [
        `مورد اجاره فقط برای سکونت${lease.occupants ? ` حداکثر <strong>${faNumber(lease.occupants)}</strong> نفر` : ""} استفاده می‌شود و تغییر کاربری آن مجاز نیست.`,
        "واگذاری تمام یا بخشی از مورد اجاره به دیگری، بدون اجازهٔ کتبی موجر، مجاز نیست.",
        "هزینه‌های مصرفی آب، برق، گاز، تلفن و شارژ ساختمان در مدت تصرف بر عهدهٔ مستأجر است.",
        "مستأجر در نگهداری مورد اجاره دقت می‌کند، خسارت‌های ناشی از تقصیر خود را جبران می‌کند و بدون اجازهٔ کتبی موجر تغییری در ساختمان و تأسیسات آن نمی‌دهد.",
      ],
      list: true,
    },
    {
      title: "تعهدات موجر",
      body: [
        "موجر مورد اجاره را در تاریخ شروع قرارداد، قابل سکونت و با امکانات ذکرشده، به مستأجر تحویل می‌دهد.",
        "تعمیرات اساسی و هزینه‌های مربوط به اصل ملک و تأسیسات اصلی آن بر عهدهٔ موجر است، مگر آنکه خرابی ناشی از تقصیر مستأجر باشد.",
        "موجر امکان استفادهٔ متعارف و بدون مزاحمت از مورد اجاره را در مدت قرارداد برای مستأجر فراهم می‌کند.",
      ],
      list: true,
    },
    {
      title: "فسخ قرارداد",
      body: [
        "در صورت تخلف هر یک از طرفین از تعهدات این قرارداد، طرف دیگر می‌تواند با رعایت قوانین و مقررات مربوط قرارداد را فسخ کند. در سایر موارد، پایان دادن به قرارداد پیش از پایان مدت به توافق کتبی طرفین نیاز دارد.",
      ],
    },
    {
      title: "تخلیه و تسویه",
      body: [
        "مستأجر در پایان مدت یا پس از فسخ قرارداد، مورد اجاره را تخلیه می‌کند، قبض‌های مصرفی را تا روز تحویل تسویه می‌کند و مورد اجاره را با همان وضعیت تحویل، با در نظر گرفتن استهلاک متعارف، به موجر بازمی‌گرداند. موجر نیز هم‌زمان ودیعه را طبق مادهٔ «ودیعه و اجاره‌بها» بازمی‌گرداند.",
      ],
    },
  ];
  return articles;
}

function employmentArticles(job: z.output<typeof employmentSchema>): Article[] {
  const time = period(job);
  const allowances = job.allowances?.length
    ? ` مزایای ماهانهٔ کارگر عبارت است از: ${job.allowances.map((item) => `${text(item.title)} ${faMoney(item.amount)}`).join("؛ ")}.`
    : "";
  return [
    {
      title: "طرفین قرارداد",
      body: [
        partyPhrase("کارفرما", job.employer, present(job.employerRepresentative)),
        partyPhrase("کارگر", job.employee),
      ],
      list: true,
    },
    {
      title: "موضوع قرارداد و شرح وظایف",
      body: [
        `موضوع قرارداد، اشتغال کارگر در سمت ${fill(job.jobTitle)} است. شرح وظایف: ${fill(job.duties, "long")}.`,
      ],
    },
    {
      title: "محل انجام کار",
      body: [`محل انجام کار: ${fill(job.workplace, "long")}.`],
    },
    {
      title: "مدت قرارداد",
      body: [
        `این قرارداد موقت است و مدت آن ${fill(time.duration, "short")} ماه، از تاریخ ${fill(time.start)} تا تاریخ ${fill(time.end)} است. تمدید قرارداد با توافق کتبی طرفین انجام می‌شود.`,
        ...(job.probationMonths
          ? [
              `دورهٔ آزمایشی ${faNumber(job.probationMonths)} ماه از تاریخ شروع قرارداد است و مدت آن نباید از سقف مقرر در قانون کار بیشتر باشد.`,
            ]
          : []),
      ],
    },
    {
      title: "ساعات کار",
      body: [
        `ساعات کار کارگر ${job.weeklyHours ? `<strong>${faNumber(job.weeklyHours)}</strong>` : blank("short")} ساعت در هفته${present(job.schedule) ? ` (${text(job.schedule as string)})` : ""} است و نباید از حد مقرر در قانون کار بیشتر باشد. کار بیش از این ساعات فقط با توافق طرفین انجام می‌شود و مزد آن به عنوان اضافه‌کاری طبق قانون کار پرداخت می‌شود.`,
      ],
    },
    {
      title: "مزد و مزایا",
      body: [
        `مزد ماهانهٔ کارگر ${amountPhrase(job.monthlyWage)} است.${allowances} مزد و مزایا تا روز ${job.paymentDay ? `<strong>${faNumber(job.paymentDay)}</strong>` : blank("short")} هر ماه شمسی پرداخت می‌شود و نباید از حداقل‌های مصوب شورای عالی کار برای سال جاری کمتر باشد.`,
      ],
    },
    {
      title: "بیمه",
      body: [
        "کارفرما متعهد است کارگر را از آغاز همکاری نزد سازمان تأمین اجتماعی بیمه کند و سهم بیمهٔ کارگر را طبق مقررات از مزد او کسر و همراه با سهم خود پرداخت کند.",
      ],
    },
    {
      title: "مرخصی و تعطیلات",
      body: [
        "کارگر از تعطیلی هفتگی، تعطیلات رسمی و مرخصی استحقاقی و استعلاجی طبق قانون کار برخوردار است.",
      ],
    },
    {
      title: "تعهدات کارگر",
      body: [
        "کارگر وظایف خود را با دقت انجام می‌دهد، مقررات انضباطی و ایمنی کارگاه را رعایت می‌کند و در حفظ اموال و اطلاعات محرمانهٔ کارفرما کوشا است.",
      ],
    },
    {
      title: "پایان قرارداد و تسویه",
      body: [
        "با پایان مدت یا خاتمهٔ قرارداد به یکی از جهات مقرر در قانون کار، کارفرما مطالبات کارگر، از جمله مزد ایام کارکرد، مرخصی استفاده‌نشده، عیدی و پاداش و سایر حقوق قانونی او به نسبت مدت کار را پرداخت می‌کند.",
      ],
    },
    {
      title: "موارد پیش‌بینی‌نشده",
      body: [
        "در مواردی که در این قرارداد پیش‌بینی نشده است، قانون کار و آیین‌نامه‌ها و مقررات مربوط حاکم است.",
      ],
    },
  ];
}

const contractStyle = `<style>
@page { @bottom-center { content: "${CONTRACT_DISCLAIMER}"; font-family: "Vazirmatn", sans-serif; font-size: 8pt; color: #5f686c } }
.article { margin-bottom: 8pt; break-inside: avoid-page }
.article h2 { font-size: 12pt; margin: 0 0 3pt }
.article p { margin: 0 0 4pt }
.article ol { margin: 0 0 4pt; list-style-type: persian; padding-inline-start: 1.6em }
.article li { margin-bottom: 3pt }
</style>`;

/** A validated contract, ready to render. */
export interface Contract {
  template: ContractTemplate;
  title: string;
  html: string;
}

/** Validates raw tool input (Persian errors) and builds the contract HTML fragment. */
export function prepareContract(raw: unknown, options: { now?: Date } = {}): Contract {
  const input = parseInput(contractInputSchema, raw);
  const fields =
    input.template === "residential_lease" ? (input.lease ?? {}) : (input.employment ?? {});
  const signText = present(fields.signDate);
  const signDate = signText ? parseDay(signText, "تاریخ تنظیم") : today(options.now);
  let articles: Article[];
  let heading: string;
  let parties: string[];
  if (input.template === "residential_lease") {
    articles = leaseArticles(input.lease ?? {});
    heading = "اجاره‌نامهٔ مسکونی";
    parties = ["امضای موجر", "امضای مستأجر", "امضای شاهد اول", "امضای شاهد دوم"];
  } else {
    articles = employmentArticles(input.employment ?? {});
    heading = "قرارداد کار موقت";
    parties = ["مهر و امضای کارفرما", "امضای کارگر"];
  }
  if (fields.extraTerms?.length)
    articles.push({ title: "شروط دیگر", body: fields.extraTerms.map(text), list: true });
  const count = articles.length + 1;
  articles.push({
    title: "نسخه‌ها",
    body: [
      `این قرارداد در ${faNumber(count)} ماده و دو نسخه با اعتبار یکسان تنظیم شد و طرفین پس از خواندن و آگاهی کامل از مفاد آن، آن را امضا کردند و هر طرف یک نسخه را دریافت کرد.`,
    ],
  });
  const html = [
    documentStyle,
    contractStyle,
    `<h1 class="doc-title">${escapeHtml(heading)}</h1>`,
    `<div class="doc-meta"><span>تاریخ تنظیم: ${escapeHtml(jalaliDay(signDate))}</span><span>محل تنظیم: ${fill(fields.city)}</span></div>`,
    ...articles.map(
      (article, index) =>
        `<section class="article"><h2>ماده ${faNumber(index + 1)}: ${escapeHtml(article.title)}</h2>${
          article.list
            ? `<ol>${article.body.map((item) => `<li>${item}</li>`).join("")}</ol>`
            : article.body.map((item) => `<p>${item}</p>`).join("")
        }</section>`,
    ),
    signBoxes(parties),
    `<div class="disclaimer">${escapeHtml(CONTRACT_DISCLAIMER)}</div>`,
  ].join("\n");
  const partyName =
    input.template === "residential_lease"
      ? present(input.lease?.tenant?.name)
      : present(input.employment?.employee?.name);
  return {
    template: input.template,
    title: `${heading}${partyName ? ` ${partyName}` : ""}`.slice(0, 150),
    html,
  };
}
