/**
 * Auto Pattern Detector — TypeScript port of detection core from
 * "Auto Pattern Detector Targets [MarkitTick]" (Pine Script v6).
 *
 * CC BY-NC-SA 4.0 — © MarkitTick
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 *
 * Port notes:
 * - Drawing/table/alert APIs omitted; returns structured PatternResult.
 * - Pivot history newest-first (index 0 = most recent confirmed pivot).
 * - Breakout scan uses candle high/low/close vs projected trendline.
 * - ATR(14) and volume SMA computed on the supplied window.
 */

import type { Candle } from "../contracts";
import {
  DEFAULT_PATTERN_CONFIG,
  EMPTY_PATTERN,
  type DetectedPattern,
  type PatternConfig,
  type PatternName,
  type PatternResult,
  type Pivot,
} from "./types";

// ─── Series helpers ────────────────────────────────────────────────────

function atrSeries(candles: Candle[], period = 14): number[] {
  const n = candles.length;
  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < n; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = tr.slice(start, i + 1);
    out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

function volSma(candles: Candle[], len: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const start = Math.max(0, i - len + 1);
    const slice = candles.slice(start, i + 1);
    out.push(slice.reduce((a, c) => a + c.volume, 0) / slice.length);
  }
  return out;
}

function project(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  targetX: number
): number {
  if (x2 === x1) return y1;
  return y1 + ((y2 - y1) / (x2 - x1)) * (targetX - x1);
}

function isNear(v1: number, v2: number, tolPct: number): boolean {
  const mid = (v1 + v2) / 2;
  if (mid === 0) return Math.abs(v1 - v2) < 1e-12;
  return Math.abs(v1 - v2) <= Math.abs(mid) * tolPct;
}

function isValidSize(
  height: number,
  price: number,
  atr: number,
  cfg: PatternConfig
): boolean {
  return height > Math.max(price * cfg.minSizePct, atr * cfg.minAtrMult);
}

function applyStop(
  anchor: number,
  isBull: boolean,
  entry: number,
  target: number,
  atr: number,
  cfg: PatternConfig
): number {
  if (cfg.useSlPctOfTarget && Number.isFinite(entry) && Number.isFinite(target)) {
    const dist = Math.abs(target - entry);
    return isBull ? entry - dist * cfg.slPctOfTarget : entry + dist * cfg.slPctOfTarget;
  }
  return isBull ? anchor - atr * cfg.stopBufferAtr : anchor + atr * cfg.stopBufferAtr;
}

// ─── Pivot collection (confirmed pivots only) ──────────────────────────

export function collectPivots(
  candles: Candle[],
  left: number,
  right: number,
  maxHist: number
): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];
  const n = candles.length;
  // Need left+right bars around candidate
  for (let i = left; i < n - right; i++) {
    const hi = candles[i].high;
    const lo = candles[i].low;
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= hi) isHigh = false;
      if (candles[j].low <= lo) isLow = false;
    }
    if (isHigh) highs.push({ price: hi, index: i });
    if (isLow) lows.push({ price: lo, index: i });
  }
  // Newest first (matches Pine unshift order)
  highs.reverse();
  lows.reverse();
  return {
    highs: highs.slice(0, maxHist),
    lows: lows.slice(0, maxHist),
  };
}

// ─── Breakout finder ───────────────────────────────────────────────────

function getBreakIndex(
  candles: Candle[],
  atr: number[],
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  isUp: boolean,
  cfg: PatternConfig
): number | null {
  const n = candles.length;
  const scanLimit = Math.max(cfg.minBreakLookback, cfg.pivotRight) + 10;
  const m = x2 === x1 ? 0 : (y2 - y1) / (x2 - x1);

  for (let offs = Math.min(scanLimit, n - 1); offs >= 1; offs--) {
    const idx = n - 1 - offs;
    if (idx < 0) continue;
    const barX = idx;
    const projPrice = x2 === x1 ? y1 : y1 + m * (barX - x1);
    const margin = cfg.useAtrBreak
      ? atr[idx] * cfg.breakAtr
      : Math.abs(projPrice) * cfg.breakPct;
    const upThresh = projPrice + margin;
    const downThresh = projPrice - margin;
    const c = candles[idx];
    const checkVal = cfg.requireCloseBreak ? c.close : isUp ? c.high : c.low;
    let isBroken = isUp ? checkVal > upThresh : checkVal < downThresh;

    if (cfg.requireBodyBreak && isBroken) {
      isBroken = isUp
        ? c.open > upThresh && c.close > upThresh
        : c.open < downThresh && c.close < downThresh;
    }

    if (!isBroken) continue;

    let confirmed = true;
    if (cfg.confirmBars > 1) {
      for (let k = 1; k < cfg.confirmBars; k++) {
        const checkIdx = idx + k;
        if (checkIdx >= n) {
          confirmed = false;
          break;
        }
        const projK = x2 === x1 ? y1 : y1 + m * (checkIdx - x1);
        const marginK = cfg.useAtrBreak
          ? atr[checkIdx] * cfg.breakAtr
          : Math.abs(projK) * cfg.breakPct;
        const ck = candles[checkIdx];
        if (isUp && ck.close <= projK + marginK) {
          confirmed = false;
          break;
        }
        if (!isUp && ck.close >= projK - marginK) {
          confirmed = false;
          break;
        }
      }
    }
    if (confirmed) return idx;
  }
  return null;
}

