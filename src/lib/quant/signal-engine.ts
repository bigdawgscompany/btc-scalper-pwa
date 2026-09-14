/**
 * Seven-factor BTCUSDT confluence engine.
 * Evaluates only a closed primary candle and explicitly supplied closed HTF snapshots.
 * Confluence strength is rule strength, not a probability of winning.
 */

import type {
  ConfluenceCriterion,
  Direction,
  IndicatorSet,
  OhlcvCandle,
  SignalDecision,
  TimeframeBias,
  TrendBias,
} from "./types";

const NAN = Number.NaN;

function finite(...values: number[]): boolean {
  return values.every(Number.isFinite);
}

export function deriveBias(candle: OhlcvCandle, indicators: IndicatorSet, index: number): TimeframeBias {
  const ema200 = indicators.ema200[index];
  const bias: TrendBias = finite(candle.close, ema200)
    ? candle.close > ema200
      ? "BULLISH"
      : candle.close < ema200
        ? "BEARISH"
        : "UNKNOWN"
    : "UNKNOWN";
  return { bias, close: candle.close, ema200, closeTime: candle.closeTime };
}

function criterion(
  id: string,
  label: string,
  score: -1 | 0 | 1,
  detail: string,
): ConfluenceCriterion {
  return { id, label, score, detail };
}

export interface SignalEngineInput {
  readonly candles: readonly OhlcvCandle[];
  readonly index?: number;
  readonly indicators?: IndicatorSet;
  readonly oneHourBias: TrendBias;
  readonly fourHourBias: TrendBias;
}

