# Persian / RTL rules for OpenMuse (قوانین فارسی‌سازی)

This product is for Persian (Farsi) speakers in Iran. Apply these rules to every
file you touch. Based on the VibeFarsi Persian UI guidelines
(https://github.com/TronIsHere/vibafarsiui), adapted to this React Native + Expo
Web codebase.

## Language and register
- All user-facing text is Persian: labels, placeholders, errors, empty states,
  toasts, accessibilityLabel, page titles. Identifiers, props, enum values, API
  payloads, file names and commit messages stay English.
- Register: **formal-but-human** («می‌شود»، «کنید»، «است») everywhere. Never
  mix in conversational forms («میشه»). Never «می‌باشد»، «لازم به ذکر است»،
  «در راستای»، «خواهشمندیم»، «کاربر گرامی».
- Orthography: ZWNJ in compounds (می‌شود، پیام‌ها، جست‌وجو)، Persian ی and ک،
  «گیومه»، «،» «؛» «؟»، no em dashes, no exclamation marks on errors.
- Glossary: Submit → ثبت (forms) / ارسال (messages)، Save → ذخیره، Cancel →
  انصراف (لغو for cancelling a task/order)، Delete → حذف، Edit → ویرایش،
  Retry → تلاش دوباره، Search → جست‌وجو، Settings → تنظیمات، Notifications →
  اعلان‌ها، Loading… → در حال بارگذاری…، Back → بازگشت، Next → بعدی،
  Done → تمام، OK → تأیید، Upload/Download → بارگذاری / دانلود.
- Buttons are one outcome verb, never «کلیک کنید». Destructive actions name the
  object («حذف فایل»).
- Confirmations: the title asks the real question («فایل حذف شود؟»); buttons
  carry the action («حذف» / «انصراف»), not بله/خیر. No «آیا مطمئن هستید؟».
- Empty states say what goes here and what to do next. Errors say what failed
  and what to do («اتصال برقرار نشد. دوباره تلاش کنید.»), never «مشکلی پیش آمد»
  alone. Success toasts are short past tense («ذخیره شد»).

## Direction and layout
- RTL is set once at the root (`applyRtl()` in `apps/mobile/src/locale.ts`).
  Do not set direction per component except for LTR content.
- Logical styles only: `marginStart/End`, `paddingStart/End`, `start/end`,
  `borderStartWidth`, `textAlign: "auto"`. Never `marginLeft`, `left:`,
  `textAlign: "left"` for Persian content.
- `flexDirection: "row"` already flips; never add `row-reverse` to "fix" RTL.
- "Next"/"forward"/"open" chevrons and arrows point **left** (`ChevronLeft`,
  `ArrowLeft`); "back" points right. Non-directional icons stay.
- Keep LTR (`writingDirection: "ltr"`) on: URLs, email addresses, code,
  terminal output, file paths, phone/card/IBAN values.
- Drawers and sheets open from the start (right) edge.

## Typography
- Font: Vazirmatn only (loaded by `useAppFonts()`). Use `fw("600")` instead of
  `fontWeight`; never synthesize bold/italic.
- `letterSpacing` is forbidden on Persian text. No `textTransform: "uppercase"`.
- Body line-height ≈ 1.7–1.9 × fontSize; headings ≥ 1.2; labels/buttons ≈ 1.5.

## Numbers, money, dates
- Visible digits are Persian ۰–۹ (`faNumber`, `faDigits`). Values, URLs,
  API payloads keep Latin digits. Normalize user-typed Persian/Arabic digits with
  `toLatinDigits` before validation.
- Thousands «٬», decimal «٫», percent «٪» after the number.
- Money: unit after the number (`faMoney`): «۱۲٬۰۰۰ تومان». Never «$» or
  «Toman». A real USD amount is written «۱۲ دلار».
- Dates in the UI are Jalali (`faDate`, `faDateTime`, locale
  `fa-IR-u-ca-persian`), 24-hour time, week starts Saturday, time zone
  `Asia/Tehran` (+03:30, no DST). Storage and APIs stay UTC ISO 8601.
- Relative time in Persian: «همین حالا»، «۲ ساعت پیش»، «دیروز».

## Before you finish
- Grep your diff for `marginLeft|marginRight|paddingLeft|paddingRight|left:|right:|textAlign: "left"|letterSpacing|uppercase|ChevronRight`.
- Every visible number Persian, every date Jalali, every string Persian.
- Read each new string aloud: would an Iranian product ship it?