function entryAtBreak(candles: Candle[], breakIdx: number | null): number | null {
  if (breakIdx === null || breakIdx < 0 || breakIdx >= candles.length - 1) return null;
  // Next bar open after breakout (matches Pine open[offs] when offs>=1)
  return candles[breakIdx + 1]?.open ?? null;
}

function validatePattern(
  candles: Candle[],
  volSmaArr: number[],
  breakIdx: number | null,
  entry: number | null,
  stop: number | null,
  target: number | null,
  atrLast: number,
  cfg: PatternConfig
): boolean {
  if (entry === null || stop === null || target === null || breakIdx === null) {
    return false;
  }
  if (cfg.requireVolumeSpike) {
    const vol = candles[breakIdx]?.volume ?? 0;
    const sma = volSmaArr[breakIdx] ?? 0;
    if (sma > 0 && vol <= sma * cfg.volumeMult) return false;
  }
  const slip = cfg.slippageTicks * 0.01; // tick approx for BTCUSDT; conservative
  const totalCost = slip + entry * (cfg.commissionPct / 100) * 2;
  const risk = Math.abs(entry - stop);
  const rewardAdj = Math.max(0, Math.abs(target - entry) - totalCost);
  if (risk <= 0 || rewardAdj / risk < cfg.minRr) return false;
  // Guard against absurd sizes relative to ATR
  if (risk < atrLast * 0.05) return false;
  return true;
}

function finish(
  name: PatternName,
  isBullish: boolean,
  entry: number,
  stop: number,
  target: number,
  startIndex: number,
  breakoutIndex: number,
  height: number,
  upper: DetectedPattern["upper"],
  lower: DetectedPattern["lower"]
): DetectedPattern {
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  return {
    detected: true,
    name,
    isBullish,
    entryPrice: entry,
    stopPrice: stop,
    targetPrice: target,
    startIndex,
    breakoutIndex,
    height,
    riskReward: risk > 0 ? reward / risk : 0,
    upper,
    lower,
  };
}

// ─── Detectors ─────────────────────────────────────────────────────────

function detectDouble(
  highs: Pivot[],
  lows: Pivot[],
  candles: Candle[],
  atr: number[],
  volSmaArr: number[],
  cfg: PatternConfig
): PatternResult {
  const atrLast = atr[atr.length - 1] ?? 0;
  const price = candles[candles.length - 1]?.close ?? 0;

  // Double Top
  if (cfg.enabled.doubleTop && highs.length >= 2 && lows.length >= 1) {
    const p1 = highs[0];
    const p2 = highs[1];
    const mid = lows[0];
    if (p1.index > mid.index && mid.index > p2.index && isNear(p1.price, p2.price, cfg.levelTol)) {
      const avgTop = (p1.price + p2.price) / 2;
      const ht = avgTop - mid.price;
      if (isValidSize(ht, price, atrLast, cfg)) {
        const bIdx = getBreakIndex(
          candles,
          atr,
          mid.index,
          mid.price,
          candles.length - 1,
          mid.price,
          false,
          cfg
        );
        const entry = entryAtBreak(candles, bIdx);
        const target = mid.price - ht;
        const stop =
          entry !== null
            ? applyStop(Math.max(p1.price, p2.price), false, entry, target, atrLast, cfg)
            : null;
        if (
          bIdx !== null &&
          entry !== null &&
          stop !== null &&
          validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)
        ) {
          return finish(
            "Double Top",
            false,
            entry,
            stop,
            target,
            p2.index,
            bIdx,
            ht,
            { x1: p2.index, y1: avgTop, x2: bIdx, y2: avgTop },
            { x1: mid.index, y1: mid.price, x2: bIdx, y2: mid.price }
          );
        }
      }
    }
  }

  // Double Bottom
  if (cfg.enabled.doubleBottom && lows.length >= 2 && highs.length >= 1) {
    const p1b = lows[0];
    const p2b = lows[1];
    const midB = highs[0];
    if (
      p1b.index > midB.index &&
      midB.index > p2b.index &&
      isNear(p1b.price, p2b.price, cfg.levelTol)
    ) {
      const avgBot = (p1b.price + p2b.price) / 2;
      const ht = midB.price - avgBot;
      if (isValidSize(ht, price, atrLast, cfg)) {
        const bIdx = getBreakIndex(
          candles,
          atr,
          midB.index,
          midB.price,
          candles.length - 1,
          midB.price,
          true,
          cfg
        );
        const entry = entryAtBreak(candles, bIdx);
        const target = midB.price + ht;
        const stop =
          entry !== null
            ? applyStop(Math.min(p1b.price, p2b.price), true, entry, target, atrLast, cfg)
            : null;
        if (
          bIdx !== null &&
          entry !== null &&
          stop !== null &&
          validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)
        ) {
          return finish(
            "Double Bottom",
            true,
            entry,
            stop,
            target,
            p2b.index,
            bIdx,
            ht,
            { x1: midB.index, y1: midB.price, x2: bIdx, y2: midB.price },
            { x1: p2b.index, y1: avgBot, x2: bIdx, y2: avgBot }
          );
        }
      }
    }
  }

  return EMPTY_PATTERN;
}

