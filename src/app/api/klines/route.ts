import { NextResponse } from "next/server";
import type { Candle } from "@/lib/types";

const BINANCE_URL =
  "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=100";

export async function GET() {
  try {
    const res = await fetch(BINANCE_URL, {
      next: { revalidate: 30 }, // cache 30s
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to fetch klines from Binance" },
        { status: 502 }
      );
    }

    const raw = await res.json();

    const candles: Candle[] = raw.map((k: any[]) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
    }));

    return NextResponse.json({ candles, source: "binance", symbol: "BTCUSDT" });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Internal error fetching market data" },
      { status: 500 }
    );
  }
}