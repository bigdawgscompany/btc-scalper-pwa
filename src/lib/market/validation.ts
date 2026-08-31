import { INTERVAL_MS, type Candle } from "../contracts";
import { ValidationError } from "./errors";

/**
 * Validate and clean an individual raw candle.
 */
export function validateSingleCandle(
  openTime: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
  closeTime?: number
): Candle {
  if (!Number.isFinite(openTime) || openTime <= 0 || openTime % INTERVAL_MS !== 0) {
    throw new ValidationError(
      `Candle openTime ${openTime} is not aligned to a 15-minute boundary.`
    );
  }

  if (
    !Number.isFinite(open) ||
    !Number.isFinite(high) ||
    !Number.isFinite(low) ||
    !Number.isFinite(close) ||
    open <= 0 ||
    high <= 0 ||
    low <= 0 ||
    close <= 0
  ) {
    throw new ValidationError("Candle OHLC prices must be finite positive numbers.");
  }

  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
    throw new ValidationError(
      `Inconsistent OHLC range: H=${high}, L=${low}, O=${open}, C=${close}`
    );
  }

  if (!Number.isFinite(volume) || volume < 0) {
    throw new ValidationError(`Candle volume must be non-negative. Received: ${volume}`);
  }

  const expectedCloseTime = openTime + INTERVAL_MS - 1;
  const actualCloseTime = closeTime ?? expectedCloseTime;

  return {
    openTime,
    open,
    high,
    low,
    close,
    volume,
    closeTime: actualCloseTime,
  };
}

/**
 * Validate a series of candles ensuring:
 * 1. Strict chronology (sorted ascending).
 * 2. No gaps between consecutive 15m intervals.
 * 3. No duplicate timestamps.
 * 4. No future timestamps beyond reasonable clock skew.
 */
export function validateCandleSeries(
  candles: Candle[],
  observationTimestamp = Date.now()
): {
  confirmedCandles: Candle[];
  formingCandle: Candle | null;
  allCandles: Candle[];
} {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new ValidationError("Candle series is empty or not an array.");
  }

  // 1. Sort ascending by openTime
  const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);

  // 2. Validate chronology & contiguous intervals
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];

    // Check future candle with 60s clock skew tolerance
    if (current.openTime > observationTimestamp + 60_000) {
      throw new ValidationError(
        `Candle timestamp ${current.openTime} is in the future relative to observation ${observationTimestamp}.`
      );
    }

    if (i > 0) {
      const prev = sorted[i - 1];
      if (current.openTime === prev.openTime) {
        throw new ValidationError(`Duplicate candle timestamp detected at ${current.openTime}`);
      }
      if (current.openTime < prev.openTime) {
        throw new ValidationError("Candles are not in ascending chronological order.");
      }
      if (current.openTime !== prev.openTime + INTERVAL_MS) {
        throw new ValidationError(
          `Gap detected in 15m series between ${prev.openTime} and ${current.openTime}`
        );
      }
    }
  }

  // 3. Separate confirmed (closed) candles from the currently forming candle
  const lastCandle = sorted[sorted.length - 1];
  let formingCandle: Candle | null = null;
  let confirmedCandles: Candle[] = sorted;

  // A candle is forming if observationTimestamp is before its closeTime
  if (observationTimestamp < lastCandle.closeTime) {
    formingCandle = lastCandle;
    confirmedCandles = sorted.slice(0, -1);
  }

  return {
    confirmedCandles,
    formingCandle,
    allCandles: sorted,
  };
}

/**
 * Verify market data freshness and eligibility:
 * - Allow at most 60s provider lag immediately after boundary.
 * - Eligibility expires at most 16 minutes after candle close.
 */
export function checkFreshnessAndEligibility(
  confirmedCandleTime: number,
  observationTimestamp: number
): {
  isFresh: boolean;
  isLagging: boolean;
  lagSeconds: number;
  expiresAt: number;
} {
  const ageMs = Math.max(0, observationTimestamp - confirmedCandleTime);
  const ageSeconds = Math.floor(ageMs / 1000);

  // Confirmed candle close happens at candle.closeTime.
  // The next candle closes at candle.closeTime + 15m.
  // Provider lag is acceptable up to 60s into the next interval.
  const lagSeconds = Math.max(0, ageSeconds - 15 * 60);
  const isLagging = lagSeconds > 60;
  const isFresh = ageMs <= 16 * 60 * 1000; // 16 minutes max validity
  const expiresAt = confirmedCandleTime + 16 * 60 * 1000;

  return {
    isFresh,
    isLagging,
    lagSeconds,
    expiresAt,
  };
}