function detectHS(
  highs: Pivot[],
  lows: Pivot[],
  candles: Candle[],
  atr: number[],
  volSmaArr: number[],
  cfg: PatternConfig
): PatternResult {
  const atrLast = atr[atr.length - 1] ?? 0;
  const price = candles[candles.length - 1]?.close ?? 0;

  // Head & Shoulders
  if (cfg.enabled.hs && highs.length >= 3 && lows.length >= 2) {
    const rs = highs[0];
    const head = highs[1];
    const ls = highs[2];
    const neckR = lows[0];
    const neckL = lows[1];
    if (
      rs.index > neckR.index &&
      neckR.index > head.index &&
      head.index > neckL.index &&
      neckL.index > ls.index &&
      head.price > rs.price &&
      head.price > ls.price &&
      isNear(ls.price, rs.price, cfg.symmetryTol)
    ) {
      const neckAvg = (neckR.price + neckL.price) / 2;
      const ht = head.price - neckAvg;
      if (isValidSize(ht, price, atrLast, cfg)) {
        const bIdx = getBreakIndex(
          candles,
          atr,
          neckL.index,
          neckL.price,
          neckR.index,
          neckR.price,
          false,
          cfg
        );
        const entry = entryAtBreak(candles, bIdx);
        const neckAt =
          bIdx !== null
            ? project(neckL.index, neckL.price, neckR.index, neckR.price, bIdx)
            : neckAvg;
        const target = neckAt - ht;
        const stop =
          entry !== null ? applyStop(rs.price, false, entry, target, atrLast, cfg) : null;
        if (
          bIdx !== null &&
          entry !== null &&
          stop !== null &&
          validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)
        ) {
          return finish(
            "Head & Shoulders",
            false,
            entry,
            stop,
            target,
            ls.index,
            bIdx,
            ht,
            null,
            { x1: neckL.index, y1: neckL.price, x2: bIdx, y2: neckAt }
          );
        }
      }
    }
  }

  // Inverse H&S
  if (cfg.enabled.ihs && lows.length >= 3 && highs.length >= 2) {
    const rs = lows[0];
    const head = lows[1];
    const ls = lows[2];
    const neckR = highs[0];
    const neckL = highs[1];
    if (
      rs.index > neckR.index &&
      neckR.index > head.index &&
      head.index > neckL.index &&
      neckL.index > ls.index &&
      head.price < rs.price &&
      head.price < ls.price &&
      isNear(ls.price, rs.price, cfg.symmetryTol)
    ) {
      const neckAvg = (neckR.price + neckL.price) / 2;
      const ht = neckAvg - head.price;
      if (isValidSize(ht, price, atrLast, cfg)) {
        const bIdx = getBreakIndex(
          candles,
          atr,
          neckL.index,
          neckL.price,
          neckR.index,
          neckR.price,
          true,
          cfg
        );
        const entry = entryAtBreak(candles, bIdx);
        const neckAt =
          bIdx !== null
            ? project(neckL.index, neckL.price, neckR.index, neckR.price, bIdx)
            : neckAvg;
        const target = neckAt + ht;
        const stop =
          entry !== null ? applyStop(rs.price, true, entry, target, atrLast, cfg) : null;
        if (
          bIdx !== null &&
          entry !== null &&
          stop !== null &&
          validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)
        ) {
          return finish(
            "Inv Head & Shoulders",
            true,
            entry,
            stop,
            target,
            ls.index,
            bIdx,
            ht,
            { x1: neckL.index, y1: neckL.price, x2: bIdx, y2: neckAt },
            null
          );
        }
      }
    }
  }

  return EMPTY_PATTERN;
}

