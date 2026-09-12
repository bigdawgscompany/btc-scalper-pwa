import { describe, it, expect } from "vitest";
import {
  alphaFromApt,
  clampApt,
  classifySwingLabel,
  computeSwingAnchoredVwap,
} from "../src/lib/vwap";
import type { Candle } from "../src/lib/contracts";

function series(n: number): Candle[] {
  const INTERVAL = 15 * 60 * 1000;
  const t0 = Date.now() - n * INTERVAL;
  return Array.from({ length: n }, (_, i) => {
    const close = 50_000 + Math.sin(i / 12) * 800 + i * 3;
    return {
      openTime: t0 + i * INTERVAL,
      open: close - 10,
      high: close + 40,
      low: close - 40,
      close,
      volume: 50 + (i % 9),
      closeTime: t0 + i * INTERVAL + INTERVAL - 1,
    };
  });
}

describe("alphaFromApt", () => {
  it("returns alpha in (0,1) for positive APT", () => {
    const a = alphaFromApt(20);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(1);
  });
});

describe("clampApt", () => {
  it("clamps below 5 and above 300", () => {
    expect(clampApt(1)).toBe(5);
    expect(clampApt(500)).toBe(300);
    expect(clampApt(50)).toBe(50);
  });
});

describe("classifySwingLabel", () => {
  it("labels higher low and lower high", () => {
    expect(classifySwingLabel(1, 110, 100)).toBe("HL");
    expect(classifySwingLabel(1, 90, 100)).toBe("LL");
    expect(classifySwingLabel(-1, 120, 100)).toBe("HH");
    expect(classifySwingLabel(-1, 80, 100)).toBe("LH");
  });
});

describe("computeSwingAnchoredVwap", () => {
  it("returns null series for short input", () => {
    const r = computeSwingAnchoredVwap(series(10));
    expect(r.lastVwap).toBeNull();
  });

  it("produces finite last VWAP on long series", () => {
    const r = computeSwingAnchoredVwap(series(200));
    expect(r.lastVwap).not.toBeNull();
    expect(Number.isFinite(r.lastVwap as number)).toBe(true);
    expect(r.vwapSeries.length).toBe(200);
  });
});
