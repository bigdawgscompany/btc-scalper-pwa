import {
  FIXED_INSTRUMENT,
  FIXED_INTERVAL,
  QuoteResponseSchema,
  type Candle,
  type QuoteResponse,
} from "../contracts";
import { validateSingleCandle, validateCandleSeries } from "./validation";
import {
  ProviderUnavailableError,
  RateLimitError,
  TimeoutError,
} from "./errors";

// ─── Spec-compliant provider transport (§4) ─────────────────────────────
// Binance ONLY. data-api.binance.vision first, api.binance.com second.
// No silent exchange/instrument changes, no third-party fallbacks.

const BINANCE_CANDLE_ENDPOINTS = [
  "https://data-api.binance.vision/api/v3/klines",
  "https://api.binance.com/api/v3/klines",
];

const BINANCE_QUOTE_ENDPOINTS = [
  "https://data-api.binance.vision/api/v3/ticker/bookTicker",
  "https://api.binance.com/api/v3/ticker/bookTicker",
];

const DEADLINE_MS = 4000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8 MB response-size cap
const RATE_LIMIT_COOLDOWN_MS = 1000; // bounded 429 cooldown
const MAX_ATTEMPTS = 2;

type CachedCandleData = {
  candles: Candle[];
  source: string;
  observationTime: number;
};

let candleCache: CachedCandleData | null = null;
let inflightCandlePromise: Promise<CachedCandleData> | null = null;
const CACHE_TTL_MS = 15_000; // 15s validated-candle cache

/**
 * Sleep helper for bounded cooldowns.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch JSON with a hard deadline covering BOTH the response headers AND
 * the body read (prevents hanging bodies from bypassing the deadline).
 * Enforces a response-size cap and bounded 429 cooldown.
 */
async function fetchJsonWithDeadline(
  url: string,
  deadlineMs = DEADLINE_MS
): Promise<unknown> {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "BTC-Scalper-Terminal/2.0",
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (res.status === 429) {
      throw new RateLimitError("Binance rate limit hit");
    }
    if (!res.ok) {
      throw new ProviderUnavailableError(`HTTP ${res.status} from ${url}`);
    }

    // Best-effort size check via Content-Length header
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
      throw new ProviderUnavailableError(`Response too large from ${url}`);
    }

    // Read body within the remaining deadline (covers hanging bodies)
    const elapsed = Date.now() - start;
    const remaining = Math.max(1, deadlineMs - elapsed);
    const text = await Promise.race([
      res.text(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new TimeoutError("Body read timed out")), remaining)
      ),
    ]);

    // Enforce decoded size cap
    if (text.length * 2 > MAX_RESPONSE_BYTES) {
      throw new ProviderUnavailableError("Response exceeded maximum allowed size");
    }

    return JSON.parse(text);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TimeoutError(`Request to ${url} timed out after ${deadlineMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch and validate 15m candles from Binance (exactly 2 attempts, no fallover
 * to other exchanges). Freezes observation time at fetch for boundary-race
 * protection.
 */
async function fetchRawBinanceCandles(limit = 1000): Promise<{
  candles: Candle[];
  source: string;
  observationTime: number;
}> {
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const endpoint = BINANCE_CANDLE_ENDPOINTS[attempt];
    try {
      const url = `${endpoint}?symbol=${FIXED_INSTRUMENT}&interval=${FIXED_INTERVAL}&limit=${limit}`;
      const raw = await fetchJsonWithDeadline(url, DEADLINE_MS);

      if (!Array.isArray(raw) || raw.length === 0) {
        throw new ProviderUnavailableError(`Empty candle data from ${endpoint}`);
      }

      // Freeze observation time immediately after successful fetch
      const observationTime = Date.now();

      const parsed: Candle[] = raw.map((k: (string | number)[]) =>
        validateSingleCandle(
          Number(k[0]),
          parseFloat(String(k[1])),
          parseFloat(String(k[2])),
          parseFloat(String(k[3])),
          parseFloat(String(k[4])),
          parseFloat(String(k[5])),
          Number(k[6])
        )
      );

      const { allCandles } = validateCandleSeries(parsed, observationTime);
      return { candles: allCandles, source: "Binance", observationTime };
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err : new Error(String(err));

      // Bounded cooldown on 429 before next attempt
      if (err instanceof RateLimitError && attempt < MAX_ATTEMPTS - 1) {
        await sleep(RATE_LIMIT_COOLDOWN_MS);
      }
    }
  }

  throw lastErr ?? new ProviderUnavailableError("All Binance candle endpoints failed.");
}

/**
 * Fetch candles with 15s in-memory caching and request coalescing.
 * Only validated candles are cached.
 */
export async function getMarketCandles(
  limit = 1000,
  forceFresh = false
): Promise<{ candles: Candle[]; source: string; observationTime: number }> {
  const now = Date.now();

  if (!forceFresh && candleCache && now - candleCache.observationTime < CACHE_TTL_MS) {
    return {
      candles: candleCache.candles,
      source: candleCache.source,
      observationTime: candleCache.observationTime,
    };
  }

  if (inflightCandlePromise) {
    const res = await inflightCandlePromise;
    return {
      candles: res.candles,
      source: res.source,
      observationTime: res.observationTime,
    };
  }

  inflightCandlePromise = (async () => {
    try {
      const { candles, source, observationTime } = await fetchRawBinanceCandles(limit);
      const entry: CachedCandleData = { candles, source, observationTime };
      candleCache = entry;
      return entry;
    } finally {
      inflightCandlePromise = null;
    }
  })();

  const result = await inflightCandlePromise;
  return {
    candles: result.candles,
    source: result.source,
    observationTime: result.observationTime,
  };
}

/**
 * Fetch an uncached, freshly observed executable bid/ask quote.
 * Never cached, newly requested for each evaluation.
 */
export async function getExecutableQuote(): Promise<QuoteResponse> {
  const requestStartTimestamp = Date.now();
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const endpoint = BINANCE_QUOTE_ENDPOINTS[attempt];
    try {
      const url = `${endpoint}?symbol=${FIXED_INSTRUMENT}`;
      const raw = await fetchJsonWithDeadline(url, DEADLINE_MS);

      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new ProviderUnavailableError("Invalid quote payload from provider.");
      }
      const data = raw as Record<string, unknown>;
      const bid = Number(data.bidPrice);
      const ask = Number(data.askPrice);
      const bidQty = Number(data.bidQty);
      const askQty = Number(data.askQty);

      if (
        !Number.isFinite(bid) ||
        !Number.isFinite(ask) ||
        bid <= 0 ||
        ask <= 0 ||
        ask < bid
      ) {
        throw new ProviderUnavailableError("Invalid bid/ask spread received from provider.");
      }

      const serverObservationTimestamp = Date.now();
      return QuoteResponseSchema.parse({
        schemaVersion: 2,
        instrument: FIXED_INSTRUMENT,
        provider: "Binance",
        bid,
        ask,
        bidQty: Number.isFinite(bidQty) && bidQty >= 0 ? bidQty : 0,
        askQty: Number.isFinite(askQty) && askQty >= 0 ? askQty : 0,
        spread: ask - bid,
        requestStartTimestamp,
        serverObservationTimestamp,
      });
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err : new Error(String(err));

      if (err instanceof RateLimitError && attempt < MAX_ATTEMPTS - 1) {
        await sleep(RATE_LIMIT_COOLDOWN_MS);
      }
    }
  }

  throw lastErr ?? new ProviderUnavailableError("All Binance quote endpoints failed.");
}