import { describe, it, expect } from "vitest";
import { computeSupertrend, computeUtBot } from "../src/lib/trend";
import type { Candle } from "../src/lib/contracts";

function series(n: number): Candle[] {
  const INTERVAL = 15 * 60 * 1000;
  const t0 = Date.now() - n * INTERVAL;
  return Array.from({ length: n }, (_, i) => {
    const close = 55_000 + i * 15 + Math.sin(i / 8) * 200;
    return {
      openTime: t0 + i * INTERVAL,
      open: close - 10,
      high: close + 30,
      low: close - 30,
      close,
      volume: 40,
      closeTime: t0 + i * INTERVAL + INTERVAL - 1,
    };
  });
}

describe("computeSupertrend", () => {
  it("produces trend array matching length", () => {
    const c = series(80);
    const r = computeSupertrend(c);
    expect(r.trend.length).toBe(80);
    expect(r.lastTrend === 1 || r.lastTrend === -1).toBe(true);
  });
});

describe("computeUtBot", () => {
  it("produces trailing stop series", () => {
    const c = series(80);
    const r = computeUtBot(c);
    expect(r.trailingStop.length).toBe(80);
    expect(r.lastStop).not.toBeNull();
  });
});
