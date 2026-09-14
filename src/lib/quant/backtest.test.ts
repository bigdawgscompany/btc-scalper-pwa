import { describe, expect, it } from "vitest";

import { backtestSignals } from "./backtest";
import type { OhlcvCandle, SignalDecision } from "./types";

function candle(i: number, open: number, high: number, low: number, close: number): OhlcvCandle {
  return {
    openTime: i * 900_000,
    closeTime: i * 900_000 + 899_999,
    open,
    high,
    low,
    close,
    volume: 100,
    isClosed: true,
  };
}

function signal(index: number, direction: "LONG" | "SHORT", entry = 100): SignalDecision {
  return {
    direction,
    score: direction === "LONG" ? 5 : -5,
    confluenceStrength: (5 / 7) * 100,
    criteria: [],
    entry,
    stopLoss: direction === "LONG" ? entry - 2 : entry + 2,
    takeProfit: direction === "LONG" ? entry + 6 : entry - 6,
    timestamp: index * 900_000 + 899_999,
    primaryBias: direction === "LONG" ? "BULLISH" : "BEARISH",
    oneHourBias: direction === "LONG" ? "BULLISH" : "BEARISH",
    fourHourBias: direction === "LONG" ? "BULLISH" : "BEARISH",
  };
}

describe("backtest", () => {
  it("enters on the next candle open, never on signal close", () => {
    const candles = [candle(0, 90, 101, 89, 100), candle(1, 101, 107, 99, 106), candle(2, 106, 107, 105, 106)];
    const signals = [signal(0, "LONG"), null, null];
    const result = backtestSignals(candles, signals, {
      initialEquity: 10_000,
      maxHoldingBars: 2,
      feeRate: 0,
      slippageRate: 0,
    });
    expect(result.trades[0].entryPrice).toBe(101);
    expect(result.trades[0].entryTimestamp).toBe(candles[1].openTime);
    expect(result.trades[0].outcome).toBe("WIN");
  });

  it("resolves a same-bar stop/target conflict conservatively by default", () => {
    const candles = [candle(0, 99, 100, 98, 100), candle(1, 100, 107, 93, 100)];
    const signals = [signal(0, "LONG"), null];
    const result = backtestSignals(candles, signals, {
      initialEquity: 10_000,
      maxHoldingBars: 1,
      feeRate: 0,
      slippageRate: 0,
    });
    expect(result.trades[0].outcome).toBe("LOSS");
  });

  it("includes fees in net PnL", () => {
    const candles = [candle(0, 99, 100, 98, 100), candle(1, 100, 107, 99, 106)];
    const signals = [signal(0, "LONG"), null];
    const result = backtestSignals(candles, signals, {
      initialEquity: 10_000,
      maxHoldingBars: 1,
      feeRate: 0.001,
      slippageRate: 0,
    });
    expect(result.trades[0].fees).toBeGreaterThan(0);
    expect(result.trades[0].netPnl).toBeLessThan(result.trades[0].grossPnl);
  });
});
