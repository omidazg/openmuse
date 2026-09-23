import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { BRAND } from "../../../packages/domain/src/brand.ts";

type Fetch = (request: Request, ...rest: never[]) => Response | Promise<Response>;

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

function isFile(path: string) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Serves the exported Expo web app (WEB_DIST) next to the API when that directory exists.
 * `/api/*` and `/s/*` are always passed through to the API; unknown extension-less paths fall back to
 * index.html so client-side routes keep working.
 */
export function withStaticWeb<F extends Fetch>(fetch: F, dir = process.env.WEB_DIST): F {
  if (!dir) return fetch;
  const root = resolve(dir);
  const index = join(root, "index.html");
  if (!isFile(index)) {
    console.warn(`[${BRAND.name}] WEB_DIST=${dir} has no index.html; web app is not served`);
    return fetch;
  }
  const serve = async (path: string, status = 200, immutable = false) => {
    const headers = new Headers({
      "Content-Type": types[extname(path).toLowerCase()] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    if (path === index) headers.set("X-Frame-Options", "DENY");
    return new Response(new Uint8Array(await readFile(path)), { status, headers });
  };
  const wrapped = (async (request: Request, ...rest: never[]) => {
    const url = new URL(request.url);
    const method = request.method;
    if (
      (method !== "GET" && method !== "HEAD") ||
      url.pathname === "/api" ||
      url.pathname.startsWith("/api/") ||
      // Public read-only share pages are rendered by the API.
      url.pathname.startsWith("/s/")
    )
      return fetch(request, ...rest);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const target = resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(root + sep))
      return new Response("Not found", { status: 404 });
    if (target !== root && isFile(target))
      return serve(target, 200, pathname.startsWith("/_expo/static/"));
    // Missing asset (has an extension) -> 404; anything else is an SPA route.
    if (extname(pathname)) return new Response("Not found", { status: 404 });
    return serve(index);
  }) as F;
  return wrapped;
}
