/**
 * Classic Supertrend indicator (Pine v4 style).
 * Public-domain algorithm; no third-party license claim.
 */

import type { Candle } from "../contracts";

export type SupertrendConfig = {
  atrPeriod: number;
  multiplier: number;
  useWilderAtr: boolean;
};

export const DEFAULT_SUPERTREND_CONFIG: SupertrendConfig = {
  atrPeriod: 10,
  multiplier: 3,
  useWilderAtr: true,
};

export type SupertrendResult = {
  trend: Array<1 | -1>;
  upper: Array<number | null>;
  lower: Array<number | null>;
  buySignal: boolean;
  sellSignal: boolean;
  lastTrend: 1 | -1;
  lastLevel: number | null;
};

/**
 * True range at index i.
 */
function tr(candles: Candle[], i: number): number {
  if (i === 0) return candles[0].high - candles[0].low;
  const c = candles[i];
  const pc = candles[i - 1].close;
  return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
}

/**
 * ATR series (Wilder or SMA of TR).
 */
function atrSeries(
  candles: Candle[],
  period: number,
  wilder: boolean
): number[] {
  const n = candles.length;
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = tr(candles, i);
    if (i < period) {
      sum += v;
      out.push(sum / (i + 1));
    } else if (wilder) {
      const prev = out[i - 1];
      out.push((prev * (period - 1) + v) / period);
    } else {
      sum += v - tr(candles, i - period);
      out.push(sum / period);
    }
  }
  return out;
}

/**
 * Computes Supertrend bands and trend direction for the window.
 */
export function computeSupertrend(
  candles: Candle[],
  cfg: SupertrendConfig = DEFAULT_SUPERTREND_CONFIG
): SupertrendResult {
  const n = candles.length;
  const empty: SupertrendResult = {
    trend: [],
    upper: [],
    lower: [],
    buySignal: false,
    sellSignal: false,
    lastTrend: 1,
    lastLevel: null,
  };
  if (n < cfg.atrPeriod + 2) return empty;

  const atr = atrSeries(candles, cfg.atrPeriod, cfg.useWilderAtr);
  const trend: Array<1 | -1> = [];
  const upper: Array<number | null> = [];
  const lower: Array<number | null> = [];

  let up = 0;
  let dn = 0;
  let t: 1 | -1 = 1;

  for (let i = 0; i < n; i++) {
    const src = (candles[i].high + candles[i].low) / 2;
    const basicUp = src - cfg.multiplier * atr[i];
    const basicDn = src + cfg.multiplier * atr[i];

    if (i === 0) {
      up = basicUp;
      dn = basicDn;
      t = 1;
    } else {
      const prevClose = candles[i - 1].close;
      up = prevClose > up ? Math.max(basicUp, up) : basicUp;
      dn = prevClose < dn ? Math.min(basicDn, dn) : basicDn;
      if (t === -1 && candles[i].close > dn) t = 1;
      else if (t === 1 && candles[i].close < up) t = -1;
    }
    trend.push(t);
    upper.push(t === 1 ? up : null);
    lower.push(t === -1 ? dn : null);
  }

  const last = n - 1;
  const buySignal = last > 0 && trend[last] === 1 && trend[last - 1] === -1;
  const sellSignal = last > 0 && trend[last] === -1 && trend[last - 1] === 1;
  const lastLevel =
    trend[last] === 1 ? upper[last] : lower[last];

  return {
    trend,
    upper,
    lower,
    buySignal,
    sellSignal,
    lastTrend: trend[last],
    lastLevel,
  };
}
