import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

// This declares the value of `injectionPoint` to TypeScript.
// `injectionPoint` is the string that will be replaced by the actual
// precache manifest. By default, this string is set to
// `"self.__SW_MANIFEST"`.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: WorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false, // Owner-only activation (§7) — do not auto-claim
  clientsClaim: false,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  // Note: API routes (/api/*) are not precached and defaultCache uses
  // NetworkFirst/StaleWhileRevalidate for navigation. Since our API
  // responses carry no-store headers, the browser will not cache them
  // as live data (§7). The shell (HTML, JS, CSS, fonts, icons) is
  // precached for offline startup.
});

serwist.addEventListeners();