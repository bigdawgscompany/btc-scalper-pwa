/** Public entry point for the deterministic quantitative engine. */

export {
  atr,
  bollinger,
  computeIndicators,
  ema,
  macd,
  obv,
  rsi,
  stochRsi,
  supertrend,
  trueRange,
  vwap,
} from "./indicators";
export { deriveBias, evaluateSignal } from "./signal-engine";
export type {
  BollingerResult,
  ConfluenceCriterion,
  Direction,
  IndicatorSet,
  MacdResult,
  OhlcvCandle,
  SignalDecision,
  StochRsiResult,
  SupertrendResult,
  TimeframeBias,
  TrendBias,
} from "./types";
