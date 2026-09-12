/**
 * Dynamic Swing Anchored VWAP engine.
 *
 * Ported from "Dynamic Swing Anchored VWAP (Zeiierman)" (Pine v6).
 * License: CC BY-NC-SA 4.0 — © Zeiierman
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 *
 * Complexity of each exported function is kept low; pure math only.
 */

import type { Candle } from "../contracts";
import {
  DEFAULT_SWING_VWAP_CONFIG,
  type SwingDirection,
  type SwingLabel,
  type SwingPivot,
  type SwingVwapConfig,
  type SwingVwapResult,
} from "./types";

/**
 * Computes Wilder-style ATR series for adaptive APT scaling.
 */
function atrSeries(candles: Candle[], period: number): number[] {
  const n = candles.length;
  if (n === 0) return [];
  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < n; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i - period];
    const len = Math.min(i + 1, period);
    out.push(sum / len);
  }
  return out;
}

/**
 * RMA (Wilder smoothing) of a numeric series.
 */
function rma(values: number[], period: number): number[] {
  const out: number[] = [];
  if (values.length === 0) return out;
  let prev = values[0];
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out.push(prev);
  }
  return out;
}

/**
 * Converts APT half-life into EWMA alpha.
 */
export function alphaFromApt(apt: number): number {
  const safe = Math.max(1, apt);
  const decay = Math.exp(-Math.LN2 / safe);
  return 1 - decay;
}

/**
 * Clamps adaptive APT into the script's [5, 300] range.
 */
export function clampApt(raw: number): number {
  return Math.max(5, Math.min(300, raw));
}

/**
 * Resolves APT for bar i given ATR ratio and config.
 */
export function resolveApt(
  baseApt: number,
  atrRatio: number,
  cfg: SwingVwapConfig
): number {
  if (!cfg.useAdapt) return clampApt(baseApt);
  const raw = baseApt / Math.pow(Math.max(atrRatio, 1e-9), cfg.volBias);
  return clampApt(raw);
}

/**
 * Classifies swing structure label from direction and prior extreme.
 */
export function classifySwingLabel(
  dir: SwingDirection,
  price: number,
  prevExtreme: number | null
): SwingLabel {
  if (prevExtreme === null || !Number.isFinite(prevExtreme)) return "";
  if (dir > 0) return price < prevExtreme ? "LL" : price > prevExtreme ? "HL" : "";
  return price < prevExtreme ? "LH" : price > prevExtreme ? "HH" : "";
}

/**
 * Finds index of highest high in [i - period + 1, i] or null if not at end.
 */
function isSwingHigh(candles: Candle[], i: number, period: number): boolean {
  if (i < period - 1) return false;
  const hi = candles[i].high;
  for (let j = i - period + 1; j < i; j++) {
    if (candles[j].high >= hi) return false;
  }
  return true;
}

/**
 * Finds index of lowest low in [i - period + 1, i] or null if not at end.
 */
function isSwingLow(candles: Candle[], i: number, period: number): boolean {
  if (i < period - 1) return false;
  const lo = candles[i].low;
  for (let j = i - period + 1; j < i; j++) {
    if (candles[j].low <= lo) return false;
  }
  return true;
}

/**
 * Typical price (hlc3) for a candle.
 */
function hlc3(c: Candle): number {
  return (c.high + c.low + c.close) / 3;
}

/**
 * Builds swing-anchored VWAP series for the candle window.
 * Re-anchors when swing direction flips; applies EWMA tracking per bar.
 */
export function computeSwingAnchoredVwap(
  candles: Candle[],
  cfg: SwingVwapConfig = DEFAULT_SWING_VWAP_CONFIG
): SwingVwapResult {
  const n = candles.length;
  const empty: SwingVwapResult = {
    direction: 1,
    pivots: [],
    vwapSeries: Array.from({ length: n }, () => null),
    lastVwap: null,
    apt: cfg.baseApt,
    atrRatio: 1,
    attribution:
      "Dynamic Swing Anchored VWAP ported from Zeiierman (CC BY-NC-SA 4.0)",
  };
  if (n < cfg.swingPeriod + 2) return empty;

  const atr = atrSeries(candles, cfg.atrLen);
  const atrAvg = rma(atr, cfg.atrLen);
  const series: Array<number | null> = Array.from({ length: n }, () => null);
  const pivots: SwingPivot[] = [];

  let ph = candles[0].high;
  let pl = candles[0].low;
  let phL = 0;
  let plL = 0;
  let prevExtreme: number | null = null;
  let dir: SwingDirection = 1;
  let pSum = hlc3(candles[0]) * Math.max(candles[0].volume, 1e-12);
  let volSum = Math.max(candles[0].volume, 1e-12);
  let lastApt = cfg.baseApt;

  for (let i = 0; i < n; i++) {
    if (isSwingHigh(candles, i, cfg.swingPeriod)) {
      ph = candles[i].high;
      phL = i;
    }
    if (isSwingLow(candles, i, cfg.swingPeriod)) {
      pl = candles[i].low;
      plL = i;
    }
    const newDir: SwingDirection = phL > plL ? 1 : -1;
    const ratio = atrAvg[i] > 0 ? atr[i] / atrAvg[i] : 1;
    lastApt = resolveApt(cfg.baseApt, ratio, cfg);

    if (i > 0 && newDir !== dir) {
      const anchorIdx = newDir > 0 ? plL : phL;
      const anchorPrice = newDir > 0 ? pl : ph;
      const label = classifySwingLabel(newDir, anchorPrice, prevExtreme);
      pivots.push({
        index: anchorIdx,
        price: anchorPrice,
        direction: newDir,
        label,
      });
      prevExtreme = newDir > 0 ? ph : pl;

      // Re-seed cumulative mass from anchor bar, then walk forward with APT.
      const seedVol = Math.max(candles[anchorIdx].volume, 1e-12);
      pSum = anchorPrice * seedVol;
      volSum = seedVol;
      for (let j = anchorIdx; j <= i; j++) {
        const aptJ = resolveApt(
          cfg.baseApt,
          atrAvg[j] > 0 ? atr[j] / atrAvg[j] : 1,
          cfg
        );
        const a = alphaFromApt(aptJ);
        const pxv = hlc3(candles[j]) * Math.max(candles[j].volume, 0);
        const v = Math.max(candles[j].volume, 1e-12);
        pSum = (1 - a) * pSum + a * pxv;
        volSum = (1 - a) * volSum + a * v;
        series[j] = volSum > 0 ? pSum / volSum : null;
      }
      dir = newDir;
    } else {
      const a = alphaFromApt(lastApt);
      const pxv = hlc3(candles[i]) * Math.max(candles[i].volume, 0);
      const v = Math.max(candles[i].volume, 1e-12);
      pSum = (1 - a) * pSum + a * pxv;
      volSum = (1 - a) * volSum + a * v;
      series[i] = volSum > 0 ? pSum / volSum : null;
      dir = newDir;
    }
  }

  const lastVwap = series[n - 1] ?? null;
  const lastRatio =
    atrAvg[n - 1] > 0 ? atr[n - 1] / atrAvg[n - 1] : 1;

  return {
    direction: dir,
    pivots,
    vwapSeries: series,
    lastVwap,
    apt: lastApt,
    atrRatio: lastRatio,
    attribution:
      "Dynamic Swing Anchored VWAP ported from Zeiierman (CC BY-NC-SA 4.0)",
  };
}
