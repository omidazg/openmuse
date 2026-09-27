/**
 * Persian number-to-words for amounts written on invoices and contracts
 * («مبلغ به حروف»). Integers only, from zero up to 999 trillion.
 */

const ONES = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"];
const TEENS = [
  "ده",
  "یازده",
  "دوازده",
  "سیزده",
  "چهارده",
  "پانزده",
  "شانزده",
  "هفده",
  "هجده",
  "نوزده",
];
const TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
const HUNDREDS = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
const SCALES = ["", "هزار", "میلیون", "میلیارد", "تریلیون"];

/** Largest value with a Persian scale word (just under one quadrillion). */
export const MAX_PERSIAN_WORDS = 999_999_999_999_999;

/** Words for 1–999, parts joined with « و ». */
function belowThousand(value: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds) parts.push(HUNDREDS[hundreds]);
  if (rest >= 10 && rest < 20) parts.push(TEENS[rest - 10]);
  else {
    if (rest >= 20) parts.push(TENS[Math.floor(rest / 10)]);
    if (rest % 10) parts.push(ONES[rest % 10]);
  }
  return parts.join(" و ");
}

/**
 * «یک میلیون و دویست و پنجاه هزار» for 1_250_000. Thousands keep their count
 * («یک هزار»), as on cheques and invoices, so the amount cannot be misread.
 */
export function numberToPersianWords(value: number): string {
  if (!Number.isSafeInteger(value))
    throw new RangeError("برای نوشتن عدد به حروف، یک عدد صحیح لازم است.");
  if (value === 0) return "صفر";
  if (value < 0) return `منفی ${numberToPersianWords(-value)}`;
  if (value > MAX_PERSIAN_WORDS)
    throw new RangeError(
      "عدد برای نوشتن به حروف بیش از حد بزرگ است (حداکثر کمتر از هزار تریلیون).",
    );
  const parts: string[] = [];
  let rest = value;
  for (let scale = 0; rest > 0; scale++) {
    const group = rest % 1000;
    rest = Math.floor(rest / 1000);
    if (group)
      parts.unshift(
        SCALES[scale] ? `${belowThousand(group)} ${SCALES[scale]}` : belowThousand(group),
      );
  }
  return parts.join(" و ");
}
