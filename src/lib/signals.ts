import { computeIndicators } from "./indicators";
import type {
  Candle,
  AnalysisResult,
  GroupContribution,
  VoteValue,
  SignedContribution,
  SignalState,
} from "./contracts";

export const REQUIRED_CANDLE_COUNT = 100;

/**
 * Compute Strategy Analysis according to exact 4-group ternary voting rules.
 *
 * Rules:
 * Group 1: RSI (14) - <=30 Bullish (+1), >=70 Bearish (-1), else Neutral (0)
 * Group 2: CCI (20) - <-100 Bullish (+1), >100 Bearish (-1), else Neutral (0)
 * Group 3: MACD (12,26,9) Hist - > eps Bullish (+1), < -eps Bearish (-1), else Neutral (0)
 * Group 4: Stoch (14,3) & Will%R (14) - K,D < 20 & Will <= -80 Bullish (+1); K,D > 80 & Will >= -20 Bearish (-1); else Neutral (0)
 *
 * signalScore = 25 * abs(sum(votes))
 * Confirmed Bullish/Bearish requires >= 3 supporters AND score >= 75 (sumVotes >= 3 or <= -3).
 * Otherwise Wait. Missing/insufficient candles (<100) returns Unavailable.
 */
export function analyzeCandles(
  candles: Candle[],
  isForming = false
): AnalysisResult {
  const lastCandle = candles[candles.length - 1];
  const candleTime = lastCandle ? lastCandle.closeTime : Date.now();
  const price = lastCandle ? lastCandle.close : 0;

  if (candles.length < REQUIRED_CANDLE_COUNT) {
    return {
      state: "Unavailable",
      score: 0,
      sumVotes: 0,
      supporters: 0,
      opponents: 0,
      candleTime,
      isForming,
      reasons: [
        `Insufficient candle history: ${candles.length}/${REQUIRED_CANDLE_COUNT} required`,
      ],
      indicators: {
        rsi: null,
        cci: null,
        macdHist: null,
        macdLine: null,
        signalLine: null,
        stochK: null,
        stochD: null,
        willR: null,
      },
      groupContributions: [],
    };
  }

  // Use exactly the latest 100 candles for deterministic analysis
  const windowCandles = candles.slice(-REQUIRED_CANDLE_COUNT);
  const indicators = computeIndicators(windowCandles);

  // Validate that no required indicator failed
  if (
    indicators.rsi === null ||
    indicators.cci === null ||
    indicators.macdHist === null ||
    indicators.stochK === null ||
    indicators.stochD === null ||
    indicators.willR === null
  ) {
    return {
      state: "Unavailable",
      score: 0,
      sumVotes: 0,
      supporters: 0,
      opponents: 0,
      candleTime,
      isForming,
      reasons: ["One or more technical indicators failed to compute"],
      indicators,
      groupContributions: [],
    };
  }

  const groupContributions: GroupContribution[] = [];

  // Group 1: RSI (14)
  let rsiVote: VoteValue = 0;
  let rsiReason = `RSI neutral (${indicators.rsi.toFixed(1)})`;
  if (indicators.rsi <= 30) {
    rsiVote = 1;
    rsiReason = `RSI oversold (${indicators.rsi.toFixed(1)} ≤ 30)`;
  } else if (indicators.rsi >= 70) {
    rsiVote = -1;
    rsiReason = `RSI overbought (${indicators.rsi.toFixed(1)} ≥ 70)`;
  }
  groupContributions.push({
    groupName: "RSI (14)",
    vote: rsiVote,
    contribution: (rsiVote * 25) as SignedContribution,
    reason: rsiReason,
  });

  // Group 2: CCI (20)
  let cciVote: VoteValue = 0;
  let cciReason = `CCI neutral (${indicators.cci.toFixed(1)})`;
  if (indicators.cci < -100) {
    cciVote = 1;
    cciReason = `CCI oversold (${indicators.cci.toFixed(1)} < -100)`;
  } else if (indicators.cci > 100) {
    cciVote = -1;
    cciReason = `CCI overbought (${indicators.cci.toFixed(1)} > 100)`;
  }
  groupContributions.push({
    groupName: "CCI (20)",
    vote: cciVote,
    contribution: (cciVote * 25) as SignedContribution,
    reason: cciReason,
  });

  // Group 3: MACD Histogram (12, 26, 9)
  const macdEps = Math.max(1, Math.abs(price)) * 1e-10;
  let macdVote: VoteValue = 0;
  let macdReason = `MACD histogram neutral (${indicators.macdHist.toFixed(2)})`;
  if (indicators.macdHist > macdEps) {
    macdVote = 1;
    macdReason = `MACD histogram positive (+${indicators.macdHist.toFixed(2)})`;
  } else if (indicators.macdHist < -macdEps) {
    macdVote = -1;
    macdReason = `MACD histogram negative (${indicators.macdHist.toFixed(2)})`;
  }
  groupContributions.push({
    groupName: "MACD (12,26,9)",
    vote: macdVote,
    contribution: (macdVote * 25) as SignedContribution,
    reason: macdReason,
  });

  // Group 4: Stochastic (14,3) & Williams %R (14)
  let stochWillVote: VoteValue = 0;
  let stochWillReason = `Stoch/Williams range neutral (K=${indicators.stochK.toFixed(1)}, D=${indicators.stochD.toFixed(1)}, W%R=${indicators.willR.toFixed(1)})`;
  if (
    indicators.stochK < 20 &&
    indicators.stochD < 20 &&
    indicators.willR <= -80
  ) {
    stochWillVote = 1;
    stochWillReason = `Stoch oversold (K=${indicators.stochK.toFixed(1)}, D=${indicators.stochD.toFixed(1)} < 20) & Williams %R (${indicators.willR.toFixed(1)} ≤ -80)`;
  } else if (
    indicators.stochK > 80 &&
    indicators.stochD > 80 &&
    indicators.willR >= -20
  ) {
    stochWillVote = -1;
    stochWillReason = `Stoch overbought (K=${indicators.stochK.toFixed(1)}, D=${indicators.stochD.toFixed(1)} > 80) & Williams %R (${indicators.willR.toFixed(1)} ≥ -20)`;
  }
  groupContributions.push({
    groupName: "Stoch & Williams %R",
    vote: stochWillVote,
    contribution: (stochWillVote * 25) as SignedContribution,
    reason: stochWillReason,
  });

  const sumVotes = rsiVote + cciVote + macdVote + stochWillVote;
  const score = 25 * Math.abs(sumVotes);

  const bullishVotes = [rsiVote, cciVote, macdVote, stochWillVote].filter(
    (v) => v === 1
  ).length;
  const bearishVotes = [rsiVote, cciVote, macdVote, stochWillVote].filter(
    (v) => v === -1
  ).length;

  let supporters = 0;
  let opponents = 0;
  if (sumVotes > 0) {
    supporters = bullishVotes;
    opponents = bearishVotes;
  } else if (sumVotes < 0) {
    supporters = bearishVotes;
    opponents = bullishVotes;
  } else {
    supporters = Math.max(bullishVotes, bearishVotes);
    opponents = Math.min(bullishVotes, bearishVotes);
  }

  let state: SignalState = "Wait";
  const reasons: string[] = groupContributions
    .filter((g) => g.vote !== 0)
    .map((g) => g.reason);

  if (sumVotes >= 3 && supporters >= 3 && score >= 75) {
    state = "Bullish";
  } else if (sumVotes <= -3 && supporters >= 3 && score >= 75) {
    state = "Bearish";
  } else {
    state = "Wait";
    if (reasons.length === 0) {
      reasons.push("All oscillator groups currently in neutral range.");
    } else {
      reasons.push(
        `Insufficient confluence: ${supporters} supporting, ${opponents} opposing (score: ${score}/100, threshold ≥ 75).`
      );
    }
  }

  return {
    state,
    score,
    sumVotes,
    supporters,
    opponents,
    candleTime,
    isForming,
    reasons,
    indicators,
    groupContributions,
  };
}