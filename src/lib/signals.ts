import { computeIndicators } from "./indicators";
import { computeLorentzianVote } from "./ml/lorentzian";
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
 * Pure core of the 5-group ternary voting rules. Given exactly five votes
 * (each -1, 0, or +1), computes the signal state, score, supporters, and
 * opponents.
 *
 * Rules:
 * signalScore = 20 * abs(sum(votes))
 * Bullish: sumVotes >= 4 AND supporters >= 4 AND score >= 80
 * Bearish: sumVotes <= -4 AND supporters >= 4 AND score >= 80
 * Otherwise: Wait
 *
 * With 5 ternary votes, sumVotes >= 4 is only reachable via 4 agreeing + 1
 * neutral, or all 5 agreeing — i.e. it mathematically guarantees zero
 * opposing votes, same as the old 4-group "sumVotes >= 3" rule did.
 */
export function computeSignalFromVotes(votes: [
  VoteValue,
  VoteValue,
  VoteValue,
  VoteValue,
  VoteValue
]): {
  state: SignalState;
  score: number;
  sumVotes: number;
  supporters: number;
  opponents: number;
} {
  const sumVotes = votes[0] + votes[1] + votes[2] + votes[3] + votes[4];
  const score = 20 * Math.abs(sumVotes);

  const bullishVotes = votes.filter((v) => v === 1).length;
  const bearishVotes = votes.filter((v) => v === -1).length;

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
  if (sumVotes >= 4 && supporters >= 4 && score >= 80) {
    state = "Bullish";
  } else if (sumVotes <= -4 && supporters >= 4 && score >= 80) {
    state = "Bearish";
  }

  return { state, score, sumVotes, supporters, opponents };
}

/**
 * Compute Strategy Analysis according to the 5-group ternary voting rules.
 *
 * Group 1: RSI (14) - <=30 Bullish (+1), >=70 Bearish (-1), else Neutral (0)
 * Group 2: CCI (20) - <-100 Bullish (+1), >100 Bearish (-1), else Neutral (0)
 * Group 3: MACD (12,26,9) Hist - > eps Bullish (+1), < -eps Bearish (-1), else Neutral (0)
 * Group 4: Stoch (14,3) & Will%R (14) - K,D < 20 & Will <= -80 Bullish (+1); K,D > 80 & Will >= -20 Bearish (-1); else Neutral (0)
 * Group 5: Lorentzian ML (KNN) - see src/lib/ml/lorentzian.ts
 *
 * Missing/insufficient candles (<100) returns Unavailable.
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
        lorentzianPrediction: null,
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
    contribution: (rsiVote * 20) as SignedContribution,
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
    contribution: (cciVote * 20) as SignedContribution,
    reason: cciReason,
  });

  // Group 3: MACD Histogram (12, 26, 9)
  // Real neutral dead-zone: 0.03% of price. The previous epsilon (price * 1e-10)
  // was a floating-point noise floor, not a meaningful tolerance — it voted on
  // virtually any nonzero histogram value, contradicting the "neutral tolerance"
  // this group is documented as having. This threshold requires the histogram
  // to represent genuine momentum, not crossover noise, before it votes.
  const macdEps = Math.max(1, Math.abs(price)) * 0.0003;
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
    contribution: (macdVote * 20) as SignedContribution,
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
    contribution: (stochWillVote * 20) as SignedContribution,
    reason: stochWillReason,
  });

  // Group 5: Lorentzian Classification (KNN, ported from the user-supplied
  // Pine Script — see src/lib/ml/lorentzian.ts header for exactly which
  // parts are a faithful port vs. a reconstruction of undisclosed library
  // internals).
  // Lorentzian ML gets the FULL candle history the caller passed in (up to
  // ~1000 candles from the Binance fetch), not the 100-candle windowCandles
  // used above — its ANN training set benefits from far more history than
  // the other 4 groups need for their own indicator warm-up.
  const lorentzianResult = computeLorentzianVote(candles);
  indicators.lorentzianPrediction = lorentzianResult.prediction;
  groupContributions.push({
    groupName: "Lorentzian ML (KNN)",
    vote: lorentzianResult.vote,
    contribution: (lorentzianResult.vote * 20) as SignedContribution,
    reason: lorentzianResult.reason,
  });

  const votes: [VoteValue, VoteValue, VoteValue, VoteValue, VoteValue] = [
    rsiVote,
    cciVote,
    macdVote,
    stochWillVote,
    lorentzianResult.vote,
  ];
  const { state, score, sumVotes, supporters, opponents } =
    computeSignalFromVotes(votes);

  const reasons: string[] = groupContributions
    .filter((g) => g.vote !== 0)
    .map((g) => g.reason);

  if (state === "Wait") {
    if (reasons.length === 0) {
      reasons.push("All oscillator groups currently in neutral range.");
    } else {
      reasons.push(
        `Insufficient confluence: ${supporters} supporting, ${opponents} opposing (score: ${score}/100, threshold ≥ 80).`
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