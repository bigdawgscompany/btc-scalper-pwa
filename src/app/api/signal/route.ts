import { jsonResponse, errorResponse } from "@/lib/server/http";
import { getMarketCandles } from "@/lib/market/provider";
import { validateCandleSeries } from "@/lib/market/validation";
import { analyzeCandles } from "@/lib/signals";

export async function GET() {
  try {
    const { candles, source, observationTime } = await getMarketCandles(1000);
    const { confirmedCandles } = validateCandleSeries(candles, observationTime);
    const confirmedAnalysis = analyzeCandles(confirmedCandles, false);

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
