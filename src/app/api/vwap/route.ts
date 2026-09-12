import { jsonResponse, errorResponse } from "@/lib/server/http";
import { getMarketCandles } from "@/lib/market/provider";
import { validateCandleSeries } from "@/lib/market/validation";
import { computeSwingAnchoredVwap } from "@/lib/vwap";

/**
 * GET /api/vwap — swing-anchored VWAP snapshot for confirmed BTCUSDT 15m candles.
 */
export async function GET() {
  try {
    const { candles, source, observationTime } = await getMarketCandles(1000);
    const { confirmedCandles } = validateCandleSeries(candles, observationTime);
    const result = computeSwingAnchoredVwap(confirmedCandles);
    return jsonResponse({
      schemaVersion: 2,
      instrument: "BTCUSDT",
      interval: "15m",
      source,
      observationTime,
      direction: result.direction,
      lastVwap: result.lastVwap,
      apt: result.apt,
      atrRatio: result.atrRatio,
      pivotCount: result.pivots.length,
      lastPivots: result.pivots.slice(-8),
      attribution: result.attribution,
      license:
        "CC BY-NC-SA 4.0 — © Zeiierman. Non-commercial use only. https://creativecommons.org/licenses/by-nc-sa/4.0/",
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to compute swing VWAP");
  }
}
