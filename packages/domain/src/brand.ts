/**
 * Single source of truth for the product brand. To rename the product, edit
 * `brand.json` next to this file (display strings only) — see docs/REBRAND.md.
 * The JSON is shared with apps/mobile/app.config.ts, which cannot import TS.
 */
import brand from "./brand.json" with { type: "json" };

export interface Brand {
  /** Latin display name (English UI, logs, HTML titles). */
  readonly name: string;
  /** Persian display name used in Persian UI copy. */
  readonly nameFa: string;
  /** Persian tagline. */
  readonly tagline: string;
  readonly taglineEn: string;
  /** Persian mascot name, e.g. used in «کاپیبارای …» alt text. */
  readonly mascotName: string;
  readonly mascotNameEn: string;
  /** MIT attribution that must survive any rebrand. */
  readonly attribution: string;
  /**
   * Technical identifiers. Changing these breaks existing installs, deep links and
   * store listings; they are intentionally NOT renamed with the display name.
   */
  readonly technical: {
    readonly slug: string;
    readonly scheme: string;
    readonly iosBundleIdentifier: string;
    readonly androidPackage: string;
  };
}

export const BRAND: Brand = brand;
