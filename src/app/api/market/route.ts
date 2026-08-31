import { jsonResponse, errorResponse } from "@/lib/server/http";
import { getMarketCandles } from "@/lib/market/provider";
import {
  validateCandleSeries,
  checkFreshnessAndEligibility,
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

    const { isFresh, isLagging, lagSeconds, expiresAt } =
      checkFreshnessAndEligibility(confirmedTime, observationTime);

    const responseData: MarketResponse = {
      schemaVersion: 2,
      instrument: FIXED_INSTRUMENT,
      interval: FIXED_INTERVAL,
      venue: FIXED_VENUE,
      source,
      candles: allCandles,
      confirmedAnalysis,
      provisionalAnalysis,
      observationTimestamp: observationTime,
      generatedTimestamp,
      expiresAt,
      status: {
        isLive: isFresh,
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
