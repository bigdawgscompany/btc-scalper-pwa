import { describe, expect, it } from "vitest";

import { estimateLiquidationPrice, evaluateRisk, kellyFraction, resetCircuitBreaker } from "./risk-manager";

describe("risk manager", () => {
  it("calculates Kelly correctly", () => {
    expect(kellyFraction(0.55, 2)).toBeCloseTo(0.325, 12);
  });

  it("caps active risk at 2% and sizes from stop distance", () => {
    const result = evaluateRisk({
      equity: 10_000,
      consecutiveLosses: 0,
      intradayDrawdownFraction: 0,
      entry: 100,
      stopLoss: 98,
      takeProfit: 106,
      direction: "LONG",
      manualReset: false,
    });
    expect(result.haltStatus).toBe("ACTIVE");
    expect(result.riskFraction).toBeLessThanOrEqual(0.02);
    expect(result.maxLoss).toBeLessThanOrEqual(200);
    expect(result.size).toBe(result.maxLoss / 2);
    expect(result.riskReward).toBe(3);
  });

  it("halts after three consecutive losses", () => {
    const result = evaluateRisk({
      equity: 10_000,
      consecutiveLosses: 3,
      intradayDrawdownFraction: 0,
      entry: 100,
      stopLoss: 98,
      takeProfit: 106,
      direction: "LONG",
      manualReset: false,
    });
    expect(result.haltStatus).toBe("HALTED");
    expect(result.haltReason).toBe("CONSECUTIVE_LOSSES");
    expect(result.size).toBe(0);
    expect(result.maxLoss).toBe(0);
  });

  it("halts at 8% intraday drawdown", () => {
    const result = evaluateRisk({
      equity: 10_000,
      consecutiveLosses: 0,
      intradayDrawdownFraction: 0.08,
      entry: 100,
      stopLoss: 102,
      takeProfit: 94,
      direction: "SHORT",
      manualReset: false,
    });
    expect(result.haltStatus).toBe("HALTED");
    expect(result.haltReason).toBe("INTRADAY_DRAWDOWN");
  });

  it("provides a labeled mathematical liquidation estimate", () => {
    expect(estimateLiquidationPrice(100, "LONG", 10)).toBeCloseTo(90.5, 8);
    expect(estimateLiquidationPrice(100, "SHORT", 10)).toBeCloseTo(109.5, 8);
  });

  it("returns a clean manual-reset state", () => {
    expect(resetCircuitBreaker()).toEqual({
      consecutiveLosses: 0,
      intradayDrawdownFraction: 0,
      manualResetRequired: false,
    });
  });
});
