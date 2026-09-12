import { describe, it, expect } from "vitest";
import {
  validateCandleChronology,
  validateOscillatorRanges,
  validateContributionArithmetic,
  isEligibleForExecution,
} from "../src/lib/browser-market";
import type { Candle, MarketResponse, AnalysisResult } from "../src/lib/contracts";

function makeCandle(openTime: number, close: number): Candle {
  const INTERVAL_MS = 15 * 60 * 1000;
  return {
    openTime,
    open: close,
    high: close + 50,
    low: close - 50,
    close,
    volume: 100,
    closeTime: openTime + INTERVAL_MS - 1,
  };
}

const BASE_INDICATORS = {
  rsi: 50,
  cci: 0,
  macdHist: 0,
  macdLine: 0,
  signalLine: 0,
  stochK: 50,
  stochD: 50,
  willR: -50,
  lorentzianPrediction: 0,
};

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    state: "Wait",
    score: 0,
    sumVotes: 0,
    supporters: 0,
    opponents: 0,
    candleTime: 0,
    isForming: false,
    reasons: [],
    indicators: { ...BASE_INDICATORS },
    groupContributions: [],
    ...overrides,
  };
}

describe("validateCandleChronology", () => {
  it("passes for valid ascending contiguous series", () => {
    const INTERVAL_MS = 15 * 60 * 1000;
    const base = Math.floor(Date.now() / INTERVAL_MS) * INTERVAL_MS - 5 * INTERVAL_MS;
    const candles = [
      makeCandle(base, 50000),
      makeCandle(base + INTERVAL_MS, 50100),
      makeCandle(base + 2 * INTERVAL_MS, 50200),
    ];
    const result = validateCandleChronology(candles);
    expect(result.valid).toBe(true);
  });

  it("rejects duplicate timestamps", () => {
    const INTERVAL_MS = 15 * 60 * 1000;
    const base = Math.floor(Date.now() / INTERVAL_MS) * INTERVAL_MS - 3 * INTERVAL_MS;
    const candles = [
      makeCandle(base, 50000),
      makeCandle(base, 50100),
    ];
    const result = validateCandleChronology(candles);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Duplicate");
  });

  it("rejects gaps in 15m series", () => {
    const INTERVAL_MS = 15 * 60 * 1000;
    const base = Math.floor(Date.now() / INTERVAL_MS) * INTERVAL_MS - 4 * INTERVAL_MS;
    const candles = [
      makeCandle(base, 50000),
      makeCandle(base + 2 * INTERVAL_MS, 50200),
    ];
    const result = validateCandleChronology(candles);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Gap");
  });

  it("rejects future timestamps", () => {
    const future = Date.now() + 120_000;
    const candles = [makeCandle(future, 50000)];
    const result = validateCandleChronology(candles);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("future");
  });

  it("rejects empty series", () => {
    const result = validateCandleChronology([]);
    expect(result.valid).toBe(false);
  });
});

describe("validateOscillatorRanges", () => {
  it("passes for valid oscillator ranges", () => {
    const result = validateOscillatorRanges(makeAnalysis());
    expect(result.valid).toBe(true);
  });

  it("rejects RSI > 100", () => {
    const analysis = makeAnalysis({ indicators: { ...BASE_INDICATORS, rsi: 150 } });
    const result = validateOscillatorRanges(analysis);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("RSI"))).toBe(true);
  });

  it("rejects Williams %R > 0", () => {
    const analysis = makeAnalysis({ indicators: { ...BASE_INDICATORS, willR: 10 } });
    const result = validateOscillatorRanges(analysis);
    expect(result.valid).toBe(false);
  });
});

describe("validateContributionArithmetic", () => {
  it("passes for valid contributions", () => {
    const analysis = makeAnalysis({
      state: "Bullish",
      score: 80,
      sumVotes: 4,
      supporters: 4,
      groupContributions: [
        { groupName: "RSI", vote: 1, contribution: 20, reason: "test" },
        { groupName: "CCI", vote: 1, contribution: 20, reason: "test" },
        { groupName: "MACD", vote: 1, contribution: 20, reason: "test" },
        { groupName: "Stoch", vote: 1, contribution: 20, reason: "test" },
        { groupName: "Lorentzian ML", vote: 0, contribution: 0, reason: "test" },
      ],
    });
    const result = validateContributionArithmetic(analysis);
    expect(result.valid).toBe(true);
  });

  it("rejects contribution != vote * 20", () => {
    // Intentionally invalid contribution value to test validation
    const analysis = makeAnalysis({
      groupContributions: [
        { groupName: "RSI", vote: 1, contribution: 0 as 20, reason: "wrong" },
        { groupName: "CCI", vote: 0, contribution: 0, reason: "test" },
        { groupName: "MACD", vote: 0, contribution: 0, reason: "test" },
        { groupName: "Stoch", vote: 0, contribution: 0, reason: "test" },
        { groupName: "Lorentzian ML", vote: 0, contribution: 0, reason: "test" },
      ],
    });
    const result = validateContributionArithmetic(analysis);
    expect(result.valid).toBe(false);
  });
});

describe("isEligibleForExecution", () => {
  const baseResponse: MarketResponse = {
    schemaVersion: 2,
    instrument: "BTCUSDT",
    interval: "15m",
    venue: "Binance",
    source: "Binance",
    candles: [],
    confirmedAnalysis: {
      state: "Bullish",
      score: 80,
      sumVotes: 4,
      supporters: 4,
      opponents: 0,
      candleTime: 0,
      isForming: false,
      reasons: [],
      indicators: { ...BASE_INDICATORS },
      groupContributions: [],
    },
    provisionalAnalysis: null,
    observationTimestamp: Date.now(),
    generatedTimestamp: Date.now(),
    expiresAt: Date.now() + 900_000,
    status: { isLive: true, isLagging: false, lagSeconds: 0, confirmedCandleTime: 0 },
  };

  it("returns eligible for fresh live Bullish data", () => {
    const result = isEligibleForExecution(baseResponse);
    expect(result.eligible).toBe(true);
  });

  it("rejects contradictory bullish evidence", () => {
    const data = {
      ...baseResponse,
      confirmedAnalysis: { ...baseResponse.confirmedAnalysis, score: 75 },
    };
    const result = isEligibleForExecution(data);
    expect(result.eligible).toBe(false);
  });

  it("returns not eligible when not live", () => {
    const data = { ...baseResponse, status: { ...baseResponse.status, isLive: false } };
    const result = isEligibleForExecution(data);
    expect(result.eligible).toBe(false);
  });

  it("returns not eligible when expired", () => {
    const data = { ...baseResponse, expiresAt: Date.now() - 1000 };
    const result = isEligibleForExecution(data);
    expect(result.eligible).toBe(false);
  });

  it("returns not eligible for Wait state", () => {
    const data = {
      ...baseResponse,
      confirmedAnalysis: { ...baseResponse.confirmedAnalysis, state: "Wait" as const },
    };
    const result = isEligibleForExecution(data);
    expect(result.eligible).toBe(false);
  });

  it("returns not eligible when lagging", () => {
    const data = { ...baseResponse, status: { ...baseResponse.status, isLagging: true } };
    const result = isEligibleForExecution(data);
    expect(result.eligible).toBe(false);
  });
});