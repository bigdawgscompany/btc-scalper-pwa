/**
 * Deterministic, allocation-light technical indicators.
 * Every output preserves input length and emits NaN during warm-up.
 * No network, clock, mutable global state, or look-ahead access is allowed.
 */

import type {
  BollingerResult,
  IndicatorSet,
  MacdResult,
  OhlcvCandle,
  StochRsiResult,
  SupertrendResult,
} from "./types";

const NAN = Number.NaN;

function assertPeriod(period: number): void {
  if (!Number.isInteger(period) || period < 1) throw new Error(`Invalid period: ${period}`);
}

function sma(values: readonly number[], period: number): number[] {
  assertPeriod(period);
  const out = Array<number>(values.length).fill(NAN);
  let sum = 0;
  let validCount = 0;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (Number.isFinite(value)) {
      sum += value;
      validCount += 1;
    }

    if (i >= period) {
      const old = values[i - period];
      if (Number.isFinite(old)) {
        sum -= old;
        validCount -= 1;
      }
    }

    if (i >= period - 1 && validCount === period) out[i] = sum / period;
  }
  return out;
}

/** Wilder/RMA average with an SMA seed. */
function rma(values: readonly number[], period: number): number[] {
  assertPeriod(period);
  const out = Array<number>(values.length).fill(NAN);
  let seed = 0;
  let count = 0;
  let previous = NAN;
  const alpha = 1 / period;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;

    if (!Number.isFinite(previous)) {
      seed += value;
      count += 1;
      if (count === period) {
        previous = seed / period;
        out[i] = previous;
      }
    } else {
      previous += alpha * (value - previous);
      out[i] = previous;
    }
  }
  return out;
}

export function ema(values: readonly number[], period: number): number[] {
  assertPeriod(period);
  const out = Array<number>(values.length).fill(NAN);
  const alpha = 2 / (period + 1);
  let seed = 0;
  let count = 0;
  let previous = NAN;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;

    if (!Number.isFinite(previous)) {
      seed += value;
      count += 1;
      if (count === period) {
        previous = seed / period;
        out[i] = previous;
      }
    } else {
      previous += alpha * (value - previous);
      out[i] = previous;
    }
  }
  return out;
}

export function trueRange(candles: readonly OhlcvCandle[]): number[] {
  const out = Array<number>(candles.length).fill(NAN);
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    if (![c.high, c.low, c.close].every(Number.isFinite)) continue;
    if (i === 0) {
      out[i] = c.high - c.low;
      continue;
    }
    const prevClose = candles[i - 1].close;
    if (!Number.isFinite(prevClose)) continue;
    out[i] = Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  }
  return out;
}

export function atr(candles: readonly OhlcvCandle[], period = 14): number[] {
  return rma(trueRange(candles), period);
}

export function rsi(closes: readonly number[], period = 14): number[] {
  assertPeriod(period);
  const gains = Array<number>(closes.length).fill(NAN);
  const losses = Array<number>(closes.length).fill(NAN);

  for (let i = 1; i < closes.length; i += 1) {
    const current = closes[i];
    const previous = closes[i - 1];
    if (!Number.isFinite(current) || !Number.isFinite(previous)) continue;
    const delta = current - previous;
    gains[i] = Math.max(delta, 0);
    losses[i] = Math.max(-delta, 0);
  }

  const avgGain = rma(gains, period);
  const avgLoss = rma(losses, period);
  const out = Array<number>(closes.length).fill(NAN);

  for (let i = 0; i < closes.length; i += 1) {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (!Number.isFinite(g) || !Number.isFinite(l)) continue;
    if (l === 0) out[i] = g === 0 ? 50 : 100;
    else out[i] = 100 - 100 / (1 + g / l);
  }
  return out;
}

export function macd(
  closes: readonly number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdResult {
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);
  const line = Array<number>(closes.length).fill(NAN);
  for (let i = 0; i < closes.length; i += 1) {
    if (Number.isFinite(fast[i]) && Number.isFinite(slow[i])) line[i] = fast[i] - slow[i];
  }
  const signal = ema(line, signalPeriod);
  const histogram = line.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : NAN,
  );
  return { macd: line, signal, histogram };
}

/** UTC-calendar-session VWAP: accumulation resets at 00:00:00 UTC. */
export function vwap(candles: readonly OhlcvCandle[]): number[] {
  const out = Array<number>(candles.length).fill(NAN);
  let sessionDay = -1;
  let cumulativePV = 0;
  let cumulativeVolume = 0;

  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    const day = Math.floor(c.openTime / 86_400_000);
    if (day !== sessionDay) {
      sessionDay = day;
      cumulativePV = 0;
      cumulativeVolume = 0;
    }
    const typical = (c.high + c.low + c.close) / 3;
    if (!Number.isFinite(typical) || !Number.isFinite(c.volume) || c.volume < 0) continue;
    cumulativePV += typical * c.volume;
    cumulativeVolume += c.volume;
    out[i] = cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : typical;
  }
  return out;
}

