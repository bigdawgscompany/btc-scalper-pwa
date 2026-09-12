/**
 * Deterministic professional guidance derived ONLY from the confirmed
 * AnalysisResult. No model, no narrative invention, no probability claims.
 *
 * Action vocabulary:
 *   OPEN_LONG  — confluence meets Bullish rule (≥4 agreeing votes, score ≥ 80)
 *   OPEN_SHORT — confluence meets Bearish rule
 *   STAY_FLAT  — Wait or insufficient history
 *   NO_TRADE   — Unavailable / data failure
 *
 * This is research guidance for paper simulation, not an order instruction.
 */

import type { AnalysisResult, SignalState } from "./contracts";

export type GuidanceAction =
  | "OPEN_LONG"
  | "OPEN_SHORT"
  | "STAY_FLAT"
  | "NO_TRADE";

export type GuidanceBias = "LONG" | "SHORT" | "NEUTRAL" | "NONE";

export type ProfessionalGuidance = {
  action: GuidanceAction;
  bias: GuidanceBias;
  /** One-line directive, no fluff */
  directive: string;
  /** Hard conditions that produced this action */
  conditions: string[];
  /** What would invalidate the current stance */
  invalidation: string[];
  /** Explicit risk framing for paper sizing */
  riskNotes: string[];
  score: number;
  state: SignalState;
  supporters: number;
  opponents: number;
  isForming: boolean;
  /** True only when action is OPEN_* and candle is confirmed (not forming) */
  actionable: boolean;
};

function actionFromState(state: SignalState): GuidanceAction {
  switch (state) {
    case "Bullish":
      return "OPEN_LONG";
    case "Bearish":
      return "OPEN_SHORT";
    case "Wait":
      return "STAY_FLAT";
    case "Unavailable":
    default:
      return "NO_TRADE";
  }
}

function biasFromState(state: SignalState): GuidanceBias {
  switch (state) {
    case "Bullish":
      return "LONG";
    case "Bearish":
      return "SHORT";
    case "Wait":
      return "NEUTRAL";
    default:
      return "NONE";
  }
}

/**
 * Build professional guidance from a confirmed (or provisional) analysis.
 * Pure function — same input always yields the same output.
 */
export function buildGuidance(analysis: AnalysisResult): ProfessionalGuidance {
  const action = actionFromState(analysis.state);
  const bias = biasFromState(analysis.state);
  const actionable =
    (action === "OPEN_LONG" || action === "OPEN_SHORT") && !analysis.isForming;

  const conditions: string[] = [];
  for (const g of analysis.groupContributions) {
    if (g.vote !== 0) {
      conditions.push(`${g.groupName}: ${g.reason}`);
    }
  }
  if (conditions.length === 0) {
    conditions.push(
      analysis.state === "Unavailable"
        ? "Insufficient or invalid candle history for indicator computation."
        : "All five groups are neutral; no directional confluence."
    );
  }

  const invalidation: string[] = [];
  if (action === "OPEN_LONG") {
    invalidation.push(
      "Any subsequent confirmed candle where sumVotes drops below +4 or score < 80."
    );
    invalidation.push(
      "Opposite group majority (Bearish votes ≥ 4) on a later confirmed close."
    );
  } else if (action === "OPEN_SHORT") {
    invalidation.push(
      "Any subsequent confirmed candle where sumVotes rises above −4 or score < 80."
    );
    invalidation.push(
      "Opposite group majority (Bullish votes ≥ 4) on a later confirmed close."
    );
  } else if (action === "STAY_FLAT") {
    invalidation.push(
      "Confluence reaches ≥ 4 agreeing votes with score ≥ 80 on a confirmed close."
    );
  } else {
    invalidation.push(
      "Restore ≥ 100 valid 15m candles and successful indicator computation."
    );
  }

  const riskNotes: string[] = [
    "Paper simulation only — no live orders are placed by this terminal.",
    "Score is an uncalibrated confluence metric, not a win-rate or probability.",
    "Default paper risk: allocate only the configured entry % of available cash; stop and target are fixed percentages from entry.",
  ];
  if (analysis.isForming) {
    riskNotes.unshift(
      "Forming candle: analysis is provisional and must not be used for entry until the candle confirms."
    );
  }
  if (action === "OPEN_LONG" || action === "OPEN_SHORT") {
    riskNotes.push(
      `Confluence: ${analysis.supporters} supporting / ${analysis.opponents} opposing · score ${analysis.score}/100.`
    );
  }

  let directive: string;
  switch (action) {
    case "OPEN_LONG":
      directive = analysis.isForming
        ? "PROVISIONAL LONG bias on forming candle — wait for confirmation before any paper entry."
        : "LONG bias confirmed. Paper entry eligible on next evaluation cycle if autopilot is running and flat (or reversal allowed).";
      break;
    case "OPEN_SHORT":
      directive = analysis.isForming
        ? "PROVISIONAL SHORT bias on forming candle — wait for confirmation before any paper entry."
        : "SHORT bias confirmed. Paper entry eligible on next evaluation cycle if autopilot is running and flat (or reversal allowed).";
      break;
    case "STAY_FLAT":
      directive =
        "No trade. Confluence below threshold — remain flat until ≥ 4 groups agree with score ≥ 80.";
      break;
    case "NO_TRADE":
    default:
      directive =
        "No trade. Market data or indicators unavailable — do not act.";
      break;
  }

  return {
    action,
    bias,
    directive,
    conditions,
    invalidation,
    riskNotes,
    score: analysis.score,
    state: analysis.state,
    supporters: analysis.supporters,
    opponents: analysis.opponents,
    isForming: analysis.isForming,
    actionable,
  };
}
