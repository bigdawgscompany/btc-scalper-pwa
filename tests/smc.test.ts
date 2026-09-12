import { describe, it, expect } from "vitest";
import { computeSmc } from "../src/lib/smc";
import type { Candle } from "../src/lib/contracts";

function series(n: number): Candle[] {
  const INTERVAL = 15 * 60 * 1000;
  const t0 = Date.now() - n * INTERVAL;
  return Array.from({ length: n }, (_, i) => {
    const close = 60_000 + Math.sin(i / 15) * 1200 + i * 4;
    return {
      openTime: t0 + i * INTERVAL,
      open: close - 20,
      high: close + 60,
      low: close - 60,
      close,
      volume: 80 + i,
      closeTime: t0 + i * INTERVAL + INTERVAL - 1,
    };
  });
}

describe("computeSmc", () => {
  it("returns empty on short history", () => {
    const r = computeSmc(series(20));
    expect(r.structures.length).toBe(0);
  });

  it("runs on long series without throw", () => {
    const r = computeSmc(series(250));
    expect(r.attribution.toLowerCase()).toContain("luxalgo");
    expect(Array.isArray(r.structures)).toBe(true);
    expect(Array.isArray(r.orderBlocks)).toBe(true);
    expect(Array.isArray(r.fvgs)).toBe(true);
  });
});