function detectTriple(
  highs: Pivot[],
  lows: Pivot[],
  candles: Candle[],
  atr: number[],
  volSmaArr: number[],
  cfg: PatternConfig
): PatternResult {
  const atrLast = atr[atr.length - 1] ?? 0;
  const price = candles[candles.length - 1]?.close ?? 0;

  if (cfg.enabled.tripleTop && highs.length >= 3 && lows.length >= 2) {
    const [h1, h2, h3] = [highs[0], highs[1], highs[2]];
    const [l1, l2] = [lows[0], lows[1]];
    if (
      h1.index > l1.index &&
      l1.index > h2.index &&
      h2.index > l2.index &&
      l2.index > h3.index &&
      isNear(h1.price, h2.price, cfg.levelTol) &&
      isNear(h2.price, h3.price, cfg.levelTol)
    ) {
      const neck = Math.min(l1.price, l2.price);
      const top = Math.max(h1.price, h2.price, h3.price);
      const ht = top - neck;
      if (isValidSize(ht, price, atrLast, cfg)) {
        const bIdx = getBreakIndex(
          candles,
          atr,
          l2.index,
          l2.price,
          l1.index,
          l1.price,
          false,
          cfg
        );
        const entry = entryAtBreak(candles, bIdx);
        const neckAt =
          bIdx !== null ? project(l2.index, l2.price, l1.index, l1.price, bIdx) : neck;
        const target = neckAt - ht;
        const stop =
          entry !== null ? applyStop(top, false, entry, target, atrLast, cfg) : null;
        if (
          bIdx !== null &&
          entry !== null &&
          stop !== null &&
          validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)
        ) {
          return finish(
            "Triple Top",
            false,
            entry,
            stop,
            target,
            h3.index,
            bIdx,
            ht,
            { x1: h3.index, y1: top, x2: bIdx, y2: top },
            { x1: l2.index, y1: neck, x2: bIdx, y2: neckAt }
          );
        }
      }
    }
  }

  if (cfg.enabled.tripleBottom && lows.length >= 3 && highs.length >= 2) {
    const [l1, l2, l3] = [lows[0], lows[1], lows[2]];
    const [h1, h2] = [highs[0], highs[1]];
    if (
      l1.index > h1.index &&
      h1.index > l2.index &&
      l2.index > h2.index &&
      h2.index > l3.index &&
      isNear(l1.price, l2.price, cfg.levelTol) &&
      isNear(l2.price, l3.price, cfg.levelTol)
    ) {
      const neck = Math.max(h1.price, h2.price);
      const bot = Math.min(l1.price, l2.price, l3.price);
      const ht = neck - bot;
      if (isValidSize(ht, price, atrLast, cfg)) {
        const bIdx = getBreakIndex(
          candles,
          atr,
          h2.index,
          neck,
          h1.index,
          neck,
          true,
          cfg
        );
        const entry = entryAtBreak(candles, bIdx);
        const target = neck + ht;
        const stop =
          entry !== null ? applyStop(bot, true, entry, target, atrLast, cfg) : null;
        if (
          bIdx !== null &&
          entry !== null &&
          stop !== null &&
          validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)
        ) {
          return finish(
            "Triple Bottom",
            true,
            entry,
            stop,
            target,
            l3.index,
            bIdx,
            ht,
            { x1: h2.index, y1: neck, x2: bIdx, y2: neck },
            { x1: l3.index, y1: bot, x2: bIdx, y2: bot }
          );
        }
      }
    }
  }

  return EMPTY_PATTERN;
}

