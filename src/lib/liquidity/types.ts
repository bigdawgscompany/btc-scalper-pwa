/**
 * Types for Liquidity Delta Profiler.
 *
 * Ported from "Liquidity Delta Profiler [LuxAlgo]" (Pine v6).
 * License: CC BY-NC-SA 4.0 — © LuxAlgo
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 */

/** Reversal signal codes from the LuxAlgo profiler. */
export type ReversalSignalType = "ABS" | "EXH" | "DIV" | "REJ";

/** Buy-side (resistance) or sell-side (support) liquidity zone. */
export type LiquiditySide = "BSL" | "SSL";

/** Configuration for zone detection and reversal evaluation. */
export type LiquidityConfig = {
  pivotLength: number;
  maxZonesPerType: number;
  showSwept: boolean;
  filterOverlaps: boolean;
  showDecay: boolean;
  zoneCapacityMult: number;
  enableReversals: boolean;
  evalWindowBars: number;
  holdBars: number;
};

/** Default config aligned with LuxAlgo script inputs. */
export const DEFAULT_LIQUIDITY_CONFIG: LiquidityConfig = {
  pivotLength: 15,
  maxZonesPerType: 10,
  showSwept: true,
  filterOverlaps: true,
  showDecay: true,
  zoneCapacityMult: 5,
  enableReversals: true,
  evalWindowBars: 10,
  holdBars: 3,
};

/** A liquidity zone with quadrant deltas and health. */
export type LiquidityZone = {
  side: LiquiditySide;
  top: number;
  bottom: number;
  leftIndex: number;
  rightIndex: number;
  swept: boolean;
  signaled: boolean;
  deltas: [number, number, number, number];
  volumeTraded: number;
  capacity: number;
  healthPct: number;
  wasHit: boolean;
};

/** A reversal signal emitted at a zone sweep/test. */
export type ReversalSignal = {
  type: ReversalSignalType;
  side: LiquiditySide;
  barIndex: number;
  price: number;
  direction: 1 | -1;
  tooltip: string;
  significance: number;
};

/** Aggregate result for a candle window. */
export type LiquidityProfilerResult = {
  bslZones: LiquidityZone[];
  sslZones: LiquidityZone[];
  signals: ReversalSignal[];
  stats: {
    absTotal: number;
    absWins: number;
    exhTotal: number;
    exhWins: number;
    divTotal: number;
    divWins: number;
    rejTotal: number;
    rejWins: number;
  };
  attribution: string;
};
