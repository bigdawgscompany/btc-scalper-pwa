import { describe, it, expect } from "vitest";
import { computeLiquidityProfile, evaluateReversal } from "../src/lib/liquidity";
import type { Candle } from "../src/lib/contracts";
import type { LiquidityZone } from "../src/lib/liquidity";

function series(n: number): Candle[] {
  const INTERVAL = 15 * 60 * 1000;
  const t0 = Date.now() - n * INTERVAL;
  return Array.from({ length: n }, (_, i) => {
    const close = 40_000 + Math.cos(i / 10) * 600 + (i % 20) * 5;
    return {
      openTime: t0 + i * INTERVAL,
      open: close - 15,
      high: close + 50,
      low: close - 50,
      close,
      volume: 100 + i,
      closeTime: t0 + i * INTERVAL + INTERVAL - 1,
    };
  });
}

describe("evaluateReversal", () => {
  it("returns null when already signaled", () => {
    const z: LiquidityZone = {
      side: "BSL",
      top: 100,
      bottom: 90,
      leftIndex: 0,
      rightIndex: 5,
      swept: false,
      signaled: true,
      deltas: [1, 1, 1, -5],
      volumeTraded: 10,
      capacity: 100,
      healthPct: 90,
      wasHit: true,
    };
    const bar: Candle = {
      openTime: 0,
      open: 95,
      high: 101,
      low: 94,
      close: 96,
      volume: 50,
      closeTime: 1,
    };
    expect(evaluateReversal(z, true, bar, 5, -10, 50)).toBeNull();
  });
});

describe("computeLiquidityProfile", () => {
  it("returns empty zones on short history", () => {
    const r = computeLiquidityProfile(series(10));
    expect(r.bslZones.length).toBe(0);
    expect(r.sslZones.length).toBe(0);
  });

  it("runs without throw on oscillatory series", () => {
    const r = computeLiquidityProfile(series(200));
    expect(r.attribution.toLowerCase()).toContain("luxalgo");
    expect(Array.isArray(r.bslZones)).toBe(true);
    expect(Array.isArray(r.sslZones)).toBe(true);
    expect(Array.isArray(r.signals)).toBe(true);
  });
});
