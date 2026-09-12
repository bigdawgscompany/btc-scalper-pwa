/**
 * Types for Dynamic Swing Anchored VWAP.
 *
 * Ported from Pine Script "Dynamic Swing Anchored VWAP (Zeiierman)".
 * License: CC BY-NC-SA 4.0 — © Zeiierman
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 */

/** Swing label classification from consecutive pivot structure. */
export type SwingLabel = "HH" | "HL" | "LH" | "LL" | "";

/** Direction of the active swing regime. */
export type SwingDirection = 1 | -1;

/** Configuration for swing detection and adaptive tracking. */
export type SwingVwapConfig = {
  /** Bars used to detect swing highs/lows. */
  swingPeriod: number;
  /** Base adaptive price tracking half-life (bars). */
  baseApt: number;
  /** When true, APT is scaled by ATR ratio. */
  useAdapt: boolean;
  /** Strength of volatility influence on APT. */
  volBias: number;
  /** ATR length for adaptation and display. */
  atrLen: number;
};

/** Default config matching Zeiierman script defaults. */
export const DEFAULT_SWING_VWAP_CONFIG: SwingVwapConfig = {
  swingPeriod: 50,
  baseApt: 20,
  useAdapt: false,
  volBias: 10,
  atrLen: 50,
};

/** A confirmed swing pivot with optional structure label. */
export type SwingPivot = {
  index: number;
  price: number;
  direction: SwingDirection;
  label: SwingLabel;
};

/** One point on the anchored VWAP polyline. */
export type VwapPoint = {
  index: number;
  value: number;
};

/** Full analysis result for a candle window. */
export type SwingVwapResult = {
  direction: SwingDirection;
  pivots: SwingPivot[];
  vwapSeries: Array<number | null>;
  lastVwap: number | null;
  apt: number;
  atrRatio: number;
  attribution: string;
};