function detectFlagPennant(
  highs: Pivot[],
  lows: Pivot[],
  candles: Candle[],
  atr: number[],
  volSmaArr: number[],
  cfg: PatternConfig
): PatternResult {
  if (highs.length < 2 || lows.length < 2) return EMPTY_PATTERN;
  const atrLast = atr[atr.length - 1] ?? 0;
  const h1 = highs[0];
  const h2 = highs[1];
  const l1 = lows[0];
  const l2 = lows[1];
  const startBar = Math.min(h2.index, l2.index);
  const poleLen = Math.min(200, candles.length - startBar);
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = Math.max(0, candles.length - poleLen); i < candles.length; i++) {
    hi = Math.max(hi, candles[i].high);
    lo = Math.min(lo, candles[i].low);
  }
  const poleMove = hi - lo;
  if (poleMove <= atrLast * 3) return EMPTY_PATTERN;

  const slopeU = h1.index === h2.index ? 0 : (h1.price - h2.price) / Math.max(1, h1.index - h2.index);
  const slopeL = l1.index === l2.index ? 0 : (l1.price - l2.price) / Math.max(1, l1.index - l2.index);
  const parallel = isNear(slopeU, slopeL, 0.2);

  // Bullish: both slopes negative (flag/pennant after up-pole)
  if (slopeU < 0 && slopeL < 0 && (cfg.enabled.flagBull || cfg.enabled.pennantBull)) {
    const bIdx = getBreakIndex(candles, atr, h2.index, h2.price, h1.index, h1.price, true, cfg);
    const entry = entryAtBreak(candles, bIdx);
    if (bIdx !== null && entry !== null) {
      const ub = project(h2.index, h2.price, h1.index, h1.price, bIdx);
      const lb = project(l2.index, l2.price, l1.index, l1.price, bIdx);
      const target = ub + poleMove;
      const stop = applyStop(lb, true, entry, target, atrLast, cfg);
      if (validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)) {
        const name: PatternName =
          parallel && cfg.enabled.flagBull
            ? "Bullish Flag"
            : !parallel && cfg.enabled.pennantBull
              ? "Bullish Pennant"
              : parallel
                ? "Bullish Flag"
                : "Bullish Pennant";
        if (
          (name === "Bullish Flag" && cfg.enabled.flagBull) ||
          (name === "Bullish Pennant" && cfg.enabled.pennantBull)
        ) {
          return finish(name, true, entry, stop, target, h2.index, bIdx, poleMove, {
            x1: h2.index,
            y1: h2.price,
            x2: bIdx,
            y2: ub,
          }, {
            x1: l2.index,
            y1: l2.price,
            x2: bIdx,
            y2: lb,
          });
        }
      }
    }
  }

  // Bearish
  if (slopeU > 0 && slopeL > 0 && (cfg.enabled.flagBear || cfg.enabled.pennantBear)) {
    const bIdx = getBreakIndex(candles, atr, l2.index, l2.price, l1.index, l1.price, false, cfg);
    const entry = entryAtBreak(candles, bIdx);
    if (bIdx !== null && entry !== null) {
      const ub = project(h2.index, h2.price, h1.index, h1.price, bIdx);
      const lb = project(l2.index, l2.price, l1.index, l1.price, bIdx);
      const target = lb - poleMove;
      const stop = applyStop(ub, false, entry, target, atrLast, cfg);
      if (validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)) {
        const name: PatternName =
          parallel && cfg.enabled.flagBear
            ? "Bearish Flag"
            : !parallel && cfg.enabled.pennantBear
              ? "Bearish Pennant"
              : parallel
                ? "Bearish Flag"
                : "Bearish Pennant";
        if (
          (name === "Bearish Flag" && cfg.enabled.flagBear) ||
          (name === "Bearish Pennant" && cfg.enabled.pennantBear)
        ) {
          return finish(name, false, entry, stop, target, h2.index, bIdx, poleMove, {
            x1: h2.index,
            y1: h2.price,
            x2: bIdx,
            y2: ub,
          }, {
            x1: l2.index,
            y1: l2.price,
            x2: bIdx,
            y2: lb,
          });
        }
      }
    }
  }

  return EMPTY_PATTERN;
}

function detectWedge(
  highs: Pivot[],
  lows: Pivot[],
  candles: Candle[],
  atr: number[],
  volSmaArr: number[],
  cfg: PatternConfig
): PatternResult {
  if (highs.length < 2 || lows.length < 2) return EMPTY_PATTERN;
  const atrLast = atr[atr.length - 1] ?? 0;
  const h1 = highs[0];
  const h2 = highs[1];
  const l1 = lows[0];
  const l2 = lows[1];
  const slopeU = h1.index === h2.index ? 0 : (h1.price - h2.price) / Math.max(1, h1.index - h2.index);
  const slopeL = l1.index === l2.index ? 0 : (l1.price - l2.price) / Math.max(1, l1.index - l2.index);
  const last = candles.length - 1;
  const heightNow =
    project(h2.index, h2.price, h1.index, h1.price, last) -
    project(l2.index, l2.price, l1.index, l1.price, last);
  if (heightNow <= 0) return EMPTY_PATTERN;

  // Falling wedge → bullish breakout up
  if (cfg.enabled.wedgeFall && slopeU < 0 && slopeL < 0 && slopeL < slopeU) {
    const bIdx = getBreakIndex(candles, atr, h2.index, h2.price, h1.index, h1.price, true, cfg);
    const entry = entryAtBreak(candles, bIdx);
    if (bIdx !== null && entry !== null) {
      const ub = project(h2.index, h2.price, h1.index, h1.price, bIdx);
      const lb = project(l2.index, l2.price, l1.index, l1.price, bIdx);
      const target = h2.price;
      const stop = applyStop(lb, true, entry, target, atrLast, cfg);
      if (validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)) {
        return finish(
          "Falling Wedge",
          true,
          entry,
          stop,
          target,
          h2.index,
          bIdx,
          Math.abs(ub - lb),
          { x1: h2.index, y1: h2.price, x2: bIdx, y2: ub },
          { x1: l2.index, y1: l2.price, x2: bIdx, y2: lb }
        );
      }
    }
  }

  // Rising wedge → bearish
  if (cfg.enabled.wedgeRise && slopeU > 0 && slopeL > 0 && slopeL > slopeU) {
    const bIdx = getBreakIndex(candles, atr, l2.index, l2.price, l1.index, l1.price, false, cfg);
    const entry = entryAtBreak(candles, bIdx);
    if (bIdx !== null && entry !== null) {
      const ub = project(h2.index, h2.price, h1.index, h1.price, bIdx);
      const lb = project(l2.index, l2.price, l1.index, l1.price, bIdx);
      const target = l2.price;
      const stop = applyStop(ub, false, entry, target, atrLast, cfg);
      if (validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)) {
        return finish(
          "Rising Wedge",
          false,
          entry,
          stop,
          target,
          h2.index,
          bIdx,
          Math.abs(ub - lb),
          { x1: h2.index, y1: h2.price, x2: bIdx, y2: ub },
          { x1: l2.index, y1: l2.price, x2: bIdx, y2: lb }
        );
      }
    }
  }

  return EMPTY_PATTERN;
}

