import type { Candle, IndicatorValues } from "./contracts";

/**
 * Simple Moving Average over a slice of numbers.
 */
export function sma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null;
  const slice = values.slice(-period);
  const sum = slice.reduce((acc, val) => acc + val, 0);
  return sum / period;
}

/**
 * Exponential Moving Average Series across an array of numbers.
 * Seeded with SMA of the first `period` elements.
 */
export function emaSeries(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period || period <= 0) return result;

  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let prevEma = sum / period;
  result[period - 1] = prevEma;

  for (let i = period; i < values.length; i++) {
    prevEma = values[i] * k + prevEma * (1 - k);
    result[i] = prevEma;
  }
  return result;
}

/**
 * Wilder's RSI (14 period default)
 * Flat / zero volatility returns 50.
 */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else if (diff < 0) losses += -diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgGain === 0 && avgLoss === 0) return 50; // flat
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Stochastic Oscillator (%K and %D)
 * Zero-range returns neutral %K = 50.
 */
export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  dPeriod = 3
): { k: number | null; d: number | null } {
  if (closes.length < kPeriod) return { k: null, d: null };

  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const highSlice = highs.slice(i - kPeriod + 1, i + 1);
    const lowSlice = lows.slice(i - kPeriod + 1, i + 1);
    const highest = Math.max(...highSlice);
    const lowest = Math.min(...lowSlice);
    const range = highest - lowest;
    const k = range === 0 ? 50 : ((closes[i] - lowest) / range) * 100;
    kValues.push(k);
  }

  const k = kValues[kValues.length - 1];
  const d = sma(kValues, dPeriod);
  return { k, d };
}

/**
 * MACD (12, 26, 9)
 * Available from 34 samples.
 */
export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): {
  macdLine: number | null;
  signalLine: number | null;
  histogram: number | null;
} {
  if (closes.length < slowPeriod + signalPeriod - 1) {
    return { macdLine: null, signalLine: null, histogram: null };
  }

  const fastEma = emaSeries(closes, fastPeriod);
  const slowEma = emaSeries(closes, slowPeriod);

  const macdLineSeries: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const f = fastEma[i];
    const s = slowEma[i];
    if (f !== null && s !== null) {
      macdLineSeries.push(f - s);
    }
  }

  if (macdLineSeries.length < signalPeriod) {
    return { macdLine: null, signalLine: null, histogram: null };
  }

  const signalLineSeries = emaSeries(macdLineSeries, signalPeriod);
  const lastMacd = macdLineSeries[macdLineSeries.length - 1];
  const lastSignal = signalLineSeries[signalLineSeries.length - 1];

  if (lastMacd === undefined || lastSignal === null) {
    return { macdLine: null, signalLine: null, histogram: null };
  }

  return {
    macdLine: lastMacd,
    signalLine: lastSignal,
    histogram: lastMacd - lastSignal,
  };
}

/**
 * Commodity Channel Index (CCI)
 * Zero mean deviation returns 0.
 */
export function cci(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 20
): number | null {
  if (closes.length < period) return null;
  const tps = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const slice = tps.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const meanDev = slice.reduce((a, b) => a + Math.abs(b - mean), 0) / period;

  if (meanDev === 0) return 0;
  const currentTp = tps[tps.length - 1];
  return (currentTp - mean) / (0.015 * meanDev);
}

/**
 * Williams %R
 * Zero range returns -50.
 */
export function williamsR(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14
): number | null {
  if (closes.length < period) return null;
  const highSlice = highs.slice(-period);
  const lowSlice = lows.slice(-period);
  const highest = Math.max(...highSlice);
  const lowest = Math.min(...lowSlice);
  const range = highest - lowest;
  if (range === 0) return -50;
  return ((highest - closes[closes.length - 1]) / range) * -100;
}

/**
 * Compute all 6 technical indicator values from a candle array.
 */
export function computeIndicators(candles: Candle[]): IndicatorValues {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const stoch = stochastic(highs, lows, closes, 14, 3);
  const macdVal = macd(closes, 12, 26, 9);

  return {
    rsi: rsi(closes, 14),
    cci: cci(highs, lows, closes, 20),
    macdHist: macdVal.histogram,
    macdLine: macdVal.macdLine,
    signalLine: macdVal.signalLine,
    stochK: stoch.k,
    stochD: stoch.d,
    willR: williamsR(highs, lows, closes, 14),
  };
}