export function evaluateSignal(input: SignalEngineInput): SignalDecision {
  const index = input.index ?? input.candles.length - 1;
  if (index < 1 || index >= input.candles.length) throw new Error("Signal index outside candle series");
  const candle = input.candles[index];
  if (!candle.isClosed) throw new Error("Signal evaluation requires a closed candle");
  if (!input.indicators) throw new Error("Indicator set is required");

  const indicators = input.indicators;
  const previous = input.candles[index - 1];
  const criteria: ConfluenceCriterion[] = [];

  const htf4h = input.fourHourBias === "BULLISH" ? 1 : input.fourHourBias === "BEARISH" ? -1 : 0;
  criteria.push(criterion(
    "htf-4h-ema200",
    "4H EMA200 bias",
    htf4h,
    input.fourHourBias === "UNKNOWN" ? "4H bias unavailable" : `${input.fourHourBias} 4H bias`,
  ));

  const e9 = indicators.ema9[index];
  const e21 = indicators.ema21[index];
  const e9Prev = indicators.ema9[index - 1];
  const e21Prev = indicators.ema21[index - 1];
  const emaScore = finite(e9, e21, e9Prev, e21Prev)
    ? e9 > e21 && e9 > e9Prev && e21 > e21Prev
      ? 1
      : e9 < e21 && e9 < e9Prev && e21 < e21Prev
        ? -1
        : 0
    : 0;
  criteria.push(criterion("ema-slope", "EMA9/21 slope", emaScore,
    emaScore > 0 ? "EMA9 > EMA21 and both rising" : emaScore < 0 ? "EMA9 < EMA21 and both falling" : "No aligned EMA slope"));

  const stDirection = indicators.supertrend.direction[index];
  const supertrendScore: -1 | 0 | 1 = stDirection === 1 ? 1 : stDirection === -1 ? -1 : 0;
  criteria.push(criterion("supertrend", "Supertrend", supertrendScore,
    supertrendScore > 0 ? "Supertrend bullish" : supertrendScore < 0 ? "Supertrend bearish" : "Supertrend unavailable"));

  const lower = indicators.bollinger.lower[index];
  const upper = indicators.bollinger.upper[index];
  const lowerPrev = indicators.bollinger.lower[index - 1];
  const upperPrev = indicators.bollinger.upper[index - 1];
  const bullishReentry = finite(candle.low, candle.close, lower) && candle.low <= lower && candle.close > lower &&
    finite(previous.close, lowerPrev) && previous.close <= lowerPrev;
  const bearishReentry = finite(candle.high, candle.close, upper) && candle.high >= upper && candle.close < upper &&
    finite(previous.close, upperPrev) && previous.close >= upperPrev;
  const bbScore: -1 | 0 | 1 = bullishReentry ? 1 : bearishReentry ? -1 : 0;
  criteria.push(criterion("bollinger-reentry", "Bollinger touch / re-entry", bbScore,
    bbScore > 0 ? "Lower-band bullish re-entry" : bbScore < 0 ? "Upper-band bearish re-entry" : "No qualifying band re-entry"));

  const currentVwap = indicators.vwap[index];
  const vwapScore: -1 | 0 | 1 = Number.isFinite(currentVwap)
    ? candle.close > currentVwap ? 1 : candle.close < currentVwap ? -1 : 0
    : 0;
  criteria.push(criterion("vwap-side", "VWAP side", vwapScore,
    vwapScore > 0 ? "Close above UTC-session VWAP" : vwapScore < 0 ? "Close below UTC-session VWAP" : "VWAP unavailable"));

  let volumeSum = 0;
  let volumeCount = 0;
  for (let i = index - 20; i < index; i += 1) {
    if (i >= 0 && Number.isFinite(input.candles[i].volume)) {
      volumeSum += input.candles[i].volume;
      volumeCount += 1;
    }
  }
  const volumeAverage = volumeCount === 20 ? volumeSum / 20 : NAN;
  const obv = indicators.obv[index];
  const obvPrev = indicators.obv[index - 1];
  const volumeSpike = finite(candle.volume, volumeAverage) && candle.volume > 1.5 * volumeAverage;
  const volumeScore: -1 | 0 | 1 = volumeSpike && finite(obv, obvPrev)
    ? obv > obvPrev ? 1 : obv < obvPrev ? -1 : 0
    : 0;
  criteria.push(criterion("volume-obv", "Volume spike + OBV", volumeScore,
    !volumeSpike ? "Volume is not >1.5× preceding 20-bar average" : volumeScore > 0 ? "Volume spike with rising OBV" : volumeScore < 0 ? "Volume spike with falling OBV" : "Volume spike but OBV neutral"));

  const rsi = indicators.rsi14[index];
  const k = indicators.stochRsi.k[index];
  const d = indicators.stochRsi.d[index];
  const kPrev = indicators.stochRsi.k[index - 1];
  const dPrev = indicators.stochRsi.d[index - 1];
  const oscillatorBand = finite(rsi) && rsi >= 40 && rsi <= 60;
  const bullishCross = finite(k, d, kPrev, dPrev) && k > d && kPrev <= dPrev && kPrev < 20;
  const bearishCross = finite(k, d, kPrev, dPrev) && k < d && kPrev >= dPrev && kPrev > 80;
  const oscillatorScore: -1 | 0 | 1 = oscillatorBand && bullishCross ? 1 : oscillatorBand && bearishCross ? -1 : 0;
  criteria.push(criterion("oscillator", "RSI 40–60 + StochRSI cross", oscillatorScore,
    oscillatorScore > 0 ? "Mid-band RSI with bullish StochRSI cross from oversold" : oscillatorScore < 0 ? "Mid-band RSI with bearish StochRSI cross from overbought" : "No qualifying oscillator confluence"));

  const score = criteria.reduce((sum, item) => sum + item.score, 0);
  const direction: Direction = score >= 5 && input.fourHourBias === "BULLISH"
    ? "LONG"
    : score >= 4 && input.oneHourBias === "BULLISH"
      ? "LONG"
      : score <= -5 && input.fourHourBias === "BEARISH"
        ? "SHORT"
        : score <= -4 && input.oneHourBias === "BEARISH"
          ? "SHORT"
          : "NEUTRAL";

  const atrValue = indicators.atr14[index];
  if (!Number.isFinite(atrValue) || atrValue <= 0) throw new Error("ATR14 unavailable for risk levels");
  const entry = candle.close;
  const stopLoss = direction === "LONG" ? entry - 1.5 * atrValue : direction === "SHORT" ? entry + 1.5 * atrValue : entry;
  const takeProfit = direction === "LONG" ? entry + 3 * atrValue : direction === "SHORT" ? entry - 3 * atrValue : entry;

  return {
    direction,
    score,
    confluenceStrength: (Math.abs(score) / 7) * 100,
    criteria,
    entry,
    stopLoss,
    takeProfit,
    timestamp: candle.closeTime,
    primaryBias: direction === "LONG" ? "BULLISH" : direction === "SHORT" ? "BEARISH" : "UNKNOWN",
    oneHourBias: input.oneHourBias,
    fourHourBias: input.fourHourBias,
  };
}
