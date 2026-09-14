/**
 * Quantitative engine contracts for the BTCUSDT 15m research terminal.
 * Pure data contracts only; no browser, network, clock, or persistence dependencies.
 */

export type Direction = "LONG" | "SHORT" | "NEUTRAL";
export type TrendBias = "BULLISH" | "BEARISH" | "UNKNOWN";

export interface OhlcvCandle {
  readonly openTime: number;
  readonly closeTime: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly quoteVolume?: number;
  readonly tradeCount?: number;
  readonly isClosed: boolean;
}

export interface SeriesSnapshot {
  readonly values: readonly number[];
  readonly last: number;
}

export interface BollingerResult {
  readonly middle: readonly number[];
  readonly upper: readonly number[];
  readonly lower: readonly number[];
}

export interface MacdResult {
  readonly macd: readonly number[];
  readonly signal: readonly number[];
  readonly histogram: readonly number[];
}

export interface StochRsiResult {
  readonly k: readonly number[];
  readonly d: readonly number[];
}

export interface SupertrendResult {
  readonly value: readonly number[];
  readonly direction: readonly (1 | -1 | 0)[];
}

export interface IndicatorSet {
  readonly ema9: readonly number[];
  readonly ema21: readonly number[];
  readonly ema50: readonly number[];
  readonly ema200: readonly number[];
  readonly rsi14: readonly number[];
  readonly macd: MacdResult;
  readonly vwap: readonly number[];
  readonly bollinger: BollingerResult;
  readonly supertrend: SupertrendResult;
  readonly atr14: readonly number[];
  readonly stochRsi: StochRsiResult;
  readonly obv: readonly number[];
}

export interface TimeframeBias {
  readonly bias: TrendBias;
  readonly close: number;
  readonly ema200: number;
  readonly closeTime: number;
}

export interface ConfluenceCriterion {
  readonly id: string;
  readonly label: string;
  readonly score: -1 | 0 | 1;
  readonly detail: string;
}

export interface SignalDecision {
  readonly direction: Direction;
  readonly score: number;
  readonly confluenceStrength: number;
  readonly criteria: readonly ConfluenceCriterion[];
  readonly entry: number;
  readonly stopLoss: number;
  readonly takeProfit: number;
  readonly timestamp: number;
  readonly primaryBias: TrendBias;
  readonly oneHourBias: TrendBias;
  readonly fourHourBias: TrendBias;
}
