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
  // Do not runtime-cache application API responses. Live market state must
  // come from the network; only the precached shell may be served offline.
  runtimeCaching: [],
});

serwist.addEventListeners();