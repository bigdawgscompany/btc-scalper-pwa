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

/** Exponential moving average series (all values) */
export function emaSeries(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;

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

/** Complete MACD calculation */
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
  if (closes.length < slowPeriod + signalPeriod) {
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

/** MACD histogram (12, 26, 9) */
export function macdHistogram(closes: number[]): number | null {
  return macd(closes).histogram;
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