function detectTriangles(
  highs: Pivot[],
  lows: Pivot[],
  candles: Candle[],
  atr: number[],
  volSmaArr: number[],
  cfg: PatternConfig
): PatternResult {
  if (!cfg.enabled.triangle || highs.length < 2 || lows.length < 2) return EMPTY_PATTERN;
  const atrLast = atr[atr.length - 1] ?? 0;
  const price = candles[candles.length - 1]?.close ?? 0;
  const h1 = highs[0];
  const h2 = highs[1];
  const l1 = lows[0];
  const l2 = lows[1];
  const slopeU = h1.index === h2.index ? 0 : (h1.price - h2.price) / Math.max(1, h1.index - h2.index);
  const slopeL = l1.index === l2.index ? 0 : (l1.price - l2.price) / Math.max(1, l1.index - l2.index);
  const start = Math.min(h2.index, l2.index);
  const baseH = Math.abs(
    project(h2.index, h2.price, h1.index, h1.price, start) -
      project(l2.index, l2.price, l1.index, l1.price, start)
  );
  const flatTol = price * 0.0005;
  const last = candles.length - 1;
  const converging =
    project(h2.index, h2.price, h1.index, h1.price, last) >
    project(l2.index, l2.price, l1.index, l1.price, last);
  if (!converging || !isValidSize(baseH, price, atrLast, cfg)) return EMPTY_PATTERN;

  // Bullish break of upper (ascending or symmetrical)
  if ((slopeU < 0 && slopeL > 0) || (Math.abs(slopeU) < flatTol && slopeL > 0)) {
    const bIdx = getBreakIndex(candles, atr, h2.index, h2.price, h1.index, h1.price, true, cfg);
    const entry = entryAtBreak(candles, bIdx);
    if (bIdx !== null && entry !== null) {
      const ub = project(h2.index, h2.price, h1.index, h1.price, bIdx);
      const lb = project(l2.index, l2.price, l1.index, l1.price, bIdx);
      const target = ub + baseH;
      const stop = applyStop(lb, true, entry, target, atrLast, cfg);
      if (validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)) {
        const name: PatternName =
          Math.abs(slopeU) < flatTol ? "Ascending Triangle" : "Symmetrical Triangle";
        return finish(name, true, entry, stop, target, h2.index, bIdx, baseH, {
          x1: h2.index,
          y1: h2.price,
          x2: bIdx,
          y2: ub,
        }, {
          x1: l2.index,
          y1: l2.price,
          x2: bIdx,
          y2: lb,
        });
      }
    }
  }

  // Bearish break of lower
  if ((slopeU < 0 && slopeL > 0) || (slopeU < 0 && Math.abs(slopeL) < flatTol)) {
    const bIdx = getBreakIndex(candles, atr, l2.index, l2.price, l1.index, l1.price, false, cfg);
    const entry = entryAtBreak(candles, bIdx);
    if (bIdx !== null && entry !== null) {
      const ub = project(h2.index, h2.price, h1.index, h1.price, bIdx);
      const lb = project(l2.index, l2.price, l1.index, l1.price, bIdx);
      const target = lb - baseH;
      const stop = applyStop(ub, false, entry, target, atrLast, cfg);
      if (validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)) {
        const name: PatternName =
          Math.abs(slopeL) < flatTol ? "Descending Triangle" : "Symmetrical Triangle";
        return finish(name, false, entry, stop, target, h2.index, bIdx, baseH, {
          x1: h2.index,
          y1: h2.price,
          x2: bIdx,
          y2: ub,
        }, {
          x1: l2.index,
          y1: l2.price,
          x2: bIdx,
          y2: lb,
        });
      }
    }
  }

  return EMPTY_PATTERN;
}

