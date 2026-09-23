import { z } from "zod";

/** Implicit TLS (e.g. 993/465) or a mandatory STARTTLS upgrade (e.g. 143/587). Plaintext is never offered. */
export type MailSecurity = "tls" | "starttls";

export interface MailboxPreset {
  id: string;
  /** Persian display name. */
  name: string;
  imap: { host: string; port: number; security: MailSecurity };
  smtp: { host: string; port: number; security: MailSecurity };
  /** Persian hint shown under the password field. */
  hint: string;
}

export const MAILBOX_PRESETS: readonly MailboxPreset[] = [
  {
    id: "gmail",
    name: "Gmail (گذرواژهٔ برنامه)",
    imap: { host: "imap.gmail.com", port: 993, security: "tls" },
    smtp: { host: "smtp.gmail.com", port: 465, security: "tls" },
    hint: "تأیید دومرحله‌ای را در حساب گوگل روشن کنید و یک «گذرواژهٔ برنامه» بسازید.",
  },
  {
    id: "outlook",
    name: "Outlook / Office 365",
    imap: { host: "outlook.office365.com", port: 993, security: "tls" },
    smtp: { host: "smtp.office365.com", port: 587, security: "starttls" },
    hint: "برای حساب‌های سازمانی، مدیر سرور باید ورود IMAP و SMTP را مجاز کرده باشد.",
  },
  {
    id: "yahoo",
    name: "Yahoo",
    imap: { host: "imap.mail.yahoo.com", port: 993, security: "tls" },
    smtp: { host: "smtp.mail.yahoo.com", port: 465, security: "tls" },
    hint: "در تنظیمات امنیتی یاهو یک «گذرواژهٔ برنامه» بسازید.",
  },
  {
    id: "zoho",
    name: "Zoho",
    imap: { host: "imap.zoho.com", port: 993, security: "tls" },
    smtp: { host: "smtp.zoho.com", port: 465, security: "tls" },
    hint: "دسترسی IMAP را در تنظیمات Zoho Mail فعال کنید.",
  },
  {
    id: "chmail",
    name: "چاپار (chmail.ir)",
    imap: { host: "mail.chmail.ir", port: 993, security: "tls" },
    smtp: { host: "mail.chmail.ir", port: 465, security: "tls" },
    hint: "نشانی سرور را با راهنمای چاپار مطابقت دهید.",
  },
  {
    id: "other",
    name: "سایر",
    imap: { host: "", port: 993, security: "tls" },
    smtp: { host: "", port: 465, security: "tls" },
    hint: "نشانی سرورها را از راهنمای ارائه‌دهندهٔ ایمیل خود بردارید.",
  },
];

const HOST =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const hostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .refine(
    (value) => HOST.test(value) || /^[0-9.]+$|^[0-9a-f:]+$/i.test(value),
    "نشانی سرور نامعتبر است. فقط نام میزبان را بنویسید، مثل imap.example.com",
  );
const portSchema = z.coerce
  .number()
  .int("درگاه باید عدد صحیح باشد")
  .min(1, "درگاه باید بین ۱ و ۶۵۵۳۵ باشد")
  .max(65535, "درگاه باید بین ۱ و ۶۵۵۳۵ باشد");
const securitySchema = z.enum(["tls", "starttls"]);

/** What the Persian form sends to POST /api/mailbox/connect. */
export const mailboxConnectSchema = z.object({
  preset: z.string().max(32).default("other"),
  email: z.email("نشانی ایمیل نامعتبر است").max(254),
  username: z.string().trim().max(254).optional(),
  password: z.string().min(1, "گذرواژهٔ برنامه را وارد کنید").max(512),
  imapHost: hostSchema,
  imapPort: portSchema,
  imapSecurity: securitySchema,
  smtpHost: hostSchema,
  smtpPort: portSchema,
  smtpSecurity: securitySchema,
});
export type MailboxConnectInput = z.infer<typeof mailboxConnectSchema>;
