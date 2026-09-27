import { File, Paths } from "expo-file-system";

/**
 * `localStorage` for Android and iOS. The app keeps small per-device state through the web
 * Storage API (session token, profile and preference caches, display settings, hidden cards);
 * phones have no such store, so it lived only in memory and a restart asked for the key again.
 * This keeps the same synchronous API in one JSON file in the app's private document directory.
 * Imported first in index.js, before any module reads it.
 */
const FILE_NAME = "device-storage.json";

function open(): File | undefined {
  try {
    return new File(Paths.document, FILE_NAME);
  } catch {
    return undefined;
  }
}

const file = open();
let items: Record<string, string> = {};
try {
  if (file?.exists) {
    const parsed: unknown = JSON.parse(file.textSync());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      for (const [key, value] of Object.entries(parsed))
        if (typeof value === "string") items[key] = value;
  }
} catch {
  items = {};
}

function persist() {
  try {
    file?.write(JSON.stringify(items));
  } catch {
    // Still works for this launch; the next write tries again.
  }
}

const has = (key: string) => Object.hasOwn(items, key);

const deviceStorage: Storage = {
  get length() {
    return Object.keys(items).length;
  },
  key: (index: number) => Object.keys(items)[index] ?? null,
  getItem: (key: string) => (has(key) ? items[key] : null),
  setItem: (key: string, value: string) => {
    const text = String(value);
    if (items[key] === text) return;
    items[key] = text;
    persist();
  },
  removeItem: (key: string) => {
    if (!has(key)) return;
    delete items[key];
    persist();
  },
  clear: () => {
    items = {};
    persist();
  },
};

if (!(globalThis as { localStorage?: Storage }).localStorage)
  Object.defineProperty(globalThis, "localStorage", {
    value: deviceStorage,
    configurable: true,
    writable: true,
  });
