import { describe, it, expect } from "vitest";
import { collectPivots, detectPatterns } from "../src/lib/patterns";
import type { Candle } from "../src/lib/contracts";

function makeCandles(count: number, start = 50_000): Candle[] {
  const INTERVAL = 15 * 60 * 1000;
  const t0 = Math.floor(Date.now() / INTERVAL) * INTERVAL - count * INTERVAL;
  return Array.from({ length: count }, (_, i) => {
    // mild oscillation so pivots form
    const wave = Math.sin(i / 8) * 400 + Math.cos(i / 5) * 150;
    const close = start + wave + i * 2;
    return {
      openTime: t0 + i * INTERVAL,
      open: close - 20,
      high: close + 80,
      low: close - 80,
      close,
      volume: 100 + (i % 7) * 10,
      closeTime: t0 + i * INTERVAL + INTERVAL - 1,
    };
  });
}

/** Synthetic double-bottom: two similar lows with a mid high, then breakout up */
function doubleBottomSeries(): Candle[] {
  const INTERVAL = 15 * 60 * 1000;
  const t0 = Date.now() - 120 * INTERVAL;
  const prices: number[] = [];
  // build ~100 bars with clear structure
  for (let i = 0; i < 40; i++) prices.push(100 + i * 0.5); // up
  for (let i = 0; i < 15; i++) prices.push(120 - i * 2); // down to first bottom ~90
  prices.push(90, 89, 90); // bottom 1
  for (let i = 0; i < 10; i++) prices.push(90 + i * 2); // up to mid ~110
  prices.push(110, 111, 110);
  for (let i = 0; i < 10; i++) prices.push(110 - i * 2); // down to second bottom ~90
  prices.push(90, 89.5, 90);
  for (let i = 0; i < 20; i++) prices.push(90 + i * 1.5); // breakout above mid

  return prices.map((close, i) => ({
    openTime: t0 + i * INTERVAL,
    open: close - 1,
    high: close + 3,
    low: close - 3,
    close,
    volume: 200,
    closeTime: t0 + i * INTERVAL + INTERVAL - 1,
  }));
}

describe("collectPivots", () => {
  it("returns highs and lows with valid indices", () => {
    const candles = makeCandles(80);
    const { highs, lows } = collectPivots(candles, 5, 5, 50);
    expect(highs.length).toBeGreaterThan(0);
    expect(lows.length).toBeGreaterThan(0);
    for (const h of highs) {
      expect(h.index).toBeGreaterThanOrEqual(5);
      expect(h.index).toBeLessThan(candles.length - 5);
      expect(h.price).toBe(candles[h.index].high);
    }
  });
});

describe("detectPatterns", () => {
  it("returns undetected on short history", () => {
    const r = detectPatterns(makeCandles(20));
    expect(r.detected).toBe(false);
  });

  it("runs without throwing on oscillatory series", () => {
    const r = detectPatterns(makeCandles(120));
    expect(typeof r.detected).toBe("boolean");
    if (r.detected) {
      expect(r.entryPrice).toBeGreaterThan(0);
      expect(r.stopPrice).toBeGreaterThan(0);
      expect(r.targetPrice).toBeGreaterThan(0);
      expect(r.riskReward).toBeGreaterThan(0);
      expect(r.name.length).toBeGreaterThan(0);
    }
  });

  it("handles synthetic double-bottom structure", () => {
    const r = detectPatterns(doubleBottomSeries());
    // May or may not fire depending on pivot/breakout filters — must not throw
    expect(r).toBeDefined();
    expect(typeof r.detected).toBe("boolean");
  });
});
