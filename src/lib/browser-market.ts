import {
  INTERVAL_MS,
  type Candle,
  type MarketResponse,
  type AnalysisResult,
} from "./contracts";

// ─── Browser-side re-validation (§4) ────────────────────────────────────
// The server validates; the browser validates again before rendering or
// acting on any market data.

/**
 * Re-validates candle chronology in the browser: strict ascending order,
 * no duplicates, no gaps, no future timestamps.
 */
export function validateCandleChronology(
  candles: Candle[],
  observationTimestamp = Date.now()
): { valid: boolean; error?: string } {
  if (!Array.isArray(candles) || candles.length === 0) {
    return { valid: false, error: "Candle series is empty" };
  }

  for (let i = 0; i < candles.length; i++) {
    const current = candles[i];

    if (current.openTime > observationTimestamp + 60_000) {
      return {
        valid: false,
        error: `Candle timestamp ${current.openTime} is in the future`,
      };
    }

    if (i > 0) {
      const prev = candles[i - 1];
      if (current.openTime === prev.openTime) {
        return {
          valid: false,
          error: `Duplicate candle timestamp at ${current.openTime}`,
        };
      }
      if (current.openTime < prev.openTime) {
        return { valid: false, error: "Candles not in ascending order" };
      }
      if (current.openTime !== prev.openTime + INTERVAL_MS) {
        return {
          valid: false,
          error: `Gap detected between ${prev.openTime} and ${current.openTime}`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Validates oscillator ranges are within expected bounds.
 */
export function validateOscillatorRanges(
  analysis: AnalysisResult
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ind = analysis.indicators;

  if (ind.rsi !== null && (ind.rsi < 0 || ind.rsi > 100)) {
    errors.push(`RSI out of range: ${ind.rsi}`);
  }
  if (ind.stochK !== null && (ind.stochK < 0 || ind.stochK > 100)) {
    errors.push(`Stoch K out of range: ${ind.stochK}`);
  }
  if (ind.stochD !== null && (ind.stochD < 0 || ind.stochD > 100)) {
    errors.push(`Stoch D out of range: ${ind.stochD}`);
  }
  if (ind.willR !== null && (ind.willR < -100 || ind.willR > 0)) {
    errors.push(`Williams %R out of range: ${ind.willR}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates contribution arithmetic: each contribution = vote × 25,
 * and score = 25 × |sum(votes)|.
 */
export function validateContributionArithmetic(
  analysis: AnalysisResult
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const contributions = analysis.groupContributions;

  if (contributions.length !== 5 && analysis.state !== "Unavailable") {
    errors.push(`Expected 5 group contributions, got ${contributions.length}`);
  }

  let sumVotes = 0;
  for (const g of contributions) {
    if (![-1, 0, 1].includes(g.vote)) {
      errors.push(`Invalid vote value: ${g.vote}`);
    }
    const expectedContribution = g.vote * 20;
    if (g.contribution !== expectedContribution) {
      errors.push(
        `Contribution mismatch for ${g.groupName}: ${g.contribution} != ${expectedContribution}`
      );
    }
    sumVotes += g.vote;
  }

  const expectedScore = 20 * Math.abs(sumVotes);
  if (analysis.score !== expectedScore) {
    errors.push(`Score mismatch: ${analysis.score} != ${expectedScore}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates score/direction consistency: Bullish requires sumVotes >= 4,
 * Bearish requires sumVotes <= -4, Wait otherwise (5-group voting).
 */
export function validateScoreDirectionConsistency(
  analysis: AnalysisResult
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const contributions = analysis.groupContributions;
  const sumVotes = contributions.reduce((s, g) => s + g.vote, 0);
  const bullishVotes = contributions.filter((g) => g.vote === 1).length;
  const bearishVotes = contributions.filter((g) => g.vote === -1).length;

  if (analysis.state === "Bullish") {
    if (sumVotes < 4 || bullishVotes < 4) {
      errors.push(`Bullish state but sumVotes=${sumVotes}, bullishVotes=${bullishVotes}`);
    }
  } else if (analysis.state === "Bearish") {
    if (sumVotes > -4 || bearishVotes < 4) {
      errors.push(`Bearish state but sumVotes=${sumVotes}, bearishVotes=${bearishVotes}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Full browser-side validation of a market response.
 * Returns all validation errors found.
 */
export function validateMarketResponse(
  data: MarketResponse
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Schema version check
  if (data.schemaVersion !== 2) {
    errors.push(`Unexpected schema version: ${data.schemaVersion}`);
  }

  // Candle chronology
  const chrono = validateCandleChronology(data.candles, data.observationTimestamp);
  if (!chrono.valid && chrono.error) {
    errors.push(`Candle chronology: ${chrono.error}`);
  }

  // Confirmed analysis
  if (data.confirmedAnalysis) {
    const osc = validateOscillatorRanges(data.confirmedAnalysis);
    errors.push(...osc.errors);

    const contrib = validateContributionArithmetic(data.confirmedAnalysis);
    errors.push(...contrib.errors);

    const dir = validateScoreDirectionConsistency(data.confirmedAnalysis);
    errors.push(...dir.errors);
  }

  // Provisional analysis
  if (data.provisionalAnalysis) {
    const osc = validateOscillatorRanges(data.provisionalAnalysis);
    errors.push(...osc.errors);

    const contrib = validateContributionArithmetic(data.provisionalAnalysis);
    errors.push(...contrib.errors);
  }

  // Timestamp sanity
  if (data.expiresAt < data.observationTimestamp) {
    errors.push(`expiresAt (${data.expiresAt}) is before observationTimestamp (${data.observationTimestamp})`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Checks if market data is eligible for execution (fresh and not expired).
 */
export function isEligibleForExecution(
  data: MarketResponse,
  now = Date.now()
): { eligible: boolean; reason?: string } {
  if (!data.status.isLive) {
    return { eligible: false, reason: "Market data is not live" };
  }
  if (now > data.expiresAt) {
    return { eligible: false, reason: "Market data has expired" };
  }
  if (data.status.isLagging) {
    return { eligible: false, reason: "Provider is lagging" };
  }
  const analysis = data.confirmedAnalysis;
  const hasCanonicalBullishEvidence =
    analysis.state === "Bullish" &&
    analysis.score >= 80 &&
    analysis.sumVotes >= 4 &&
    analysis.supporters >= 4;
  const hasCanonicalBearishEvidence =
    analysis.state === "Bearish" &&
    analysis.score <= -80 &&
    analysis.sumVotes <= -4 &&
    analysis.opponents >= 4;

  if (!hasCanonicalBullishEvidence && !hasCanonicalBearishEvidence) {
    return {
      eligible: false,
      reason: `Signal state/evidence is not execution-grade: ${analysis.state} ${analysis.score}`,
    };
  }
  return { eligible: true };
}