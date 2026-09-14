import { describe, expect, it } from "vitest";

import { atr, bollinger, computeIndicators, ema, rsi, stochRsi, supertrend, vwap } from "./indicators";
import type { OhlcvCandle } from "./types";

function candles(closes: readonly number[], volume = 100): OhlcvCandle[] {
  return closes.map((close, i) => ({
    openTime: i * 900_000,
    closeTime: i * 900_000 + 899_999,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume,
    isClosed: true,
  }));
}

describe("quant indicators", () => {
  it("preserves length and uses NaN warmups", () => {
    const series = [1, 2, 3, 4, 5, 6];
    const output = ema(series, 3);
    expect(output).toHaveLength(series.length);
    expect(output[0]).toBeNaN();
    expect(output[1]).toBeNaN();
    expect(output[2]).toBe(2);
  });

  it("calculates RSI in the closed-candle series without look-ahead", () => {
    const series = Array.from({ length: 40 }, (_, i) => 100 + i);
    const output = rsi(series, 14);
    expect(output).toHaveLength(40);
    expect(output[14]).toBe(100);
    expect(output[39]).toBe(100);
  });

  it("resets VWAP at the UTC calendar boundary", () => {
    const msDay = 86_400_000;
    const first = {
      openTime: 0,
      closeTime: 899_999,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 10,
      isClosed: true,
    } satisfies OhlcvCandle;
    const second = {
      ...first,
      openTime: msDay,
      closeTime: msDay + 899_999,
      open: 200,
      high: 200,
      low: 200,
      close: 200,
    } satisfies OhlcvCandle;
    expect(vwap([first, second])).toEqual([100, 200]);
  });

  it("returns fully aligned indicator arrays", () => {
    const series = candles(Array.from({ length: 240 }, (_, i) => 100 + Math.sin(i / 7) * 3 + i * 0.1));
    const output = computeIndicators(series);
    expect(output.ema200).toHaveLength(series.length);
    expect(output.rsi14).toHaveLength(series.length);
    expect(output.macd.histogram).toHaveLength(series.length);
    expect(output.vwap).toHaveLength(series.length);
    expect(output.bollinger.upper).toHaveLength(series.length);
    expect(output.supertrend.direction).toHaveLength(series.length);
    expect(output.atr14).toHaveLength(series.length);
    expect(output.stochRsi.k).toHaveLength(series.length);
    expect(output.obv).toHaveLength(series.length);
  });

  it("produces finite ATR, Supertrend, Bollinger, and StochRSI after warmup", () => {
    const series = candles(Array.from({ length: 240 }, (_, i) => 100 + i * 0.2 + Math.sin(i / 5)));
    const a = atr(series, 14);
    const bb = bollinger(series.map((c) => c.close), 20, 2);
    const st = supertrend(series, 10, 3);
    const sr = stochRsi(rsi(series.map((c) => c.close), 14), 14, 3, 3);
    expect(Number.isFinite(a[30])).toBe(true);
    expect(Number.isFinite(bb.middle[30])).toBe(true);
    expect(Number.isFinite(st.value[30])).toBe(true);
    expect(Number.isFinite(sr.k[40])).toBe(true);
    expect(Number.isFinite(sr.d[40])).toBe(true);
  });
});