export function bollinger(
  closes: readonly number[],
  period = 20,
  standardDeviations = 2,
): BollingerResult {
  const middle = sma(closes, period);
  const upper = Array<number>(closes.length).fill(NAN);
  const lower = Array<number>(closes.length).fill(NAN);

  for (let i = period - 1; i < closes.length; i += 1) {
    const mean = middle[i];
    if (!Number.isFinite(mean)) continue;
    let sumSquared = 0;
    let valid = true;
    for (let j = i - period + 1; j <= i; j += 1) {
      if (!Number.isFinite(closes[j])) {
        valid = false;
        break;
      }
      sumSquared += (closes[j] - mean) ** 2;
    }
    if (!valid) continue;
    const std = Math.sqrt(sumSquared / period);
    upper[i] = mean + standardDeviations * std;
    lower[i] = mean - standardDeviations * std;
  }
  return { middle, upper, lower };
}

export function supertrend(
  candles: readonly OhlcvCandle[],
  atrPeriod = 10,
  multiplier = 3,
): SupertrendResult {
  const atrValues = atr(candles, atrPeriod);
  const value = Array<number>(candles.length).fill(NAN);
  const direction = Array<(1 | -1 | 0)>(candles.length).fill(0);
  const finalUpper = Array<number>(candles.length).fill(NAN);
  const finalLower = Array<number>(candles.length).fill(NAN);

  let previousDirection: 1 | -1 | 0 = 0;

  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    const a = atrValues[i];
    if (!Number.isFinite(a)) continue;

    const midpoint = (c.high + c.low) / 2;
    const basicUpper = midpoint + multiplier * a;
    const basicLower = midpoint - multiplier * a;

    if (i === 0 || !Number.isFinite(finalUpper[i - 1]) || !Number.isFinite(finalLower[i - 1])) {
      finalUpper[i] = basicUpper;
      finalLower[i] = basicLower;
      previousDirection = c.close >= midpoint ? 1 : -1;
    } else {
      const prevClose = candles[i - 1].close;
      finalUpper[i] = basicUpper < finalUpper[i - 1] || prevClose > finalUpper[i - 1]
        ? basicUpper
        : finalUpper[i - 1];
      finalLower[i] = basicLower > finalLower[i - 1] || prevClose < finalLower[i - 1]
        ? basicLower
        : finalLower[i - 1];

      if (previousDirection <= 0 && c.close > finalUpper[i - 1]) previousDirection = 1;
      else if (previousDirection >= 0 && c.close < finalLower[i - 1]) previousDirection = -1;
    }

    direction[i] = previousDirection;
    value[i] = previousDirection === 1 ? finalLower[i] : finalUpper[i];
  }

  return { value, direction };
}

export function stochRsi(
  rsiValues: readonly number[],
  stochPeriod = 14,
  kPeriod = 3,
  dPeriod = 3,
): StochRsiResult {
  assertPeriod(stochPeriod);
  const raw = Array<number>(rsiValues.length).fill(NAN);

  for (let i = stochPeriod - 1; i < rsiValues.length; i += 1) {
    let low = Infinity;
    let high = -Infinity;
    let valid = true;
    for (let j = i - stochPeriod + 1; j <= i; j += 1) {
      const value = rsiValues[j];
      if (!Number.isFinite(value)) {
        valid = false;
        break;
      }
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
    if (!valid) continue;
    raw[i] = high === low ? 50 : ((rsiValues[i] - low) / (high - low)) * 100;
  }

  const k = sma(raw, kPeriod);
  const d = sma(k, dPeriod);
  return { k, d };
}

export function obv(candles: readonly OhlcvCandle[]): number[] {
  const out = Array<number>(candles.length).fill(NAN);
  if (candles.length === 0) return out;
  let total = 0;
  out[0] = 0;

  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    if (![current.close, previous.close, current.volume].every(Number.isFinite) || current.volume < 0) continue;
    if (current.close > previous.close) total += current.volume;
    else if (current.close < previous.close) total -= current.volume;
    out[i] = total;
  }
  return out;
}

export function computeIndicators(candles: readonly OhlcvCandle[]): IndicatorSet {
  const closes = candles.map((c) => c.close);
  const rsi14 = rsi(closes, 14);
  return {
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi14,
    macd: macd(closes, 12, 26, 9),
    vwap: vwap(candles),
    bollinger: bollinger(closes, 20, 2),
    supertrend: supertrend(candles, 10, 3),
    atr14: atr(candles, 14),
    stochRsi: stochRsi(rsi14, 14, 3, 3),
    obv: obv(candles),
  };
}
