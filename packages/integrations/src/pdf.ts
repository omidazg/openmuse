import {
  componentsToColor,
  degrees,
  drawObject,
  drawRectangle,
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  type PDFField,
  PDFHexString,
  PDFName,
  type PDFObject,
  PDFOptionList,
  type PDFPage,
  PDFRadioGroup,
  PDFString,
  PDFTextField,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  StandardFonts,
  TextAlignment,
} from "pdf-lib";
import { BRAND } from "../../domain/src/brand.ts";
import { escapeHtml, overlayHtml } from "./pdf-html.ts";

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 500;

export class PdfError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "PdfError";
  }
}

async function pdfOperation<T>(operation: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof PdfError) throw error;
    throw new PdfError(fallback);
  }
}

export interface PdfInspection {
  pageCount: number;
  fields: { name: string; value: string; type: "text" | "checkbox" | "unsupported" }[];
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  if (
    !bytes.length ||
    bytes.length > MAX_PDF_BYTES ||
    Buffer.from(bytes.subarray(0, 1024)).indexOf("%PDF-") < 0
  ) {
    throw new PdfError("PDF نامعتبر است: فایل نباید خالی باشد و حجمش باید حداکثر ۱۰ مگابایت باشد");
  }
  try {
    const doc = await PDFDocument.load(new Uint8Array(bytes), {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    if (doc.isEncrypted) throw new PdfError("PDFهای رمزگذاری‌شده پشتیبانی نمی‌شوند");
    if (doc.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)?.has(PDFName.of("XFA"))) {
      throw new PdfError("فرم‌های PDF از نوع XFA پشتیبانی نمی‌شوند");
    }
    if (doc.getPageCount() < 1 || doc.getPageCount() > MAX_PDF_PAGES)
      throw new PdfError("PDF باید بین ۱ تا ۵۰۰ صفحه داشته باشد");
    return doc;
  } catch (error) {
    if (error instanceof PdfError) throw error;
    if (error instanceof Error && /encrypt/i.test(error.message))
      throw new PdfError("PDFهای رمزگذاری‌شده پشتیبانی نمی‌شوند");
    throw new PdfError("PDF نامعتبر یا خراب است");
  }
}

function inspectField(field: PDFField): PdfInspection["fields"][number] {
  const name = field.getName();
  if (field instanceof PDFTextField) {
    const value = field.acroField.dict.lookup(PDFName.of("V"));
    if (value !== undefined && !(value instanceof PDFString) && !(value instanceof PDFHexString)) {
      throw new PdfError("بررسی PDF ممکن نشد: یکی از فیلدهای متنی مقدار خراب دارد");
    }
    return { name, value: field.getText() ?? "", type: "text" };
  }
  if (field instanceof PDFCheckBox)
    return { name, value: String(field.isChecked()), type: "checkbox" };
  const value =
    field instanceof PDFDropdown || field instanceof PDFOptionList
      ? field.getSelected().join(", ")
      : field instanceof PDFRadioGroup
        ? (field.getSelected() ?? "")
        : "";
  return { name, value, type: "unsupported" };
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  return pdfOperation(async () => {
    const doc = await loadPdf(bytes);
    return { pageCount: doc.getPageCount(), fields: doc.getForm().getFields().map(inspectField) };
  }, "بررسی PDF ممکن نشد: سند فیلدهای خراب یا پشتیبانی‌نشده دارد");
}

/** Strip action entry points in the new output; never execute PDF scripts. */
function removeActions(doc: PDFDocument): void {
  const visited = new Set<PDFObject>();
  const visit = (object: PDFObject): void => {
    if (visited.has(object)) return;
    visited.add(object);
    if (object instanceof PDFDict) {
      for (const key of ["OpenAction", "AA", "A", "JS", "JavaScript"])
        object.delete(PDFName.of(key));
      for (const value of object.values()) visit(value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) visit(value);
    }
  };
  for (const [, object] of doc.context.enumerateIndirectObjects()) visit(object);
}

/** Renders an HTML fragment to PDF bytes (the browser worker's Chromium). */
export type RenderHtml = (html: string) => Promise<Uint8Array>;

function fieldFontSize(field: PDFTextField, height: number, multiline: boolean): number {
  const size = Number(
    /(\d+(?:\.\d+)?)\s+Tf/.exec(field.acroField.getDefaultAppearance() ?? "")?.[1],
  );
  if (size > 0) return size;
  return multiline ? 10 : Math.max(6, Math.min(12, height * 0.6));
}

/**
 * Write Persian (non-WinAnsi) text field values as appearance streams rendered by Chromium:
 * pdf-lib cannot shape Arabic-script text. The field value (/V) is still stored as Unicode.
 */
async function overlayTextFields(
  doc: PDFDocument,
  entries: { field: PDFTextField; value: string }[],
  render: RenderHtml,
): Promise<void> {
  const boxes = entries.flatMap(({ field, value }) =>
    field.acroField.getWidgets().map((widget) => {
      const rect = widget.getRectangle();
      const multiline = field.isMultiline();
      return {
        field,
        value,
        widget,
        width: Math.max(1, Math.abs(rect.width)),
        height: Math.max(1, Math.abs(rect.height)),
        multiline,
        fontSize: fieldFontSize(field, Math.abs(rect.height), multiline),
      };
    }),
  );
  if (!boxes.length) return;
  const { html } = overlayHtml(
    boxes.map((box) => ({
      width: box.width,
      height: box.height,
      text: box.value,
      fontSize: box.fontSize,
      multiline: box.multiline,
    })),
  );
  let rendered: PDFDocument;
  try {
    rendered = await PDFDocument.load(await render(html));
  } catch (error) {
    if (error instanceof PdfError) throw error;
    throw new PdfError(
      "نوشتن متن فارسی در فرم ممکن نشد: سرویس ساخت PDF پاسخ نداد. کمی بعد دوباره تلاش کنید.",
    );
  }
  if (rendered.getPageCount() < boxes.length)
    throw new PdfError("نوشتن متن فارسی در فرم ممکن نشد: خروجی سرویس ساخت PDF ناقص است.");
  for (const [index, box] of boxes.entries()) {
    const page = rendered.getPage(index);
    const top = page.getHeight();
    const embedded = await doc.embedPage(page, {
      left: 0,
      bottom: top - box.height,
      right: box.width,
      top,
    });
    // Keep the widget's own background and border, as pdf-lib draws them for Latin values.
    const characteristics = box.widget.getAppearanceCharacteristics();
    const borderColor = componentsToColor(characteristics?.getBorderColor());
    const background = componentsToColor(characteristics?.getBackgroundColor());
    const borderWidth = borderColor ? (box.widget.getBorderStyle()?.getWidth() ?? 1) : 0;
    const frame =
      borderColor || background
        ? drawRectangle({
            x: borderWidth / 2,
            y: borderWidth / 2,
            width: box.width - borderWidth,
            height: box.height - borderWidth,
            borderWidth,
            color: background,
            borderColor,
            rotate: degrees(0),
            xSkew: degrees(0),
            ySkew: degrees(0),
          })
        : [];
    // The embedded page's own /Matrix already moves its bounding box to the origin.
    const appearance = doc.context.formXObject(
      [...frame, pushGraphicsState(), drawObject("Fa0"), popGraphicsState()],
      {
        BBox: [0, 0, box.width, box.height],
        Resources: { XObject: { Fa0: embedded.ref } },
      },
    );
    box.widget.setNormalAppearance(doc.context.register(appearance));
  }
  for (const { field, value } of entries) field.acroField.setValue(PDFHexString.fromText(value));
}

export async function fillPdf(
  bytes: Uint8Array,
  values: Record<string, string | boolean>,
  options: { renderHtml?: RenderHtml } = {},
): Promise<Uint8Array> {
  return pdfOperation(async () => {
    const doc = await loadPdf(bytes);
    const form = doc.getForm();
    const fields = new Map(form.getFields().map((field) => [field.getName(), field]));
    const helvetica = await doc.embedFont(StandardFonts.Helvetica);
    const latin = (text: string) => {
      try {
        helvetica.encodeText(text);
        return true;
      } catch {
        return false;
      }
    };
    const persian: { field: PDFTextField; value: string }[] = [];
    for (const [name, value] of Object.entries(values)) {
      const field = fields.get(name);
      if (!field) throw new PdfError(`فیلد PDF ناشناخته است: ${name}`);
      if (field instanceof PDFTextField) {
        if (typeof value !== "string") throw new PdfError(`فیلد متنی PDF فقط متن می‌پذیرد: ${name}`);
        if (value.length > 10000)
          throw new PdfError(`مقدار فیلد متنی PDF خیلی طولانی است: ${name}`);
        if (latin(value)) field.setText(value);
        else if (options.renderHtml) persian.push({ field, value });
        else
          throw new PdfError(
            `نوشتن متن فارسی در فیلد «${name}» ممکن نشد: سرویس ساخت PDF فارسی (سرویس مرورگر) روی سرور فعال نیست. آن را راه‌اندازی کنید یا این فیلد را با حروف لاتین پر کنید.`,
          );
      } else if (field instanceof PDFCheckBox) {
        if (typeof value !== "boolean")
          throw new PdfError(`چک‌باکس PDF فقط مقدار درست/نادرست (boolean) می‌پذیرد: ${name}`);
        if (value) field.check();
        else field.uncheck();
      } else {
        throw new PdfError(`این فیلد PDF پشتیبانی نمی‌شود: ${name}`);
      }
    }
    if (options.renderHtml && persian.length)
      await overlayTextFields(doc, persian, options.renderHtml);
    removeActions(doc);
    try {
      form.updateFieldAppearances(helvetica);
      return await doc.save();
    } catch {
      throw new PdfError(
        "نوشتن مقدارها در PDF ممکن نشد: فونت این فرم از نویسه‌های واردشده پشتیبانی نمی‌کند. فرم PDF دیگری انتخاب کنید یا مقدارها را کوتاه‌تر بنویسید.",
      );
    }
  }, "تکمیل PDF ممکن نشد: سند فیلدهای خراب یا پشتیبانی‌نشده دارد");
}

/** Persian labels of the sample form, laid out in PDF points on a 612×792 page. */
function samplePageHtml(): string {
  const box = (top: number, size: number, text: string, extra = "") =>
    `<div class="t" style="top:${top}pt;font-size:${size}pt;${extra}">${escapeHtml(text)}</div>`;
  // Convert a pdf-lib baseline (origin bottom-left) to a CSS top for a line of this size.
  const at = (baseline: number, size: number) => 792 - baseline - size * 1.15;
  const chrome = (title: string, page: string) =>
    [
      '<div class="band"></div>',
      box(at(750, 10), 10, `${BRAND.nameFa} · اردوی فرهنگی`, "color:#2e6666;font-weight:700"),
      box(at(710, 28), 28, title, "font-weight:700"),
      '<div class="rule"></div>',
      box(at(35, 9), 9, "فرم نمونه؛ شرکت‌کننده یا سازمان واقعی ندارد", "color:#2e6666"),
      box(at(35, 9), 9, page, "color:#2e6666;text-align:end"),
    ].join("");
  const label = (fieldY: number, text: string, multiline = false) =>
    box(at(fieldY + (multiline ? 72 : 40), 11), 11, text, "font-weight:700");
  const first = [
    chrome("اردوی فرهنگی", "صفحهٔ ۱ از ۲"),
    box(at(640, 16), 16, "یک روز کشف و یادگیری در موزهٔ محله", "font-weight:700"),
    ...[
      "هر دو صفحهٔ این اجازه‌نامه را تکمیل کنید.",
      "اردو، سازمان و برنامهٔ زیر همگی ساختگی هستند.",
      "زمان: شنبه ۱۸ مهر ۱۴۰۵، ساعت ۱۰ تا ۱۴",
      "برنامه‌ها: بازدید با راهنما، کارگاه طراحی و وقت ناهار.",
      "همراه داشته باشید: ناهار، آب و کفش راحت.",
    ].map((line, index) => box(at(606 - index * 25, 11), 11, line)),
    label(395, "نام شرکت‌کننده"),
    label(305, "نام پدر، مادر یا سرپرست (در صورت نیاز)"),
    box(at(210, 11), 11, "برای تماس اضطراری و ثبت اجازه به صفحهٔ ۲ بروید.", "color:#2e6666"),
  ];
  const second = [
    chrome("اجازه‌نامه و تماس‌ها", "صفحهٔ ۲ از ۲"),
    label(580, "نام تماس اضطراری"),
    label(490, "تلفن تماس اضطراری"),
    label(375, "توضیحات بیشتر (اختیاری)", true),
    box(
      at(295, 11),
      11,
      "اجازه می‌دهم شرکت‌کننده در این اردو حضور داشته باشد.",
      "inset-inline-start:78pt;width:486pt",
    ),
    box(at(235, 10), 10, "این گزینه فقط اجازه را ثبت می‌کند و امضای دیجیتال نیست.", "color:#2e6666"),
  ];
  return `<style>@page { size: 612pt 792pt; margin: 0 }
body { margin: 0 }
.page { position: relative; width: 612pt; height: 792pt; overflow: hidden; break-after: page; color: #1f3033 }
.page:last-child { break-after: auto }
.band { position: absolute; top: 0; inset-inline: 0; height: 110pt; background: #e6f2ed }
.rule { position: absolute; top: 736pt; inset-inline: 48pt; border-top: 1pt solid #ccd9d4 }
.t { position: absolute; inset-inline-start: 48pt; width: 516pt; line-height: 1.4; white-space: nowrap }</style>
<div class="page">${first.join("")}</div><div class="page">${second.join("")}</div>`;
}

/** Same form as the English fixture, with Persian labels drawn by Chromium. */
async function createPersianSamplePdf(render: RenderHtml): Promise<Uint8Array> {
  const background = await PDFDocument.load(await render(samplePageHtml()));
  if (background.getPageCount() < 2) throw new PdfError("پس‌زمینهٔ فرم نمونه ناقص است");
  const doc = await PDFDocument.create();
  doc.setTitle("اجازه‌نامهٔ اردوی فرهنگی");
  doc.setAuthor(BRAND.name);
  doc.setLanguage("fa-IR");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  const pages: PDFPage[] = [];
  for (const index of [0, 1]) {
    const page = doc.addPage([612, 792]);
    page.drawPage(await doc.embedPage(background.getPage(index)), {
      x: 0,
      y: 0,
      width: 612,
      height: 792,
    });
    pages.push(page);
  }
  const addText = (page: PDFPage, name: string, y: number, multiline = false) => {
    const field = form.createTextField(name);
    if (multiline) field.enableMultiline();
    field.setAlignment(TextAlignment.Right);
    field.addToPage(page, {
      x: 48,
      y,
      width: 516,
      height: multiline ? 62 : 30,
      borderWidth: 1,
      borderColor: rgb(0.65, 0.75, 0.71),
      backgroundColor: rgb(1, 1, 1),
      font: regular,
    });
    field.setFontSize(12);
  };
  addText(pages[0], "participant_name", 395);
  addText(pages[0], "guardian_name", 305);
  addText(pages[1], "emergency_contact", 580);
  addText(pages[1], "emergency_phone", 490);
  addText(pages[1], "additional_notes", 375, true);
  const permission = form.createCheckBox("permission_granted");
  permission.addToPage(pages[1], {
    x: 546,
    y: 290,
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: rgb(0.18, 0.4, 0.4),
  });
  form.updateFieldAppearances(regular);
  return doc.save();
}

/**
 * Original synthetic fixture. Personal details remain blank until explicitly supplied.
 * With a renderer the labels are Persian; without one (or if it fails) the English
 * pdf-lib version is produced so the sample always exists.
 */
export async function createSamplePdf(
  options: { renderHtml?: RenderHtml } = {},
): Promise<Uint8Array> {
  const render = options.renderHtml;
  if (render) {
    try {
      return await createPersianSamplePdf(render);
    } catch {
      /* Fall back to the Latin-only fixture below. */
    }
  }
  return pdfOperation(async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Community visit - permission form");
    doc.setAuthor(BRAND.name);
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const ink = rgb(0.12, 0.19, 0.2);
    const teal = rgb(0.18, 0.4, 0.4);
    const form = doc.getForm();
    const pages = [doc.addPage([612, 792]), doc.addPage([612, 792])];
    for (const [index, page] of pages.entries()) {
      page.drawRectangle({ x: 0, y: 682, width: 612, height: 110, color: rgb(0.9, 0.95, 0.93) });
      page.drawText(`${BRAND.name.toUpperCase()} / COMMUNITY VISIT`, {
        x: 48,
        y: 750,
        size: 10,
        font: bold,
        color: teal,
      });
      page.drawText(index === 0 ? "Community visit" : "Permission & contacts", {
        x: 48,
        y: 710,
        size: 28,
        font: bold,
        color: ink,
      });
      page.drawLine({
        start: { x: 48, y: 55 },
        end: { x: 564, y: 55 },
        color: rgb(0.8, 0.85, 0.83),
        thickness: 1,
      });
      page.drawText("EXAMPLE FORM - no real participant or organization", {
        x: 48,
        y: 35,
        size: 9,
        font: regular,
        color: teal,
      });
      page.drawText(`${index + 1} / 2`, { x: 535, y: 35, size: 9, font: regular, color: teal });
    }
    const first = pages[0];
    const second = pages[1];
    first.drawText("A day of discovery at the community museum", {
      x: 48,
      y: 640,
      size: 16,
      font: bold,
      color: ink,
    });
    const details = [
      "Please complete both pages of this permission form.",
      "The visit, organization, and schedule below are fictional.",
      "Schedule: Saturday, October 10, 2026 / 10:00-14:00",
      "Activities: guided exhibits, a sketching workshop, and a lunch break.",
      "Bring: a packed lunch, water, and comfortable shoes.",
    ];
    details.forEach((line, index) => {
      first.drawText(line, { x: 48, y: 606 - index * 25, size: 11, font: regular, color: ink });
    });
    const addText = (
      page: typeof first,
      name: string,
      label: string,
      y: number,
      multiline = false,
    ) => {
      page.drawText(label, {
        x: 48,
        y: y + (multiline ? 72 : 40),
        size: 11,
        font: bold,
        color: ink,
      });
      const field = form.createTextField(name);
      if (multiline) field.enableMultiline();
      field.addToPage(page, {
        x: 48,
        y,
        width: 516,
        height: multiline ? 62 : 30,
        borderWidth: 1,
        borderColor: rgb(0.65, 0.75, 0.71),
        backgroundColor: rgb(1, 1, 1),
        font: regular,
      });
      field.setFontSize(12);
    };
    addText(first, "participant_name", "Participant name", 395);
    addText(first, "guardian_name", "Parent or guardian name (if applicable)", 305);
    first.drawText("Continue to page 2 for emergency contacts and permission.", {
      x: 48,
      y: 210,
      size: 11,
      font: regular,
      color: teal,
    });
    addText(second, "emergency_contact", "Emergency contact name", 580);
    addText(second, "emergency_phone", "Emergency contact phone", 490);
    addText(second, "additional_notes", "Additional notes (optional)", 375, true);
    const permission = form.createCheckBox("permission_granted");
    permission.addToPage(second, {
      x: 48,
      y: 290,
      width: 18,
      height: 18,
      borderWidth: 1,
      borderColor: teal,
    });
    second.drawText("I give permission for the participant to attend the community visit.", {
      x: 78,
      y: 295,
      size: 11,
      font: regular,
      color: ink,
    });
    second.drawText("This checkbox records permission; it is not a digital signature.", {
      x: 48,
      y: 235,
      size: 10,
      font: regular,
      color: teal,
    });
    form.updateFieldAppearances(regular);
    return doc.save();
  }, "ساخت PDF نمونه ممکن نشد");
}
