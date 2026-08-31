import { jsonResponse, errorResponse } from "@/lib/server/http";
import { getMarketCandles } from "@/lib/market/provider";
import { validateCandleSeries } from "@/lib/market/validation";
import { analyzeCandles } from "@/lib/signals";
import { FIXED_INSTRUMENT, FIXED_INTERVAL } from "@/lib/contracts";

export async function GET(request: Request) {
  try {
    // Reject parameter overrides — fixed instrument/interval only (§4)
    const url = new URL(request.url);
    const symbol = url.searchParams.get("symbol");
    const interval = url.searchParams.get("interval");
    if (symbol && symbol !== FIXED_INSTRUMENT) {
      return errorResponse(
        new Error(`Unsupported symbol: ${symbol}. Only ${FIXED_INSTRUMENT} is supported.`),
        "Invalid request parameter"
      );
    }
    if (interval && interval !== FIXED_INTERVAL) {
      return errorResponse(
        new Error(`Unsupported interval: ${interval}. Only ${FIXED_INTERVAL} is supported.`),
        "Invalid request parameter"
      );
    }

    const { candles, source, observationTime } = await getMarketCandles(1000);
    const { confirmedCandles } = validateCandleSeries(candles, observationTime);
    const confirmedAnalysis = analyzeCandles(confirmedCandles, false);

    // Documented projection of the shared validated layer (§4)
    return jsonResponse({
      schemaVersion: 2,
      signal: {
        state: confirmedAnalysis.state,
        score: confirmedAnalysis.score,
        sumVotes: confirmedAnalysis.sumVotes,
        candleTime: confirmedAnalysis.candleTime,
        price: confirmedCandles[confirmedCandles.length - 1]?.close ?? 0,
        reasons: confirmedAnalysis.reasons,
        oscillators: confirmedAnalysis.indicators,
        contributions: confirmedAnalysis.groupContributions,
      },
      candleCount: candles.length,
      source,
      observationTime,
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to compute signal projection");
  }
}