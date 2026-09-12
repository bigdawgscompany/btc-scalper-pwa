/**
 * UT Bot trailing-stop signals (Pine v4 style).
 * Public-domain algorithm commonly attributed to community scripts.
 */

import type { Candle } from "../contracts";

export type UtBotConfig = {
  keyValue: number;
  atrPeriod: number;
};

export const DEFAULT_UTBOT_CONFIG: UtBotConfig = {
  keyValue: 1,
  atrPeriod: 10,
};

export type UtBotResult = {
  trailingStop: Array<number | null>;
  position: Array<1 | -1 | 0>;
  buy: boolean;
  sell: boolean;
  lastStop: number | null;
  lastPosition: 1 | -1 | 0;
};

/**
 * Wilder ATR at each bar.
 */
function atrSeries(candles: Candle[], period: number): number[] {
  const out: number[] = [];
  let prev = candles[0].high - candles[0].low;
  out.push(prev);
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const pc = candles[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - pc),
      Math.abs(c.low - pc)
    );
    prev = (prev * (period - 1) + tr) / period;
    out.push(prev);
  }
  return out;
}

/**
 * Computes UT Bot ATR trailing stop and buy/sell flips.
 */
export function computeUtBot(
  candles: Candle[],
  cfg: UtBotConfig = DEFAULT_UTBOT_CONFIG
): UtBotResult {
  const n = candles.length;
  const empty: UtBotResult = {
    trailingStop: [],
    position: [],
    buy: false,
    sell: false,
    lastStop: null,
    lastPosition: 0,
  };
  if (n < cfg.atrPeriod + 2) return empty;

  const atr = atrSeries(candles, cfg.atrPeriod);
  const stops: Array<number | null> = [];
  const pos: Array<1 | -1 | 0> = [];
  let stop = 0;
  let p: 1 | -1 | 0 = 0;

  for (let i = 0; i < n; i++) {
    const src = candles[i].close;
    const nLoss = cfg.keyValue * atr[i];
    if (i === 0) {
      stop = src - nLoss;
      p = 0;
    } else {
      const prevSrc = candles[i - 1].close;
      const prevStop = stop;
      if (src > prevStop && prevSrc > prevStop) {
        stop = Math.max(prevStop, src - nLoss);
      } else if (src < prevStop && prevSrc < prevStop) {
        stop = Math.min(prevStop, src + nLoss);
      } else if (src > prevStop) {
        stop = src - nLoss;
      } else {
        stop = src + nLoss;
      }
      if (prevSrc < prevStop && src > prevStop) p = 1;
      else if (prevSrc > prevStop && src < prevStop) p = -1;
    }
    stops.push(stop);
    pos.push(p);
  }

  const last = n - 1;
  // Buy: price above stop and EMA(1)=close crosses above stop
  const above =
    last > 0 &&
    candles[last - 1].close <= (stops[last - 1] ?? 0) &&
    candles[last].close > (stops[last] ?? 0);
  const below =
    last > 0 &&
    candles[last - 1].close >= (stops[last - 1] ?? 0) &&
    candles[last].close < (stops[last] ?? 0);
  const buy = candles[last].close > (stops[last] ?? 0) && above;
  const sell = candles[last].close < (stops[last] ?? 0) && below;

  return {
    trailingStop: stops,
    position: pos,
    buy,
    sell,
    lastStop: stops[last] ?? null,
    lastPosition: pos[last] ?? 0,
  };
}
