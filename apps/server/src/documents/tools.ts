import { defineTool } from "@copilotkit/runtime/v2";
import type { Files } from "../files.ts";
import { CONTRACT_TEMPLATES, contractInputSchema, prepareContract } from "./contracts.ts";
import {
  DEFAULT_VAT_PERCENT,
  invoiceHtml,
  invoiceInputSchema,
  invoiceTitle,
  prepareInvoice,
} from "./invoice.ts";

/** Chat instructions for the proforma invoice and contract template tools. */
export const templateDocumentInstructions = ` When the user asks for a «پیش‌فاکتور» (proforma invoice, price quote), use create_invoice; when they ask for an «اجاره‌نامه» or «قرارداد اجاره» (residential lease) or a «قرارداد کار» (simple temporary employment contract), use create_contract. Do not write these documents with create_pdf or delegate_task. First collect only the missing essentials in ONE short Persian question (invoice: seller name, buyer name, each item's title, quantity and unit price in Toman, and whether VAT applies; lease: landlord and tenant names, property address, deposit, monthly rent, start date and duration; employment: employer and employee names, job title, monthly wage, start date and duration). If the user already gave them, or says to continue without them, call the tool right away. Never invent names, IDs, amounts or dates: omit unknown fields, and contracts show blank lines to fill in by hand. Amounts are whole Toman; if the user gives Rial, divide by 10 and say so. Dates can be Jalali YYYY-MM-DD (e.g. 1405-07-01). The default VAT rate is ${DEFAULT_VAT_PERCENT} percent and is set yearly by law; say which rate you used. After the tool succeeds, say in one or two sentences that the PDF is saved in «فایل‌ها» under its name and give the payable total for invoices; for contracts add that the text is a sample and they should consult a legal expert before signing. If the tool returns an error, relay it and ask for the fix. Never claim a document was created unless the tool succeeded.`;

type FileCreator = Pick<Files, "createPdf">;
const DEFAULT_SOURCE = "ساخته‌شده توسط دستیار";

/** Validates, renders and saves a proforma invoice PDF; errors are Persian. */
export async function createInvoiceFile(
  files: FileCreator,
  owner: string,
  raw: unknown,
  source = DEFAULT_SOURCE,
) {
  const invoice = prepareInvoice(raw);
  const title = invoiceTitle(invoice);
  const file = await files.createPdf(owner, title, invoiceHtml(invoice), source, title);
  const { subtotal, discount, vatPercent, vat, total } = invoice.totals;
  return {
    id: file.id,
    name: file.name,
    pageCount: file.pageCount,
    number: invoice.number,
    totals: { subtotal, discount, vatPercent, vat, total },
  };
}

/** Validates, renders and saves a contract PDF; errors are Persian. */
export async function createContractFile(
  files: FileCreator,
  owner: string,
  raw: unknown,
  source = DEFAULT_SOURCE,
) {
  const contract = prepareContract(raw);
  const file = await files.createPdf(owner, contract.title, contract.html, source, contract.title);
  return { id: file.id, name: file.name, pageCount: file.pageCount, template: contract.template };
}

/** Validation, total and rendering errors are already Persian (DocumentError, AppError). */
function failure(error: unknown, fallback: string) {
  return { error: error instanceof Error ? error.message : fallback };
}

/**
 * Model tools that render a proforma invoice or a contract template to a Persian PDF in the
 * owner's Files, through the same Files.createPdf path as create_pdf.
 */
export function templateDocumentTools(files: FileCreator, owner: string) {
  const templates = Object.entries(CONTRACT_TEMPLATES)
    .map(([id, label]) => `${id} = «${label}»`)
    .join(", ");
  return [
    defineTool({
      name: "create_invoice",
      description: `Create a Persian proforma invoice («پیش‌فاکتور») PDF in the owner's Files: seller and buyer blocks, numbered items table, subtotal, discount, VAT (${DEFAULT_VAT_PERCENT}% by default when vat is true), payable total, the total in Persian words, notes and signature/stamp boxes. All amounts are whole Toman. Returns the new file ID, name, invoice number and totals, or a Persian error to relay.`,
      parameters: invoiceInputSchema,
      execute: async (args) => {
        try {
          return await createInvoiceFile(files, owner, args);
        } catch (error) {
          return failure(error, "ساخت پیش‌فاکتور ممکن نشد. دوباره تلاش کنید.");
        }
      },
    }),
    defineTool({
      name: "create_contract",
      description: `Create a Persian contract PDF from a template in the owner's Files, with numbered articles in formal contract language, blank lines for anything not provided, signature boxes and a legal disclaimer. Templates: ${templates}. Put the fields in lease or employment to match the template and omit unknown values. Amounts are whole Toman. Returns the new file ID and name, or a Persian error to relay.`,
      parameters: contractInputSchema,
      execute: async (args) => {
        try {
          return await createContractFile(files, owner, args);
        } catch (error) {
          return failure(error, "ساخت قرارداد ممکن نشد. دوباره تلاش کنید.");
        }
      },
    }),
  ];
}
