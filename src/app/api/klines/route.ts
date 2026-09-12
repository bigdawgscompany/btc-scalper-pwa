import { jsonResponse, errorResponse, parseStrictQuery } from "@/lib/server/http";
import { getMarketCandles } from "@/lib/market/provider";
import { FIXED_INSTRUMENT, FIXED_INTERVAL } from "@/lib/contracts";

/** Handle and validate a read-only API request for the route. */
export async function GET(request: Request) {
  try {
    // Reject unknown, duplicate, or unsupported parameter keys.
    const params = parseStrictQuery(request, ["symbol", "interval"]);
    const symbol = params.symbol;
    const interval = params.interval;
    if (symbol !== undefined && symbol !== FIXED_INSTRUMENT) {
      return errorResponse(
        new Error(`Unsupported symbol: ${symbol}. Only ${FIXED_INSTRUMENT} is supported.`),
        "Invalid request parameter"
      );
    }
    if (interval !== undefined && interval !== FIXED_INTERVAL) {
      return errorResponse(
        new Error(`Unsupported interval: ${interval}. Only ${FIXED_INTERVAL} is supported.`),
        "Invalid request parameter"
      );
    }

    const { candles, source, observationTime } = await getMarketCandles(1000);
    return jsonResponse({
      schemaVersion: 2,
      symbol: FIXED_INSTRUMENT,
      interval: FIXED_INTERVAL,
      candles,
      source,
      observationTime,
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to fetch klines projection");
  }
}