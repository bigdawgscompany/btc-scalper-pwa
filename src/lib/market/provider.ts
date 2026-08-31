import {
  FIXED_INSTRUMENT,
  FIXED_INTERVAL,
  type Candle,
  type QuoteResponse,
} from "../contracts";
import { validateSingleCandle, validateCandleSeries } from "./validation";
import {
  ProviderUnavailableError,
  RateLimitError,
  TimeoutError,
} from "./errors";

const BINANCE_CANDLE_ENDPOINTS = [
  "https://data-api.binance.vision/api/v3/klines",
  "https://api.binance.com/api/v3/klines",
];

const BINANCE_QUOTE_ENDPOINTS = [
  "https://data-api.binance.vision/api/v3/ticker/bookTicker",
  "https://api.binance.com/api/v3/ticker/bookTicker",
];

// Fallback endpoints for regions with Binance IP restrictions (e.g. US cloud instances)
const FALLBACK_CANDLE_ENDPOINTS = [
  "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900",
  "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=15",
];

const FALLBACK_QUOTE_ENDPOINTS = [
  "https://api.exchange.coinbase.com/products/BTC-USD/ticker",
  "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
];

type CachedCandleData = {
  candles: Candle[];
  source: string;
  timestamp: number;
};

let candleCache: CachedCandleData | null = null;
let inflightCandlePromise: Promise<CachedCandleData> | null = null;
const CACHE_TTL_MS = 15_000; // 15s

async function fetchWithDeadline(
  url: string,
  timeoutMs = 4000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "BTC-Scalper-Terminal/2.0",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    return res;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new TimeoutError(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Fetch and validate 15m candles from Binance (with multi-endpoint failover).
 */
async function fetchRawBinanceCandles(limit = 1000): Promise<{
  candles: Candle[];
  source: string;
}> {
  let lastErr: Error | null = null;

  for (const endpoint of BINANCE_CANDLE_ENDPOINTS) {
    try {
      const url = `${endpoint}?symbol=${FIXED_INSTRUMENT}&interval=${FIXED_INTERVAL}&limit=${limit}`;
      const res = await fetchWithDeadline(url, 4000);

      if (res.status === 429) {
        throw new RateLimitError("Binance rate limit hit");
      }
      if (!res.ok) {
        throw new ProviderUnavailableError(`HTTP ${res.status} from ${endpoint}`);
      }

      const raw = await res.json();
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new ProviderUnavailableError(`Empty candle data from ${endpoint}`);
      }

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

      const observationTime = Date.now();
      const { allCandles } = validateCandleSeries(parsed, observationTime);
      return { candles: allCandles, source: "Binance" };
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  // Graceful fallback to Coinbase / Kraken if Binance is geo-blocked
  for (const fallbackUrl of FALLBACK_CANDLE_ENDPOINTS) {
    try {
      if (fallbackUrl.includes("coinbase")) {
        const res = await fetchWithDeadline(fallbackUrl, 4000);
        if (!res.ok) continue;
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          const sorted = [...data].sort((a, b) => a[0] - b[0]);
          const parsed: Candle[] = sorted.map((k: number[]) =>
            validateSingleCandle(
              k[0] * 1000,
              Number(k[3]),
              Number(k[2]),
              Number(k[1]),
              Number(k[4]),
              Number(k[5]),
              k[0] * 1000 + 15 * 60 * 1000 - 1
            )
          );
          const { allCandles } = validateCandleSeries(parsed, Date.now());
          return { candles: allCandles, source: "Coinbase (Fallback)" };
        }
      }
    } catch {
      // try next
    }
  }

  throw lastErr ?? new ProviderUnavailableError("All candle data providers failed.");
}

/**
 * Fetch candles with 15s in-memory caching and request coalescing.
 */
export async function getMarketCandles(
  limit = 1000,
  forceFresh = false
): Promise<{ candles: Candle[]; source: string; observationTime: number }> {
  const now = Date.now();

  if (!forceFresh && candleCache && now - candleCache.timestamp < CACHE_TTL_MS) {
    return {
      candles: candleCache.candles,
      source: candleCache.source,
      observationTime: candleCache.timestamp,
    };
  }

  if (inflightCandlePromise) {
    const res = await inflightCandlePromise;
    return {
      candles: res.candles,
      source: res.source,
      observationTime: res.timestamp,
    };
  }

  inflightCandlePromise = (async () => {
    try {
      const { candles, source } = await fetchRawBinanceCandles(limit);
      const entry: CachedCandleData = {
        candles,
        source,
        timestamp: Date.now(),
      };
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
    observationTime: result.timestamp,
  };
}

/**
 * Fetch an uncached, freshly observed executable bid/ask quote.
 */
export async function getExecutableQuote(): Promise<QuoteResponse> {
  const requestStartTimestamp = Date.now();
  let lastErr: Error | null = null;

  for (const endpoint of BINANCE_QUOTE_ENDPOINTS) {
    try {
      const url = `${endpoint}?symbol=${FIXED_INSTRUMENT}`;
      const res = await fetchWithDeadline(url, 4000);

      if (res.status === 429) {
        throw new RateLimitError("Binance quote rate limit hit");
      }
      if (!res.ok) {
        throw new ProviderUnavailableError(`HTTP ${res.status} from quote ${endpoint}`);
      }

      const raw = await res.json();
      const bid = parseFloat(raw.bidPrice);
      const ask = parseFloat(raw.askPrice);
      const bidQty = parseFloat(raw.bidQty);
      const askQty = parseFloat(raw.askQty);

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
      return {
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
      };
    } catch (err: unknown) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }

  // Fallback for quotes (e.g. Coinbase)
  for (const fallbackUrl of FALLBACK_QUOTE_ENDPOINTS) {
    try {
      if (fallbackUrl.includes("coinbase")) {
        const res = await fetchWithDeadline(fallbackUrl, 4000);
        if (!res.ok) continue;
        const data = await res.json();
        const bid = parseFloat(data.bid);
        const ask = parseFloat(data.ask);
        // volume not used for quote fallback

        if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid) {
          return {
            schemaVersion: 2,
            instrument: FIXED_INSTRUMENT,
            provider: "Coinbase (Fallback)",
            bid,
            ask,
            bidQty: 1.0,
            askQty: 1.0,
            spread: ask - bid,
            requestStartTimestamp,
            serverObservationTimestamp: Date.now(),
          };
        }
      }
    } catch {
      // try next
    }
  }

  throw lastErr ?? new ProviderUnavailableError("All quote providers failed.");
}
