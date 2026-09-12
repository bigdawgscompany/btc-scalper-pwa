/**
 * Smart Money Concepts engine (structure, order blocks, EQH/EQL, FVG).
 *
 * Ported from "Smart Money Concepts [LuxAlgo]" (Pine v5).
 * License: CC BY-NC-SA 4.0 — © LuxAlgo
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 */

import type { Candle } from "../contracts";
import {
  DEFAULT_SMC_CONFIG,
  type Bias,
  type EqualLevel,
  type FairValueGap,
  type OrderBlock,
  type SmcConfig,
  type SmcResult,
  type StructureEvent,
  type StructureTag,
} from "./types";

const BULL: Bias = 1;
const BEAR: Bias = -1;

/**
 * True range for a bar.
 */
function trueRange(c: Candle, prevClose: number): number {
  return Math.max(
    c.high - c.low,
    Math.abs(c.high - prevClose),
    Math.abs(c.low - prevClose)
  );
}

/**
 * ATR series ending at each bar.
 */
function atrAt(candles: Candle[], period: number, i: number): number {
  if (i < 1) return candles[0].high - candles[0].low;
  const start = Math.max(1, i - period + 1);
  let sum = 0;
  let n = 0;
  for (let j = start; j <= i; j++) {
    sum += trueRange(candles[j], candles[j - 1].close);
    n += 1;
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Highest high over lookback ending at index (exclusive of future).
 */
function highest(candles: Candle[], end: number, size: number): number {
  let h = -Infinity;
  const start = Math.max(0, end - size + 1);
  for (let i = start; i <= end; i++) h = Math.max(h, candles[i].high);
  return h;
}

/**
 * Lowest low over lookback ending at index.
 */
function lowest(candles: Candle[], end: number, size: number): number {
  let l = Infinity;
  const start = Math.max(0, end - size + 1);
  for (let i = start; i <= end; i++) l = Math.min(l, candles[i].low);
  return l;
}

type PivotState = {
  currentLevel: number | null;
  lastLevel: number | null;
  crossed: boolean;
  barIndex: number;
};

/**
 * Creates empty pivot state.
 */
function emptyPivot(): PivotState {
  return { currentLevel: null, lastLevel: null, crossed: false, barIndex: 0 };
}

/**
 * Detects leg flips and updates swing/internal pivots; emits structure on cross.
 */
function processStructure(
  candles: Candle[],
  size: number,
  internal: boolean,
  cfg: SmcConfig,
  atr200: number
): {
  events: StructureEvent[];
  blocks: OrderBlock[];
  equals: EqualLevel[];
  bias: Bias;
  lastHigh: number | null;
  lastLow: number | null;
} {
  const events: StructureEvent[] = [];
  const blocks: OrderBlock[] = [];
  const equals: EqualLevel[] = [];
  let leg = 0;
  const highPivot = emptyPivot();
  const lowPivot = emptyPivot();
  let bias: Bias = 0;
  let lastHigh: number | null = null;
  let lastLow: number | null = null;

  for (let i = size; i < candles.length; i++) {
    const newLegHigh = candles[i - size].high > highest(candles, i - 1, size);
    const newLegLow = candles[i - size].low < lowest(candles, i - 1, size);
    let newLeg = leg;
    if (newLegHigh) newLeg = 0; // bearish leg start
    else if (newLegLow) newLeg = 1; // bullish leg start

    if (newLeg !== leg) {
      const pivotIdx = i - size;
      if (newLeg === 1) {
        // bullish leg → swing low
        const level = candles[pivotIdx].low;
        if (
          cfg.showEqual &&
          size === cfg.equalLength &&
          lowPivot.currentLevel !== null &&
          Math.abs(lowPivot.currentLevel - level) < cfg.equalThreshold * atr200
        ) {
          equals.push({ kind: "EQL", level, barIndex: pivotIdx });
        }
        lowPivot.lastLevel = lowPivot.currentLevel;
        lowPivot.currentLevel = level;
        lowPivot.crossed = false;
        lowPivot.barIndex = pivotIdx;
        if (!internal) lastLow = level;
      } else {
        const level = candles[pivotIdx].high;
        if (
          cfg.showEqual &&
          size === cfg.equalLength &&
          highPivot.currentLevel !== null &&
          Math.abs(highPivot.currentLevel - level) < cfg.equalThreshold * atr200
        ) {
          equals.push({ kind: "EQH", level, barIndex: pivotIdx });
        }
        highPivot.lastLevel = highPivot.currentLevel;
        highPivot.currentLevel = level;
        highPivot.crossed = false;
        highPivot.barIndex = pivotIdx;
        if (!internal) lastHigh = level;
      }
      leg = newLeg;
    }

    // Bullish break of high pivot
    if (
      highPivot.currentLevel !== null &&
      !highPivot.crossed &&
      candles[i].close > highPivot.currentLevel
    ) {
      const tag: StructureTag = bias === BEAR ? "CHoCH" : "BOS";
      highPivot.crossed = true;
      bias = BULL;
      if ((internal && cfg.showInternal) || (!internal && cfg.showSwing)) {
        events.push({
          tag,
          bias: BULL,
          level: highPivot.currentLevel,
          barIndex: i,
          internal,
        });
      }
      // Order block: extreme low between pivot and now
      let minLow = Infinity;
      let minIdx = highPivot.barIndex;
      for (let j = highPivot.barIndex; j <= i; j++) {
        if (candles[j].low < minLow) {
          minLow = candles[j].low;
          minIdx = j;
        }
      }
      blocks.push({
        high: candles[minIdx].high,
        low: candles[minIdx].low,
        barIndex: minIdx,
        bias: BULL,
        mitigated: false,
        internal,
      });
    }

    // Bearish break of low pivot
    if (
      lowPivot.currentLevel !== null &&
      !lowPivot.crossed &&
      candles[i].close < lowPivot.currentLevel
    ) {
      const tag: StructureTag = bias === BULL ? "CHoCH" : "BOS";
      lowPivot.crossed = true;
      bias = BEAR;
      if ((internal && cfg.showInternal) || (!internal && cfg.showSwing)) {
        events.push({
          tag,
          bias: BEAR,
          level: lowPivot.currentLevel,
          barIndex: i,
          internal,
        });
      }
      let maxHigh = -Infinity;
      let maxIdx = lowPivot.barIndex;
      for (let j = lowPivot.barIndex; j <= i; j++) {
        if (candles[j].high > maxHigh) {
          maxHigh = candles[j].high;
          maxIdx = j;
        }
      }
      blocks.push({
        high: candles[maxIdx].high,
        low: candles[maxIdx].low,
        barIndex: maxIdx,
        bias: BEAR,
        mitigated: false,
        internal,
      });
    }
  }

  return { events, blocks, equals, bias, lastHigh, lastLow };
}

/**
 * Detects 3-candle fair value gaps and marks mitigation.
 */
function detectFvgs(candles: Candle[], cfg: SmcConfig): FairValueGap[] {
  if (!cfg.showFvg || candles.length < 3) return [];
  const gaps: FairValueGap[] = [];
  let cumAbs = 0;
  let count = 0;

  for (let i = 2; i < candles.length; i++) {
    const c0 = candles[i];
    const c1 = candles[i - 1];
    const c2 = candles[i - 2];
    const barDeltaPct = (c1.close - c1.open) / (c1.open * 100 || 1);
    cumAbs += Math.abs(barDeltaPct);
    count += 1;
    const threshold = cfg.fvgAutoThreshold ? (cumAbs / count) * 2 : 0;

    const bullish =
      c0.low > c2.high && c1.close > c2.high && barDeltaPct > threshold;
    const bearish =
      c0.high < c2.low && c1.close < c2.low && -barDeltaPct > threshold;

    if (bullish) {
      gaps.push({
        top: c0.low,
        bottom: c2.high,
        bias: BULL,
        barIndex: i,
        mitigated: false,
      });
    }
    if (bearish) {
      gaps.push({
        top: c0.high,
        bottom: c2.low,
        bias: BEAR,
        barIndex: i,
        mitigated: false,
      });
    }
  }

  // Mitigation pass
  for (const g of gaps) {
    for (let j = g.barIndex + 1; j < candles.length; j++) {
      if (g.bias === BULL && candles[j].low < g.bottom) {
        g.mitigated = true;
        break;
      }
      if (g.bias === BEAR && candles[j].high > g.top) {
        g.mitigated = true;
        break;
      }
    }
  }
  return gaps.filter((g) => !g.mitigated).slice(-20);
}

/**
 * Mitigates order blocks when price trades through them.
 */
function mitigateBlocks(blocks: OrderBlock[], candles: Candle[]): OrderBlock[] {
  for (const b of blocks) {
    for (let i = b.barIndex + 1; i < candles.length; i++) {
      if (b.bias === BEAR && candles[i].high > b.high) {
        b.mitigated = true;
        break;
      }
      if (b.bias === BULL && candles[i].low < b.low) {
        b.mitigated = true;
        break;
      }
    }
  }
  return blocks.filter((b) => !b.mitigated);
}

/**
 * Runs full SMC analysis on a candle window.
 */
export function computeSmc(
  candles: Candle[],
  cfg: SmcConfig = DEFAULT_SMC_CONFIG
): SmcResult {
  const attribution =
    "Smart Money Concepts ported from LuxAlgo (CC BY-NC-SA 4.0)";
  const empty: SmcResult = {
    swingBias: 0,
    internalBias: 0,
    structures: [],
    orderBlocks: [],
    equalLevels: [],
    fvgs: [],
    strongHigh: null,
    strongLow: null,
    premiumTop: null,
    discountBottom: null,
    equilibrium: null,
    attribution,
  };
  if (candles.length < cfg.swingLength + 5) return empty;

  const atr200 = atrAt(candles, 200, candles.length - 1);

  const swing = processStructure(
    candles,
    cfg.swingLength,
    false,
    cfg,
    atr200
  );
  const internal = processStructure(
    candles,
    cfg.internalLength,
    true,
    cfg,
    atr200
  );
  const equal = processStructure(
    candles,
    cfg.equalLength,
    false,
    { ...cfg, showSwing: false, showInternal: false },
    atr200
  );

  let blocks = mitigateBlocks(
    [...swing.blocks, ...internal.blocks],
    candles
  );
  blocks = blocks.slice(0, cfg.maxOrderBlocks * 2);

  const fvgs = detectFvgs(candles, cfg);

  const top = swing.lastHigh;
  const bottom = swing.lastLow;
  let equilibrium: number | null = null;
  let premiumTop: number | null = null;
  let discountBottom: number | null = null;
  if (top !== null && bottom !== null) {
    equilibrium = (top + bottom) / 2;
    premiumTop = top;
    discountBottom = bottom;
  }

  return {
    swingBias: swing.bias,
    internalBias: internal.bias,
    structures: [...internal.events, ...swing.events].slice(-30),
    orderBlocks: blocks,
    equalLevels: equal.equals.slice(-10),
    fvgs,
    strongHigh: swing.bias === BEAR ? top : top,
    strongLow: swing.bias === BULL ? bottom : bottom,
    premiumTop,
    discountBottom,
    equilibrium,
    attribution,
  };
}
