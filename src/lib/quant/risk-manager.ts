/**
 * Deterministic paper-trading risk engine.
 * Uses fractional Kelly, a hard 2% risk cap, and explicit circuit-breaker state.
 * No order execution, exchange credentials, or side effects.
 */

import type { Direction } from "./types";

export type HaltReason = "CONSECUTIVE_LOSSES" | "INTRADAY_DRAWDOWN" | "MANUAL_RESET_REQUIRED" | "NONE";

export interface RiskManagerInput {
  readonly equity: number;
  readonly winProbability?: number;
  readonly rewardRiskMultiple?: number;
  readonly fractionalKelly?: number;
  readonly maxRiskFraction?: number;
  readonly consecutiveLosses: number;
  readonly intradayDrawdownFraction: number;
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly direction: Direction;
  readonly leverage?: number;
  readonly maintenanceMarginRate?: number;
  readonly manualReset: boolean;
}

export interface RiskDecision {
  readonly direction: Direction;
  readonly size: number;
  readonly maxLoss: number;
  readonly riskFraction: number;
  readonly stopDistance: number;
  readonly riskReward: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly liquidationPriceEstimate: number;
  readonly haltStatus: "ACTIVE" | "HALTED";
  readonly haltReason: HaltReason;
}

function assertFinitePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and > 0`);
}

export function kellyFraction(winProbability = 0.55, rewardRiskMultiple = 2): number {
  if (!Number.isFinite(winProbability) || winProbability < 0 || winProbability > 1) {
    throw new Error("winProbability must be within [0, 1]");
  }
  assertFinitePositive("rewardRiskMultiple", rewardRiskMultiple);
  const q = 1 - winProbability;
  return Math.max(0, ((rewardRiskMultiple * winProbability) - q) / rewardRiskMultiple);
}

export function estimateLiquidationPrice(
  entry: number,
  direction: Direction,
  leverage = 1,
  maintenanceMarginRate = 0.005,
): number {
  assertFinitePositive("entry", entry);
  assertFinitePositive("leverage", leverage);
  if (!Number.isFinite(maintenanceMarginRate) || maintenanceMarginRate < 0 || maintenanceMarginRate >= 1) {
    throw new Error("maintenanceMarginRate must be within [0, 1)");
  }
  if (direction === "LONG") return entry * (1 - 1 / leverage + maintenanceMarginRate);
  if (direction === "SHORT") return entry * (1 + 1 / leverage - maintenanceMarginRate);
  return entry;
}

export function evaluateRisk(input: RiskManagerInput): RiskDecision {
  assertFinitePositive("equity", input.equity);
  assertFinitePositive("entry", input.entry);
  assertFinitePositive("stopLoss", input.stopLoss);
  assertFinitePositive("takeProfit", input.takeProfit);
  const winProbability = input.winProbability ?? 0.55;
  const rewardRiskMultiple = input.rewardRiskMultiple ?? 2;
  const fractionalKelly = input.fractionalKelly ?? 0.25;
  const maxRiskFraction = input.maxRiskFraction ?? 0.02;
  const leverage = input.leverage ?? 1;
  const maintenanceMarginRate = input.maintenanceMarginRate ?? 0.005;

  if (!Number.isFinite(fractionalKelly) || fractionalKelly <= 0 || fractionalKelly > 1) {
    throw new Error("fractionalKelly must be within (0, 1]");
  }
  if (!Number.isFinite(maxRiskFraction) || maxRiskFraction <= 0 || maxRiskFraction > 0.02) {
    throw new Error("maxRiskFraction must be within (0, 0.02]");
  }
  if (!Number.isInteger(input.consecutiveLosses) || input.consecutiveLosses < 0) {
    throw new Error("consecutiveLosses must be a non-negative integer");
  }
  if (!Number.isFinite(input.intradayDrawdownFraction) || input.intradayDrawdownFraction < 0) {
    throw new Error("intradayDrawdownFraction must be >= 0");
  }

  const consecutiveLossHalt = input.consecutiveLosses >= 3;
  const drawdownHalt = input.intradayDrawdownFraction >= 0.08;
  const halted = consecutiveLossHalt || drawdownHalt;
  const haltReason: HaltReason = consecutiveLossHalt
    ? "CONSECUTIVE_LOSSES"
    : drawdownHalt
      ? "INTRADAY_DRAWDOWN"
      : "NONE";

  const stopDistance = Math.abs(input.entry - input.stopLoss);
  const targetDistance = Math.abs(input.takeProfit - input.entry);
  if (input.direction !== "NEUTRAL" && stopDistance <= 0) throw new Error("Stop distance must be > 0 for directional risk");
  const riskReward = stopDistance > 0 ? targetDistance / stopDistance : 0;
  const rawKelly = kellyFraction(winProbability, rewardRiskMultiple);
  const riskFraction = Math.min(rawKelly * fractionalKelly, maxRiskFraction);
  const maxLoss = halted || input.direction === "NEUTRAL" ? 0 : input.equity * riskFraction;
  const size = halted || input.direction === "NEUTRAL" ? 0 : maxLoss / stopDistance;

  return {
    direction: input.direction,
    size,
    maxLoss,
    riskFraction: halted ? 0 : riskFraction,
    stopDistance,
    riskReward,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
    liquidationPriceEstimate: estimateLiquidationPrice(input.entry, input.direction, leverage, maintenanceMarginRate),
    haltStatus: halted ? "HALTED" : "ACTIVE",
    haltReason,
  };
}

export function resetCircuitBreaker(): { consecutiveLosses: number; intradayDrawdownFraction: number; manualResetRequired: false } {
  return { consecutiveLosses: 0, intradayDrawdownFraction: 0, manualResetRequired: false };
}
