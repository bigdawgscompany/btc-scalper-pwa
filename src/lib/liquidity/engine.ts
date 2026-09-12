/**
 * Liquidity Delta Profiler engine.
 *
 * Ported from "Liquidity Delta Profiler [LuxAlgo]" (Pine v6).
 * License: CC BY-NC-SA 4.0 — © LuxAlgo
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 *
 * Drawing omitted; returns structured zones and reversal signals.
 */

import type { Candle } from "../contracts";
import {
  DEFAULT_LIQUIDITY_CONFIG,
  type LiquidityConfig,
  type LiquidityProfilerResult,
  type LiquiditySide,
  type LiquidityZone,
  type ReversalSignal,
  type ReversalSignalType,
} from "./types";

/**
 * ATR(14) last value for minimum zone height.
 */
function lastAtr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  let sum = 0;
  const start = Math.max(1, candles.length - period);
  for (let i = start; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  return sum / Math.min(period, candles.length - 1);
}

/**
 * Simple volume SMA ending at index.
 */
function volSmaAt(candles: Candle[], index: number, len: number): number {
  const start = Math.max(0, index - len + 1);
  let s = 0;
  let c = 0;
  for (let i = start; i <= index; i++) {
    s += candles[i].volume;
    c += 1;
  }
  return c > 0 ? s / c : 1;
}

/**
 * Approximate bar delta from candle body and range.
 */
function barDelta(c: Candle): number {
  const range = c.high - c.low;
  if (range <= 0) return 0;
  return (c.volume * (c.close - c.open)) / range;
}

/**
 * Overlap length between bar range and a quadrant band.
 */
function bandOverlap(
  barH: number,
  barL: number,
  qTop: number,
  qBot: number
): number {
  const top = Math.min(barH, qTop);
  const bot = Math.max(barL, qBot);
  return top > bot ? top - bot : 0;
}

/**
 * Creates an empty zone shell for a pivot extreme.
 */
function createZone(
  side: LiquiditySide,
  top: number,
  bottom: number,
  pivotIdx: number,
  capacity: number
): LiquidityZone {
  return {
    side,
    top,
    bottom,
    leftIndex: pivotIdx,
    rightIndex: pivotIdx,
    swept: false,
    signaled: false,
    deltas: [0, 0, 0, 0],
    volumeTraded: 0,
    capacity,
    healthPct: 100,
    wasHit: false,
  };
}

/**
 * True when two price bands overlap.
 */
function bandsOverlap(
  aTop: number,
  aBot: number,
  bTop: number,
  bBot: number
): boolean {
  return Math.max(aBot, bBot) <= Math.min(aTop, bTop);
}

/**
 * Evaluates ABS/EXH/DIV/REJ reversal conditions for one zone hit.
 */