function detectRectangles(
  highs: Pivot[],
  lows: Pivot[],
  candles: Candle[],
  atr: number[],
  volSmaArr: number[],
  cfg: PatternConfig
): PatternResult {
  if (!cfg.enabled.rectangle || highs.length < 2 || lows.length < 2) return EMPTY_PATTERN;
  const atrLast = atr[atr.length - 1] ?? 0;
  const price = candles[candles.length - 1]?.close ?? 0;
  const h1 = highs[0];
  const h2 = highs[1];
  const l1 = lows[0];
  const l2 = lows[1];
  const slopeU = h1.index === h2.index ? 0 : (h1.price - h2.price) / Math.max(1, h1.index - h2.index);
  const slopeL = l1.index === l2.index ? 0 : (l1.price - l2.price) / Math.max(1, l1.index - l2.index);
  const flatTol = atrLast * 0.05;
  if (Math.abs(slopeU) >= flatTol || Math.abs(slopeL) >= flatTol) return EMPTY_PATTERN;
  if (!isNear(slopeU, slopeL, 0.5)) return EMPTY_PATTERN;

  const start = Math.min(h2.index, l2.index);
  const avgTop = (h1.price + h2.price) / 2;
  const avgBot = (l1.price + l2.price) / 2;
  const height = avgTop - avgBot;
  if (!isValidSize(height, price, atrLast, cfg)) return EMPTY_PATTERN;

  const last = candles.length - 1;
  const bBull = getBreakIndex(candles, atr, start, avgTop, last, avgTop, true, cfg);
  const entryBull = entryAtBreak(candles, bBull);
  if (bBull !== null && entryBull !== null) {
    const target = avgTop + height;
    const stop = applyStop(avgBot, true, entryBull, target, atrLast, cfg);
    if (validatePattern(candles, volSmaArr, bBull, entryBull, stop, target, atrLast, cfg)) {
      return finish("Rectangle", true, entryBull, stop, target, h2.index, bBull, height, {
        x1: start,
        y1: avgTop,
        x2: bBull,
        y2: avgTop,
      }, {
        x1: start,
        y1: avgBot,
        x2: bBull,
        y2: avgBot,
      });
    }
  }

  const bBear = getBreakIndex(candles, atr, start, avgBot, last, avgBot, false, cfg);
  const entryBear = entryAtBreak(candles, bBear);
  if (bBear !== null && entryBear !== null) {
    const target = avgBot - height;
    const stop = applyStop(avgTop, false, entryBear, target, atrLast, cfg);
    if (validatePattern(candles, volSmaArr, bBear, entryBear, stop, target, atrLast, cfg)) {
      return finish("Rectangle", false, entryBear, stop, target, h2.index, bBear, height, {
        x1: start,
        y1: avgTop,
        x2: bBear,
        y2: avgTop,
      }, {
        x1: start,
        y1: avgBot,
        x2: bBear,
        y2: avgBot,
      });
    }
  }

  return EMPTY_PATTERN;
}

