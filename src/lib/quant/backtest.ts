/**
 * Deterministic candle-based backtest primitives.
 * A signal is known only at candle N close; entry begins at candle N+1 open.
 * When stop and target both occur in one candle, STOP_FIRST is the default conservative rule.
 */

import type { OhlcvCandle, SignalDecision } from "./types";

export type IntrabarResolution = "STOP_FIRST" | "TARGET_FIRST";
export type TradeOutcome = "WIN" | "LOSS" | "UNRESOLVED";

export interface BacktestCosts {
  readonly feeRate: number;
  readonly slippageRate: number;
}

export interface BacktestOptions extends BacktestCosts {
  readonly initialEquity: number;
  readonly maxHoldingBars: number;
  readonly intrabarResolution?: IntrabarResolution;
}

export interface BacktestTrade {
  readonly signalTimestamp: number;
  readonly entryTimestamp: number;
  readonly exitTimestamp: number;
  readonly direction: "LONG" | "SHORT";
  readonly signalScore: number;
  readonly signalStrength: number;
  readonly signalReferenceEntry: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly outcome: TradeOutcome;
  readonly grossPnl: number;
  readonly fees: number;
  readonly netPnl: number;
  readonly returnFraction: number;
  readonly barsHeld: number;
}

export interface BacktestResult {
  readonly initialEquity: number;
  readonly finalEquity: number;
  readonly netPnl: number;
  readonly returnFraction: number;
  readonly trades: readonly BacktestTrade[];
  readonly wins: number;
  readonly losses: number;
  readonly unresolved: number;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function fillPrice(open: number, direction: "LONG" | "SHORT", slippageRate: number, isEntry: boolean): number {
  const adverse = direction === "LONG" ? 1 : -1;
  const sign = isEntry ? adverse : -adverse;
  return open * (1 + sign * slippageRate);
}

function closePriceForLevel(level: number, direction: "LONG" | "SHORT", slippageRate: number): number {
  const adverse = direction === "LONG" ? -1 : 1;
  return level * (1 + adverse * slippageRate);
}

export function backtestSignals(
  candles: readonly OhlcvCandle[],
  signals: readonly (SignalDecision | null)[],
  options: BacktestOptions,
): BacktestResult {
  if (!finitePositive(options.initialEquity)) throw new Error("initialEquity must be finite and > 0");
  if (!Number.isInteger(options.maxHoldingBars) || options.maxHoldingBars < 1) throw new Error("maxHoldingBars must be >= 1");
  if (!Number.isFinite(options.feeRate) || options.feeRate < 0) throw new Error("feeRate must be >= 0");
  if (!Number.isFinite(options.slippageRate) || options.slippageRate < 0) throw new Error("slippageRate must be >= 0");
  if (signals.length !== candles.length) throw new Error("signals and candles must have equal length");

  const resolution = options.intrabarResolution ?? "STOP_FIRST";
  const trades: BacktestTrade[] = [];
  let equity = options.initialEquity;

  for (let signalIndex = 0; signalIndex < signals.length - 1; signalIndex += 1) {
    const signal = signals[signalIndex];
    if (!signal || signal.direction === "NEUTRAL") continue;
    if (signal.timestamp !== candles[signalIndex].closeTime || !candles[signalIndex].isClosed) {
      throw new Error("Signal timestamp must match a closed candle before entry");
    }

    const entryCandleIndex = signalIndex + 1;
    const entryCandle = candles[entryCandleIndex];
    if (!entryCandle.isClosed) throw new Error("Backtest entry candle must be closed historical data");

    const entryPrice = fillPrice(entryCandle.open, signal.direction, options.slippageRate, true);
    const stopDistance = Math.abs(signal.entry - signal.stopLoss);
    if (!finitePositive(stopDistance)) throw new Error("Directional signal requires a positive stop distance");

    const quantity = equity / entryPrice;
    const entryNotional = quantity * entryPrice;
    const entryFee = entryNotional * options.feeRate;

    let outcome: TradeOutcome = "UNRESOLVED";
    let exitPrice = entryPrice;
    let exitTimestamp = candles[Math.min(candles.length - 1, entryCandleIndex + options.maxHoldingBars - 1)].closeTime;
    let barsHeld = 0;

    for (let j = entryCandleIndex; j < candles.length && j < entryCandleIndex + options.maxHoldingBars; j += 1) {
      const bar = candles[j];
      barsHeld = j - entryCandleIndex + 1;
      const hitStop = signal.direction === "LONG" ? bar.low <= signal.stopLoss : bar.high >= signal.stopLoss;
      const hitTarget = signal.direction === "LONG" ? bar.high >= signal.takeProfit : bar.low <= signal.takeProfit;
      if (!hitStop && !hitTarget) continue;

      if (hitStop && hitTarget) outcome = resolution === "STOP_FIRST" ? "LOSS" : "WIN";
      else outcome = hitTarget ? "WIN" : "LOSS";

      const level = outcome === "WIN" ? signal.takeProfit : signal.stopLoss;
      exitPrice = closePriceForLevel(level, signal.direction, options.slippageRate);
      exitTimestamp = bar.closeTime;
      break;
    }

    if (outcome === "UNRESOLVED") {
      const finalIndex = Math.min(candles.length - 1, entryCandleIndex + options.maxHoldingBars - 1);
      const close = candles[finalIndex].close;
      exitPrice = fillPrice(close, signal.direction, options.slippageRate, false);
      exitTimestamp = candles[finalIndex].closeTime;
      barsHeld = finalIndex - entryCandleIndex + 1;
    }

    const grossPnl = signal.direction === "LONG"
      ? quantity * (exitPrice - entryPrice)
      : quantity * (entryPrice - exitPrice);
    const exitFee = Math.abs(quantity * exitPrice) * options.feeRate;
    const fees = entryFee + exitFee;
    const netPnl = grossPnl - fees;
    const returnFraction = netPnl / equity;
    equity += netPnl;

    trades.push({
      signalTimestamp: signal.timestamp,
      entryTimestamp: entryCandle.openTime,
      exitTimestamp,
      direction: signal.direction,
      signalScore: signal.score,
      signalStrength: signal.confluenceStrength,
      signalReferenceEntry: signal.entry,
      entryPrice,
      exitPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      outcome,
      grossPnl,
      fees,
      netPnl,
      returnFraction,
      barsHeld,
    });
  }

  const wins = trades.filter((trade) => trade.outcome === "WIN").length;
  const losses = trades.filter((trade) => trade.outcome === "LOSS").length;
  const unresolved = trades.filter((trade) => trade.outcome === "UNRESOLVED").length;
  return {
    initialEquity: options.initialEquity,
    finalEquity: equity,
    netPnl: equity - options.initialEquity,
    returnFraction: (equity - options.initialEquity) / options.initialEquity,
    trades,
    wins,
    losses,
    unresolved,
  };
}
