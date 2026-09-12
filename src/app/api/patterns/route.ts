import { jsonResponse, errorResponse } from "@/lib/server/http";
import { getMarketCandles } from "@/lib/market/provider";
import { validateCandleSeries } from "@/lib/market/validation";
import { detectPatterns, patternToJson } from "@/lib/patterns";

/** Handle a read-only API request for the route. */
export async function GET() {
  try {
    const { candles, source, observationTime } = await getMarketCandles(1000);
    const { confirmedCandles } = validateCandleSeries(candles, observationTime);
    const result = detectPatterns(confirmedCandles);
    return jsonResponse({
      schemaVersion: 2,
      instrument: "BTCUSDT",
      interval: "15m",
      source,
      observationTime,
      candleCount: confirmedCandles.length,
      pattern: patternToJson(result),
      license:
        "Pattern detection ported from Auto Pattern Detector Targets [MarkitTick] under CC BY-NC-SA 4.0. Non-commercial use only. https://creativecommons.org/licenses/by-nc-sa/4.0/",
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to detect patterns");
  }
}