function detectCupHandle(
  highs: Pivot[],
  lows: Pivot[],
  candles: Candle[],
  atr: number[],
  volSmaArr: number[],
  cfg: PatternConfig
): PatternResult {
  if (highs.length < 2 || lows.length < 2) return EMPTY_PATTERN;
  const atrLast = atr[atr.length - 1] ?? 0;
  const price = candles[candles.length - 1]?.close ?? 0;

  // Cup & Handle (bullish)
  if (cfg.enabled.cup) {
    const hRim = highs[0];
    const hLeft = highs[1];
    const lHandle = lows[0];
    const lBot = lows[1];
    if (
      lHandle.index > hRim.index &&
      hRim.index > lBot.index &&
      lBot.index > hLeft.index &&
      isNear(hRim.price, hLeft.price, cfg.symmetryTol) &&
      lHandle.price > lBot.price &&
      lHandle.price < hRim.price
    ) {
      const cupH = hRim.price - lBot.price;
      if (isValidSize(cupH, price, atrLast, cfg)) {
        const last = candles.length - 1;
        const bIdx = getBreakIndex(
          candles,
          atr,
          hRim.index,
          hRim.price,
          last,
          hRim.price,
          true,
          cfg
        );
        const entry = entryAtBreak(candles, bIdx);
        if (bIdx !== null && entry !== null) {
          const neckAt = project(hLeft.index, hLeft.price, hRim.index, hRim.price, bIdx);
          const target = neckAt + cupH;
          const stop = applyStop(lHandle.price, true, entry, target, atrLast, cfg);
          if (validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)) {
            return finish(
              "Cup & Handle",
              true,
              entry,
              stop,
              target,
              hLeft.index,
              bIdx,
              cupH,
              { x1: hLeft.index, y1: hLeft.price, x2: bIdx, y2: neckAt },
              null
            );
          }
        }
      }
    }
  }

  // Inverse cup (bearish)
  if (cfg.enabled.invCup) {
    const lRim = lows[0];
    const lLeft = lows[1];
    const hHandle = highs[0];
    const hTop = highs[1];
    if (
      hHandle.index > lRim.index &&
      lRim.index > hTop.index &&
      hTop.index > lLeft.index &&
      isNear(lRim.price, lLeft.price, cfg.symmetryTol) &&
      hHandle.price < hTop.price &&
      hHandle.price > lRim.price
    ) {
      const cupH = hTop.price - lRim.price;
      if (isValidSize(cupH, price, atrLast, cfg)) {
        const last = candles.length - 1;
        const bIdx = getBreakIndex(
          candles,
          atr,
          lRim.index,
          lRim.price,
          last,
          lRim.price,
          false,
          cfg
        );
        const entry = entryAtBreak(candles, bIdx);
        if (bIdx !== null && entry !== null) {
          const neckAt = project(lLeft.index, lLeft.price, lRim.index, lRim.price, bIdx);
          const target = neckAt - cupH;
          const stop = applyStop(hHandle.price, false, entry, target, atrLast, cfg);
          if (validatePattern(candles, volSmaArr, bIdx, entry, stop, target, atrLast, cfg)) {
            return finish(
              "Inv Cup & Handle",
              false,
              entry,
              stop,
              target,
              lLeft.index,
              bIdx,
              cupH,
              null,
              { x1: lLeft.index, y1: lLeft.price, x2: bIdx, y2: neckAt }
            );
          }
        }
      }
    }
  }

  return EMPTY_PATTERN;
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Run the full pattern engine on a candle window.
 * Priority order matches the Pine script dispatcher.
 * Requires the same minimum history gate used by the Pine reference (600 bars).
 */
export function detectPatterns(
  candles: Candle[],
  cfg: PatternConfig = DEFAULT_PATTERN_CONFIG
): PatternResult {
  if (candles.length < 600) return EMPTY_PATTERN;

  const atr = atrSeries(candles, 14);
  const volSmaArr = volSma(candles, cfg.volumeSmaLen);
  const { highs, lows } = collectPivots(
    candles,
    cfg.pivotLeft,
    cfg.pivotRight,
    cfg.maxPivotHist
  );

  if (highs.length < 2 || lows.length < 2) return EMPTY_PATTERN;

  const detectors: Array<() => PatternResult> = [
    () => detectDouble(highs, lows, candles, atr, volSmaArr, cfg),
    () => detectTriple(highs, lows, candles, atr, volSmaArr, cfg),
    () => detectHS(highs, lows, candles, atr, volSmaArr, cfg),
    () => detectFlagPennant(highs, lows, candles, atr, volSmaArr, cfg),
    () => detectWedge(highs, lows, candles, atr, volSmaArr, cfg),
    () => detectTriangles(highs, lows, candles, atr, volSmaArr, cfg),
    () => detectRectangles(highs, lows, candles, atr, volSmaArr, cfg),
    () => detectCupHandle(highs, lows, candles, atr, volSmaArr, cfg),
  ];

  for (const run of detectors) {
    const res = run();
    if (res.detected) return res;
  }
  return EMPTY_PATTERN;
}

/** Serialize for API / UI (drops null geometry noise when undetected). */
export function patternToJson(p: PatternResult) {
  if (!p.detected) {
    return { detected: false as const };
  }
  return {
    detected: true as const,
    name: p.name,
    isBullish: p.isBullish,
    bias: p.isBullish ? ("LONG" as const) : ("SHORT" as const),
    entryPrice: p.entryPrice,
    stopPrice: p.stopPrice,
    targetPrice: p.targetPrice,
    riskReward: Number(p.riskReward.toFixed(2)),
    height: p.height,
    startIndex: p.startIndex,
    breakoutIndex: p.breakoutIndex,
    upper: p.upper,
    lower: p.lower,
    attribution:
      "Pattern logic ported from Auto Pattern Detector Targets [MarkitTick] (CC BY-NC-SA 4.0)",
  };
}
