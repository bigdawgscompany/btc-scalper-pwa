/**
 * Smart Money Concepts types.
 * Ported from "Smart Money Concepts [LuxAlgo]" (Pine v5).
 * License: CC BY-NC-SA 4.0 — © LuxAlgo
 * https://creativecommons.org/licenses/by-nc-sa/4.0/
 */

export type Bias = 1 | -1 | 0;
export type StructureTag = "BOS" | "CHoCH";

export type SmcConfig = {
  swingLength: number;
  internalLength: number;
  equalLength: number;
  equalThreshold: number;
  showInternal: boolean;
  showSwing: boolean;
  showEqual: boolean;
  showFvg: boolean;
  fvgAutoThreshold: boolean;
  maxOrderBlocks: number;
  orderBlockFilterAtr: boolean;
};

export const DEFAULT_SMC_CONFIG: SmcConfig = {
  swingLength: 50,
  internalLength: 5,
  equalLength: 3,
  equalThreshold: 0.1,
  showInternal: true,
  showSwing: true,
  showEqual: true,
  showFvg: true,
  fvgAutoThreshold: true,
  maxOrderBlocks: 5,
  orderBlockFilterAtr: true,
};

export type StructureEvent = {
  tag: StructureTag;
  bias: Bias;
  level: number;
  barIndex: number;
  internal: boolean;
};

export type OrderBlock = {
  high: number;
  low: number;
  barIndex: number;
  bias: Bias;
  mitigated: boolean;
  internal: boolean;
};

export type EqualLevel = {
  kind: "EQH" | "EQL";
  level: number;
  barIndex: number;
};

export type FairValueGap = {
  top: number;
  bottom: number;
  bias: Bias;
  barIndex: number;
  mitigated: boolean;
};

export type SmcResult = {
  swingBias: Bias;
  internalBias: Bias;
  structures: StructureEvent[];
  orderBlocks: OrderBlock[];
  equalLevels: EqualLevel[];
  fvgs: FairValueGap[];
  strongHigh: number | null;
  strongLow: number | null;
  premiumTop: number | null;
  discountBottom: number | null;
  equilibrium: number | null;
  attribution: string;
};
