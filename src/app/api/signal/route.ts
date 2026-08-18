import { NextResponse } from "next/server";
import { computeSignal } from "@/lib/signals";
import type { Candle } from "@/lib/types";

const ENDPOINTS = [
  "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=100",
  "https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=100",
  "https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=100",
];

async function fetchKlines(): Promise<any[]> {
  const headers = {
    "User-Agent": "Mozilla/5.0 (compatible; BTCScalperPWA/1.0)",
    Accept: "application/json",
  };

  let lastError: unknown = null;

  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        headers,
        next: { revalidate: 15 },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from ${url}`);
        continue;
      }

      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
      lastError = new Error("Empty response");
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError ?? new Error("All Binance endpoints failed");
}

export async function GET() {
  try {
    const raw = await fetchKlines();

    const candles: Candle[] = raw.map((k: any[]) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
    }));

    const signal = computeSignal(candles);

    return NextResponse.json({
      signal,
      candleCount: candles.length,
      lastCandleTime: candles[candles.length - 1]?.closeTime,
      source: "binance",
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
