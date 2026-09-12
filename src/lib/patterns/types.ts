/**
 * Chart pattern types — TypeScript port of structure from
 * "Auto Pattern Detector Targets [MarkitTick]" (Pine v6).
 *
 * Licensed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0
 * International (CC BY-NC-SA 4.0).
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 * © MarkitTick — port adapted for BTC Scalper paper research terminal.
 */

export type Pivot = {
  price: number;
  index: number; // bar index into the candle array (0 = oldest in window)
};

export type PatternName =
  | "Double Top"
  | "Double Bottom"
  | "Triple Top"
  | "Triple Bottom"
  | "Head & Shoulders"
  | "Inv Head & Shoulders"
  | "Bullish Flag"
  | "Bearish Flag"
  | "Bullish Pennant"
  | "Bearish Pennant"
  | "Rising Wedge"
  | "Falling Wedge"
  | "Ascending Triangle"
  | "Descending Triangle"
  | "Symmetrical Triangle"
  | "Rectangle"
  | "Cup & Handle"
  | "Inv Cup & Handle";

export type DetectedPattern = {
  detected: true;
  name: PatternName;
  isBullish: boolean;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  startIndex: number;
  breakoutIndex: number;
  /** Pattern height used for measured move */
  height: number;
  /** Risk:reward after costs (approx) */
  riskReward: number;
  /** Boundary lines for UI (optional geometry) */
  upper: { x1: number; y1: number; x2: number; y2: number } | null;
  lower: { x1: number; y1: number; x2: number; y2: number } | null;
};

export type NoPattern = {
  detected: false;
  name: null;
  isBullish: false;
  entryPrice: null;
  stopPrice: null;
  targetPrice: null;
  startIndex: null;
  breakoutIndex: null;
  height: null;
  riskReward: null;
  upper: null;
  lower: null;
};

export type PatternResult = DetectedPattern | NoPattern;

export type PatternConfig = {
  cooldownBars: number;
  symmetryTol: number; // fraction e.g. 0.10
  levelTol: number;
  minSizePct: number;
  minAtrMult: number;
  pivotLeft: number;
  pivotRight: number;
  maxPivotHist: number;
  requireCloseBreak: boolean;
  requireBodyBreak: boolean;
  useAtrBreak: boolean;
  breakAtr: number;
  breakPct: number;
  confirmBars: number;
  minBreakLookback: number;
  requireVolumeSpike: boolean;
  volumeMult: number;
  volumeSmaLen: number;
  minRr: number;
  slippageTicks: number;
  commissionPct: number;
  stopBufferAtr: number;
  useSlPctOfTarget: boolean;
  slPctOfTarget: number;
  enabled: {
    doubleTop: boolean;
    doubleBottom: boolean;
    tripleTop: boolean;
    tripleBottom: boolean;
    hs: boolean;
    ihs: boolean;
    flagBull: boolean;
    flagBear: boolean;
    pennantBull: boolean;
    pennantBear: boolean;
    wedgeRise: boolean;
    wedgeFall: boolean;
    triangle: boolean;
    rectangle: boolean;
    cup: boolean;
    invCup: boolean;
  };
};

export const DEFAULT_PATTERN_CONFIG: PatternConfig = {
  cooldownBars: 5,
  symmetryTol: 0.1,
  levelTol: 0.03,
  minSizePct: 0.005,
  minAtrMult: 1.0,
  pivotLeft: 10,
  pivotRight: 10,
  maxPivotHist: 200,
  requireCloseBreak: false,
  requireBodyBreak: false,
  useAtrBreak: true,
  breakAtr: 1.0,
  breakPct: 0.003,
  confirmBars: 1,
  minBreakLookback: 1,
  requireVolumeSpike: false,
  volumeMult: 1.0,
  volumeSmaLen: 20,
  minRr: 1.0,
  slippageTicks: 1.0,
  commissionPct: 0.0001,
  stopBufferAtr: 0.5,
  useSlPctOfTarget: true,
  slPctOfTarget: 0.25,
  enabled: {
    doubleTop: true,
    doubleBottom: true,
    tripleTop: true,
    tripleBottom: true,
    hs: true,
    ihs: true,
    flagBull: true,
    flagBear: true,
    pennantBull: true,
    pennantBear: true,
    wedgeRise: true,
    wedgeFall: true,
    triangle: true,
    rectangle: true,
    cup: true,
    invCup: true,
  },
};

export const EMPTY_PATTERN: NoPattern = {
  detected: false,
  name: null,
  isBullish: false,
  entryPrice: null,
  stopPrice: null,
  targetPrice: null,
  startIndex: null,
  breakoutIndex: null,
  height: null,
  riskReward: null,
  upper: null,
  lower: null,
};