export function evaluateReversal(
  z: LiquidityZone,
  isBsl: boolean,
  bar: Candle,
  barIndex: number,
  delta: number,
  vol: number
): ReversalSignal | null {
  if (z.signaled) return null;
  const absTotalD = z.deltas.reduce((s, d) => s + Math.abs(d), 0);
  if (absTotalD <= 0) return null;

  const outerIdx = isBsl ? 3 : 0;
  const outerD = z.deltas[outerIdx];
  const isSweeping = isBsl ? bar.high > z.top : bar.low < z.bottom;
  const closesInside =
    bar.close <= z.top && bar.close >= z.bottom;
  const mid = (z.top + z.bottom) / 2;
  const closesRejecting = isBsl ? bar.close < mid : bar.close > mid;

  let type: ReversalSignalType | "" = "";
  let tooltip = "";
  let significance = 0;

  if (isSweeping && ((isBsl && outerD < 0) || (!isBsl && outerD > 0))) {
    const ratio = Math.abs(outerD) / (absTotalD + 1e-9);
    if (ratio > 0.2) {
      type = "ABS";
      tooltip = `Absorption at extreme — ${isBsl ? "sellers" : "buyers"} absorbed the sweep.`;
      significance = ratio * 2;
    }
  }

  if (type === "" && isSweeping) {
    const ratio = Math.abs(outerD) / (absTotalD + 1e-9);
    if (ratio < 0.1) {
      type = "EXH";
      tooltip = "Exhaustion (dry sweep) — minimal volume at the extreme edge.";
      significance = 1 - ratio * 5;
    }
  }

  if (type === "" && closesInside) {
    const ratio = Math.abs(outerD) / (absTotalD + 1e-9);
    if (
      ratio > 0.6 &&
      ((isBsl && outerD > 0) || (!isBsl && outerD < 0))
    ) {
      type = "DIV";
      tooltip =
        "Delta divergence (FOMO) — high volume trapped, failed breakout.";
      significance = ratio;
    }
  }

  if (type === "" && isSweeping && closesRejecting) {
    const barRatio = Math.abs(delta) / (vol + 1e-9);
    if (
      ((isBsl && delta < 0) || (!isBsl && delta > 0)) &&
      barRatio > 0.2
    ) {
      type = "REJ";
      tooltip = "Snapback rejection — sweep then strong opposing delta.";
      significance = barRatio * 2;
    }
  }

  if (type === "") return null;

  return {
    type,
    side: isBsl ? "BSL" : "SSL",
    barIndex,
    price: bar.close,
    direction: isBsl ? -1 : 1,
    tooltip,
    significance: Math.min(Math.max(significance, 0), 1),
  };
}

/**
 * Accumulates volume delta into zone quadrants for the current bar.
 */
function accumulateZoneDelta(
  z: LiquidityZone,
  bar: Candle,
  delta: number
): boolean {
  const range = bar.high - bar.low;
  const step = (z.top - z.bottom) / 4;
  if (step <= 0) return false;
  let hit = false;
  for (let j = 0; j < 4; j++) {
    const qBot = z.bottom + j * step;
    const qTop = z.bottom + (j + 1) * step;
    const overlap = bandOverlap(bar.high, bar.low, qTop, qBot);
    if (overlap > 0) {
      hit = true;
      const ratio = range === 0 ? 0 : overlap / range;
      z.deltas[j] += delta * ratio;
      z.volumeTraded += bar.volume * ratio;
    }
  }
  if (z.capacity > 0) {
    z.healthPct = Math.max(
      0,
      Math.round(100 - (z.volumeTraded / z.capacity) * 100)
    );
  }
  return hit;
}

/**
 * Detects pivot high at confirmed bar (index - length).
 */
function pivotHighAt(
  candles: Candle[],
  i: number,
  length: number
): number | null {
  if (i < length || i + length >= candles.length) return null;
  const mid = i;
  const hi = candles[mid].high;
  for (let j = mid - length; j <= mid + length; j++) {
    if (j === mid) continue;
    if (candles[j].high >= hi) return null;
  }
  return hi;
}

/**
 * Detects pivot low at confirmed bar.
 */
function pivotLowAt(
  candles: Candle[],
  i: number,
  length: number
): number | null {
  if (i < length || i + length >= candles.length) return null;
  const mid = i;
  const lo = candles[mid].low;
  for (let j = mid - length; j <= mid + length; j++) {
    if (j === mid) continue;
    if (candles[j].low <= lo) return null;
  }
  return lo;
}

/**
 * Runs the liquidity profiler over a confirmed candle window.
 */
