#!/usr/bin/env node
/**
 * Renders the app icons, splash and PWA icons from assets/brand/logo-mark.svg (the
 * source of truth) and rewrites assets/brand/logo.svg and public/favicon.svg. Run from
 * apps/mobile after changing the mark; outputs are committed, so builds never run this:
 *
 *   npm i --prefix <tmp> @resvg/resvg-js@2
 *   RESVG_MODULE=<tmp>/node_modules/@resvg/resvg-js/index.js node scripts/generate-icons.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { Resvg } = await import(
  process.env.RESVG_MODULE ? pathToFileURL(process.env.RESVG_MODULE).href : "@resvg/resvg-js"
);

/** Brand tile gradient, shared with the landing page (src/landing.tsx). */
const TILE = ["#4AA6F0", "#1463B8"];

const markSvg = readFileSync(join(root, "assets/brand/logo-mark.svg"), "utf8");
const defs = markSvg.match(/<defs>([\s\S]*?)<\/defs>/)?.[1] ?? "";
const mark = markSvg.match(/<g id="mark">([\s\S]*?)<\/g>/)?.[1];
if (!mark) throw new Error('logo-mark.svg must contain <g id="mark">');

const tileDef = `<linearGradient id="tile" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${TILE[0]}"/><stop offset="1" stop-color="${TILE[1]}"/></linearGradient>`;

/**
 * @param {object} o
 * @param {"none"|"square"|"rounded"} o.tile background
 * @param {number} o.scale mark scale around the canvas center
 * @param {number} [o.logoScale] shrink the whole composition (padding, for splash)
 */
function compose({ tile, scale, logoScale = 1 }) {
  const t = (1 - scale) * 512;
  const bg =
    tile === "none"
      ? ""
      : `<rect width="1024" height="1024" rx="${tile === "rounded" ? 232 : 0}" fill="url(#tile)"/>`;
  const inner = `${bg}<g transform="translate(${t} ${t + 30 * scale}) scale(${scale})">${mark}</g>`;
  const l = (1 - logoScale) * 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs>${defs}${tileDef}</defs><g transform="translate(${l} ${l}) scale(${logoScale})">${inner}</g></svg>`;
}

function png(svg, size, out) {
  const data = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  const path = join(root, out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`${out} (${size}px, ${data.length} bytes)`);
}

const full = compose({ tile: "square", scale: 1 });
const rounded = compose({ tile: "rounded", scale: 1 });

// Expo native
png(full, 1024, "assets/icon.png"); // iOS masks corners itself; no transparency allowed
png(compose({ tile: "none", scale: 0.74 }), 1024, "assets/adaptive-icon.png"); // inside the 66% safe zone
png(compose({ tile: "rounded", scale: 1, logoScale: 0.42 }), 1024, "assets/splash-icon.png");
png(rounded, 48, "assets/favicon.png");

// PWA / web (public/ is copied into the web export)
png(rounded, 192, "public/icons/icon-192.png");
png(rounded, 512, "public/icons/icon-512.png");
png(compose({ tile: "square", scale: 0.78 }), 512, "public/icons/maskable-512.png"); // 80% safe zone
png(full, 180, "public/apple-touch-icon.png");
for (const out of ["assets/brand/logo.svg", "public/favicon.svg"]) {
  writeFileSync(join(root, out), `${rounded}\n`);
  console.log(out);
}
