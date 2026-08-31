import { jsonResponse, errorResponse } from "@/lib/server/http";
import { getMarketCandles } from "@/lib/market/provider";
import {
  validateCandleSeries,
  checkFreshnessAndEligibility,
  spansBoundary,
  isExpectedIntervalMissing,
} from "@/lib/market/validation";
import { analyzeCandles } from "@/lib/signals";
import {
  FIXED_INSTRUMENT,
  FIXED_INTERVAL,
  FIXED_VENUE,
  MarketResponseSchema,
  type MarketResponse,
} from "@/lib/contracts";

export async function GET() {
  const generatedTimestamp = Date.now();
  try {
    const { candles, source, observationTime } = await getMarketCandles(
      1000,
      false
    );

    // Validate using the frozen observation time from the fetch
    const { confirmedCandles, formingCandle, allCandles } = validateCandleSeries(
      candles,
      observationTime
    );

    const confirmedAnalysis = analyzeCandles(confirmedCandles, false);

    let provisionalAnalysis = null;
    if (formingCandle) {
      provisionalAnalysis = analyzeCandles(allCandles, true);
    }

    const lastConfirmed = confirmedCandles[confirmedCandles.length - 1];
    const confirmedTime = lastConfirmed ? lastConfirmed.closeTime : observationTime;

    // ─── Boundary-race recheck at serialization (§4) ──────────────────────
    // If the observation boundary has shifted since fetch, the forming/confirmed
    // split may be stale. Re-validate against the current time; if the boundary
    // was crossed, the forming candle may now be confirmed.
    const serializationTime = Date.now();
    let finalConfirmedCandles = confirmedCandles;
    let finalFormingCandle = formingCandle;
    let finalAllCandles = allCandles;

    if (spansBoundary(observationTime, serializationTime)) {
      const recheck = validateCandleSeries(candles, serializationTime);
      finalConfirmedCandles = recheck.confirmedCandles;
      finalFormingCandle = recheck.formingCandle;
      finalAllCandles = recheck.allCandles;
    }

    const { isFresh, isLagging, lagSeconds, expiresAt } =
      checkFreshnessAndEligibility(confirmedTime, serializationTime);

    // Early expiry if the expected next interval is missing
    const expectedMissing = lastConfirmed
      ? isExpectedIntervalMissing(lastConfirmed, serializationTime)
      : false;

    const responseData: MarketResponse = {
      schemaVersion: 2,
      instrument: FIXED_INSTRUMENT,
      interval: FIXED_INTERVAL,
      venue: FIXED_VENUE,
      source,
      candles: finalAllCandles,
      confirmedAnalysis,
      provisionalAnalysis,
      observationTimestamp: observationTime,
      generatedTimestamp,
      expiresAt: expectedMissing ? serializationTime : expiresAt,
      status: {
        isLive: isFresh && !expectedMissing,
        isLagging,
        lagSeconds,
        confirmedCandleTime: confirmedTime,
      },
    };

    MarketResponseSchema.parse(responseData);
    return jsonResponse(responseData);
  } catch (err: unknown) {
    return errorResponse(err, "Failed to assemble market analysis");
  }
}