export function computeLiquidityProfile(
  candles: Candle[],
  cfg: LiquidityConfig = DEFAULT_LIQUIDITY_CONFIG
): LiquidityProfilerResult {
  const attribution =
    "Liquidity Delta Profiler ported from LuxAlgo (CC BY-NC-SA 4.0)";
  const empty: LiquidityProfilerResult = {
    bslZones: [],
    sslZones: [],
    signals: [],
    stats: {
      absTotal: 0,
      absWins: 0,
      exhTotal: 0,
      exhWins: 0,
      divTotal: 0,
      divWins: 0,
      rejTotal: 0,
      rejWins: 0,
    },
    attribution,
  };
  if (candles.length < cfg.pivotLength * 2 + 5) return empty;

  const bsl: LiquidityZone[] = [];
  const ssl: LiquidityZone[] = [];
  const signals: ReversalSignal[] = [];
  const atrSeed = lastAtr(candles);

  // Confirm pivots only when right-side lookforward exists.
  for (let i = cfg.pivotLength; i < candles.length - cfg.pivotLength; i++) {
    const ph = pivotHighAt(candles, i, cfg.pivotLength);
    const pl = pivotLowAt(candles, i, cfg.pivotLength);
    const avgVol = volSmaAt(candles, i, cfg.pivotLength);
    const cap = Math.max(avgVol, 1) * cfg.zoneCapacityMult;
    const atr = atrSeed > 0 ? atrSeed : candles[i].high - candles[i].low;

    if (ph !== null) {
      let pBot = Math.max(candles[i].close, candles[i].open);
      if (ph - pBot < atr * 0.1) pBot = ph - atr * 0.1;
      let skip = false;
      if (cfg.filterOverlaps) {
        for (let k = bsl.length - 1; k >= 0; k--) {
          const ex = bsl[k];
          if (ex.swept) continue;
          if (bandsOverlap(ph, pBot, ex.top, ex.bottom)) {
            if (ph > ex.top) bsl.splice(k, 1);
            else {
              skip = true;
              break;
            }
          }
        }
      }
      if (!skip) {
        bsl.unshift(createZone("BSL", ph, pBot, i, cap));
        if (bsl.length > cfg.maxZonesPerType) bsl.pop();
      }
    }

    if (pl !== null) {
      let pTop = Math.min(candles[i].close, candles[i].open);
      if (pTop - pl < atr * 0.1) pTop = pl + atr * 0.1;
      let skip = false;
      if (cfg.filterOverlaps) {
        for (let k = ssl.length - 1; k >= 0; k--) {
          const ex = ssl[k];
          if (ex.swept) continue;
          if (bandsOverlap(pTop, pl, ex.top, ex.bottom)) {
            if (pl < ex.bottom) ssl.splice(k, 1);
            else {
              skip = true;
              break;
            }
          }
        }
      }
      if (!skip) {
        ssl.unshift(createZone("SSL", pTop, pl, i, cap));
        if (ssl.length > cfg.maxZonesPerType) ssl.pop();
      }
    }
  }

  // Walk forward from first pivot opportunity to accumulate deltas / sweeps.
  const start = cfg.pivotLength;
  for (let i = start; i < candles.length; i++) {
    const bar = candles[i];
    const delta = barDelta(bar);
    for (const z of bsl) {
      if (z.swept || z.leftIndex > i) continue;
      z.rightIndex = i;
      const hit = accumulateZoneDelta(z, bar, delta);
      if (bar.high > z.top) z.swept = true;
      if ((hit || z.swept) && cfg.enableReversals) {
        const sig = evaluateReversal(z, true, bar, i, delta, bar.volume);
        if (sig) {
          z.signaled = true;
          signals.push(sig);
        }
      }
      z.wasHit = hit;
    }
    for (const z of ssl) {
      if (z.swept || z.leftIndex > i) continue;
      z.rightIndex = i;
      const hit = accumulateZoneDelta(z, bar, delta);
      if (bar.low < z.bottom) z.swept = true;
      if ((hit || z.swept) && cfg.enableReversals) {
        const sig = evaluateReversal(z, false, bar, i, delta, bar.volume);
        if (sig) {
          z.signaled = true;
          signals.push(sig);
        }
      }
      z.wasHit = hit;
    }
  }

  const visibleBsl = cfg.showSwept ? bsl : bsl.filter((z) => !z.swept);
  const visibleSsl = cfg.showSwept ? ssl : ssl.filter((z) => !z.swept);

  return {
    bslZones: visibleBsl,
    sslZones: visibleSsl,
    signals,
    stats: empty.stats,
    attribution,
  };
}
