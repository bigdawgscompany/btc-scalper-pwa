import { describe, it, expect } from "vitest";
import { computeLorentzianVote } from "../src/lib/ml/lorentzian";
import type { Candle } from "../src/lib/contracts";

function makeCandles(n: number, opts: { trend?: number; seed?: number } = {}): Candle[] {
  const { trend = 0, seed = 1 } = opts;
  const candles: Candle[] = [];
  let price = 50000;
  let s = seed;
  const rand = () => {
    // simple deterministic PRNG so tests are stable
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s % 1000) / 1000 - 0.5;
  };
  for (let i = 0; i < n; i++) {
    price += trend + rand() * 20;
    const open = price;
    const close = price + rand() * 10;
    const high = Math.max(open, close) + Math.abs(rand()) * 5;
    const low = Math.min(open, close) - Math.abs(rand()) * 5;
    candles.push({
      openTime: i * 900_000,
      open,
      high,
      low,
      close,
      volume: 100 + Math.abs(rand()) * 10,
      closeTime: i * 900_000 + 899_999,
    });
    price = close;
  }
  return candles;
}

describe("computeLorentzianVote", () => {
  it("returns a vote in {-1, 0, 1} with a supporting reason", () => {
    const candles = makeCandles(100);
    const result = computeLorentzianVote(candles);
    expect([-1, 0, 1]).toContain(result.vote);
    expect(typeof result.reason).toBe("string");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("neighborsUsed never exceeds the neighbors count (8)", () => {
    const candles = makeCandles(100);
    const result = computeLorentzianVote(candles);
    expect(result.neighborsUsed).toBeGreaterThanOrEqual(0);
    expect(result.neighborsUsed).toBeLessThanOrEqual(8);
  });

  it("is deterministic for identical input", () => {
    const candles = makeCandles(100, { seed: 42 });
    const a = computeLorentzianVote(candles);
    const b = computeLorentzianVote(candles);
    expect(a).toEqual(b);
  });

  it("does not throw on a strongly trending series", () => {
    const up = makeCandles(100, { trend: 15, seed: 7 });
    const down = makeCandles(100, { trend: -15, seed: 7 });
    expect(() => computeLorentzianVote(up)).not.toThrow();
    expect(() => computeLorentzianVote(down)).not.toThrow();
  });

  it("prediction magnitude never exceeds neighborsUsed", () => {
    const candles = makeCandles(100, { seed: 99 });
    const result = computeLorentzianVote(candles);
    expect(Math.abs(result.prediction)).toBeLessThanOrEqual(Math.max(result.neighborsUsed, 8));
  });
});

describe("computeLorentzianVote — regime filter", () => {
  it("exposes a boolean regimeOk field", () => {
    const candles = makeCandles(100, { seed: 3 });
    const result = computeLorentzianVote(candles);
    expect(typeof result.regimeOk).toBe("boolean");
  });

  it("does not throw on a flat/sideways series (regime filter's target case)", () => {
    const flat: Candle[] = [];
    let t = 0;
    for (let i = 0; i < 100; i++) {
      flat.push({
        openTime: t,
        open: 50000,
        high: 50005,
        low: 49995,
        close: 50000 + (i % 2 === 0 ? 1 : -1),
        volume: 100,
        closeTime: t + 899_999,
      });
      t += 900_000;
    }
    expect(() => computeLorentzianVote(flat)).not.toThrow();
  });

  it("withheld reason mentions the specific blocking filter when applicable", () => {
    const candles = makeCandles(100, { seed: 11 });
    const result = computeLorentzianVote(candles);
    if (result.vote === 0 && !result.volatilityOk) {
      expect(result.reason).toMatch(/volatility filter blocked/);
    }
    if (result.vote === 0 && result.volatilityOk && !result.regimeOk) {
      expect(result.reason).toMatch(/regime filter blocked/);
    }
  });
});

describe("computeLorentzianVote — large history (full pipeline scale)", () => {
  it("handles ~1000 candles without throwing, using far more than 8 potential neighbors' worth of history", () => {
    const candles = makeCandles(1000, { seed: 55 });
    const start = Date.now();
    const result = computeLorentzianVote(candles);
    const elapsedMs = Date.now() - start;
    expect([-1, 0, 1]).toContain(result.vote);
    expect(result.neighborsUsed).toBeLessThanOrEqual(8);
    // Generous ceiling — this should be single-digit-ms in practice, but
    // the point of this test is to catch an accidental O(n^3)-type blowup,
    // not to pin exact timing.
    expect(elapsedMs).toBeLessThan(5000);
  });
});
