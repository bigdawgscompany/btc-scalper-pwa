import { describe, expect, it } from "vitest";
import { MarketResponseSchema } from "../src/lib/contracts";

const analysis = {
  state: "Bullish" as const, score: 80, sumVotes: 4, supporters: 4, opponents: 0,
  candleTime: 1000, isForming: false, reasons: [],
  indicators: { rsi: 50, cci: 0, macdHist: 1, macdLine: 1, signalLine: 0, stochK: 50, stochD: 50, willR: -50, lorentzianPrediction: 1 },
  groupContributions: [],
};

const base = {
  schemaVersion: 2 as const, instrument: "BTCUSDT" as const, interval: "15m" as const, venue: "Binance" as const,
  source: "Binance", candles: [], confirmedAnalysis: analysis, provisionalAnalysis: null,
  observationTimestamp: 2000, generatedTimestamp: 2001, expiresAt: 3000,
  status: { isLive: true, isLagging: false, lagSeconds: 0, confirmedCandleTime: 1000 },
};

describe("market response semantic contract", () => {
  it("accepts internally consistent confirmed candle time", () => {
    expect(MarketResponseSchema.safeParse(base).success).toBe(true);
  });

  it("rejects mismatched confirmed analysis and status times", () => {
    expect(MarketResponseSchema.safeParse({
      ...base, status: { ...base.status, confirmedCandleTime: 999 },
    }).success).toBe(false);
  });
});
