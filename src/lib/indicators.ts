import type { Candle } from "./types";

/** Simple moving average */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Exponential moving average (last value) */
export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

/** RSI (Wilder) */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
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

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Stochastic %K and %D */
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

/** MACD histogram (12, 26, 9) */
export function macdHistogram(closes: number[]): number | null {
  if (closes.length < 35) return null; // enough for stable EMA
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  if (ema12 === null || ema26 === null) return null;
  const macdLine = ema12 - ema26;

  // Approximate signal line by building MACD series then EMA9
  const macdSeries: number[] = [];
  for (let i = 26; i <= closes.length; i++) {
    const e12 = ema(closes.slice(0, i), 12);
    const e26 = ema(closes.slice(0, i), 26);
    if (e12 !== null && e26 !== null) macdSeries.push(e12 - e26);
  }
  const signal = ema(macdSeries, 9);
  if (signal === null) return null;
  return macdLine - signal;
}

/** Commodity Channel Index */
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
  const meanDev =
    slice.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
  if (meanDev === 0) return 0;
  const currentTp = tps[tps.length - 1];
  return (currentTp - mean) / (0.015 * meanDev);
}

/** Williams %R */
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

/** Extract series from candles */
export function extractSeries(candles: Candle[]) {
  return {
    closes: candles.map((c) => c.close),
    highs: candles.map((c) => c.high),
    lows: candles.map((c) => c.low),
    volumes: candles.map((c) => c.volume),
  };
}