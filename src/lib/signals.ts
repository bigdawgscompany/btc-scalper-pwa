import {
  rsi,
  stochastic,
  macdHistogram,
  cci,
  williamsR,
  extractSeries,
} from "./indicators";
import type {
  Candle,
  OscillatorValues,
  SignalResult,
  SignalDirection,
  ConfidenceConfig,
} from "./types";

const DEFAULT_CONFIG: ConfidenceConfig = {
  minConfidence: 75,
  minConfirmations: 3,
};

/**
 * Compute oscillator matrix and high-confidence signal only.
 * Fail closed: returns NEUTRAL unless confidence and confirmations are met.
 */
export function computeSignal(
  candles: Candle[],
  config: ConfidenceConfig = DEFAULT_CONFIG
): SignalResult {
  const { closes, highs, lows } = extractSeries(candles);
  const price = closes[closes.length - 1] ?? 0;
  const timestamp = candles[candles.length - 1]?.closeTime ?? Date.now();

  const oscillators: OscillatorValues = {
    rsi: rsi(closes, 14),
    ...(() => {
      const s = stochastic(highs, lows, closes, 14, 3);
      return { stochK: s.k, stochD: s.d };
    })(),
    macdHist: macdHistogram(closes),
    cci: cci(highs, lows, closes, 20),
    willR: williamsR(highs, lows, closes, 14),
  };

  const reasons: string[] = [];
  let bullish = 0;
  let bearish = 0;
  let strength = 0;

  // RSI
  if (oscillators.rsi !== null) {
    if (oscillators.rsi <= 30) {
      bullish += 1;
      strength += (30 - oscillators.rsi) / 30;
      reasons.push(`RSI oversold (${oscillators.rsi.toFixed(1)})`);
    } else if (oscillators.rsi >= 70) {
      bearish += 1;
      strength += (oscillators.rsi - 70) / 30;
      reasons.push(`RSI overbought (${oscillators.rsi.toFixed(1)})`);
    }
  }

  // Stochastic
  if (oscillators.stochK !== null && oscillators.stochD !== null) {
    if (oscillators.stochK < 20 && oscillators.stochD < 20) {
      bullish += 1;
      strength += (20 - Math.min(oscillators.stochK, oscillators.stochD)) / 20;
      reasons.push(`Stoch oversold (K=${oscillators.stochK.toFixed(1)})`);
    } else if (oscillators.stochK > 80 && oscillators.stochD > 80) {
      bearish += 1;
      strength += (Math.min(oscillators.stochK, oscillators.stochD) - 80) / 20;
      reasons.push(`Stoch overbought (K=${oscillators.stochK.toFixed(1)})`);
    }
  }

  // MACD histogram
  if (oscillators.macdHist !== null) {
    if (oscillators.macdHist > 0) {
      bullish += 0.7;
      strength += Math.min(Math.abs(oscillators.macdHist) / 50, 1);
      reasons.push(`MACD hist positive (${oscillators.macdHist.toFixed(2)})`);
    } else if (oscillators.macdHist < 0) {
      bearish += 0.7;
      strength += Math.min(Math.abs(oscillators.macdHist) / 50, 1);
      reasons.push(`MACD hist negative (${oscillators.macdHist.toFixed(2)})`);
    }
  }

  // CCI
  if (oscillators.cci !== null) {
    if (oscillators.cci < -100) {
      bullish += 1;
      strength += Math.min(Math.abs(oscillators.cci + 100) / 100, 1);
      reasons.push(`CCI oversold (${oscillators.cci.toFixed(1)})`);
    } else if (oscillators.cci > 100) {
      bearish += 1;
      strength += Math.min(Math.abs(oscillators.cci - 100) / 100, 1);
      reasons.push(`CCI overbought (${oscillators.cci.toFixed(1)})`);
    }
  }

  // Williams %R
  if (oscillators.willR !== null) {
    if (oscillators.willR <= -80) {
      bullish += 1;
      strength += (Math.abs(oscillators.willR) - 80) / 20;
      reasons.push(`Williams %R oversold (${oscillators.willR.toFixed(1)})`);
    } else if (oscillators.willR >= -20) {
      bearish += 1;
      strength += (20 + oscillators.willR) / 20;
      reasons.push(`Williams %R overbought (${oscillators.willR.toFixed(1)})`);
    }
  }

  const totalVotes = bullish + bearish;
  const net = bullish - bearish;
  const confirmations = Math.max(bullish, bearish);

  // Confidence: combination of alignment and magnitude
  let confidence = 0;
  if (totalVotes > 0) {
    const alignment = Math.abs(net) / totalVotes;
    confidence = Math.min(100, Math.round(alignment * 60 + strength * 25 + confirmations * 8));
  }

  let direction: SignalDirection = "NEUTRAL";

  if (
    confidence >= config.minConfidence &&
    confirmations >= config.minConfirmations
  ) {
    if (net > 0) {
      direction = confidence >= 85 ? "LONG" : "BUY";
    } else if (net < 0) {
      direction = "SELL";
    }
  } else {
    reasons.push(
      `Insufficient confidence (${confidence}) or confirmations (${confirmations.toFixed(1)})`
    );
  }

  return {
    direction,
    confidence,
    oscillators,
    reasons,
    timestamp,
    price,
  };
}