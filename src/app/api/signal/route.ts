import { NextResponse } from "next/server";
import { computeSignal } from "@/lib/signals";
import type { Candle } from "@/lib/types";

type MarketSourceResult = {
  candles: Candle[];
  sourceName: string;
};

// 1. Coinbase Pro (Granularity: 900s = 15m)
async function fetchCoinbase(): Promise<MarketSourceResult> {
  const url =
    "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900";
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BTCScalperPWA/1.0)",
      Accept: "application/json",
    },
    next: { revalidate: 15 },
    signal: AbortSignal.timeout(6000),
  });

  if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length < 35) {
    throw new Error("Coinbase invalid candles data");
  }

  // Coinbase candles format: [ time, low, high, open, close, volume ]
  // Newest first -> sort ascending
  const sorted = [...data].sort((a, b) => a[0] - b[0]);
  const candles: Candle[] = sorted.map((k: number[]) => {
    const openTime = k[0] * 1000;
    const closeTime = openTime + 15 * 60 * 1000 - 1;
    return {
      openTime,
      open: Number(k[3]),
      high: Number(k[2]),
      low: Number(k[1]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime,
    };
  });

  return { candles, sourceName: "Coinbase" };
}

// 2. Kraken (Interval: 15m)
async function fetchKraken(): Promise<MarketSourceResult> {
  const url = "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=15";
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BTCScalperPWA/1.0)",
      Accept: "application/json",
    },
    next: { revalidate: 15 },
    signal: AbortSignal.timeout(6000),
  });

  if (!res.ok) throw new Error(`Kraken HTTP ${res.status}`);
  const json = await res.json();
  const rawList = json?.result?.XXBTZUSD || json?.result?.XBTUSD;
  if (!Array.isArray(rawList) || rawList.length < 35) {
    throw new Error("Kraken invalid candles data");
  }

  const slice = rawList.slice(-100);
  const candles: Candle[] = slice.map((k: (string | number)[]) => {
    const openTime = Number(k[0]) * 1000;
    const closeTime = openTime + 15 * 60 * 1000 - 1;
    return {
      openTime,
      open: parseFloat(String(k[1])),
      high: parseFloat(String(k[2])),
      low: parseFloat(String(k[3])),
      close: parseFloat(String(k[4])),
      volume: parseFloat(String(k[6])),
      closeTime,
    };
  });

  return { candles, sourceName: "Kraken" };
}

// 3. Binance Public & Vision Endpoints (fallback for non-restricted regions)
async function fetchBinance(): Promise<MarketSourceResult> {
  const binanceUrls = [
    "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=100",
    "https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=100",
    "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=100",
  ];

  for (const url of binanceUrls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; BTCScalperPWA/1.0)",
          Accept: "application/json",
        },
        next: { revalidate: 15 },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length >= 35) {
        const candles: Candle[] = data.map((k: (string | number)[]) => ({
          openTime: Number(k[0]),
          open: parseFloat(String(k[1])),
          high: parseFloat(String(k[2])),
          low: parseFloat(String(k[3])),
          close: parseFloat(String(k[4])),
          volume: parseFloat(String(k[5])),
          closeTime: Number(k[6]),
        }));
        return { candles, sourceName: "Binance" };
      }
    } catch {
      // try next
    }
  }
  throw new Error("Binance endpoints unavailable");
}

async function fetchMarketData(): Promise<MarketSourceResult> {
  // Try Coinbase first for lowest US latency & high reliability, then Kraken, then Binance
  const providers = [fetchCoinbase, fetchKraken, fetchBinance];
  let lastError: unknown = null;

  for (const provider of providers) {
    try {
      const result = await provider();
      if (result.candles.length >= 35) {
        return result;
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error("All market data providers failed");
}

export async function GET() {
  const startTime = Date.now();
  try {
    const { candles, sourceName } = await fetchMarketData();
    const signal = computeSignal(candles);
    const latencyMs = Date.now() - startTime;

    return NextResponse.json({
      signal,
      candleCount: candles.length,
      lastCandleTime: candles[candles.length - 1]?.closeTime,
      source: sourceName,
      latencyMs,
    });
  } catch (err) {
    console.error("Signal API error:", err);
    return NextResponse.json(
      {
        error: "Failed to fetch market data",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
