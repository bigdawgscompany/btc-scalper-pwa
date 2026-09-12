import { jsonResponse, errorResponse } from "@/lib/server/http";
import { getMarketCandles } from "@/lib/market/provider";
import { validateCandleSeries } from "@/lib/market/validation";
import { computeLiquidityProfile } from "@/lib/liquidity";

/**
 * GET /api/liquidity — BSL/SSL zones and reversal signals for confirmed candles.
 */
export async function GET() {
  try {
    const { candles, source, observationTime } = await getMarketCandles(1000);
    const { confirmedCandles } = validateCandleSeries(candles, observationTime);
    const result = computeLiquidityProfile(confirmedCandles);
    return jsonResponse({
      schemaVersion: 2,
      instrument: "BTCUSDT",
      interval: "15m",
      source,
      observationTime,
      bslCount: result.bslZones.length,
      sslCount: result.sslZones.length,
      activeBsl: result.bslZones.filter((z) => !z.swept).slice(0, 5),
      activeSsl: result.sslZones.filter((z) => !z.swept).slice(0, 5),
      recentSignals: result.signals.slice(-10),
      attribution: result.attribution,
      license:
        "CC BY-NC-SA 4.0 — © LuxAlgo. Non-commercial use only. https://creativecommons.org/licenses/by-nc-sa/4.0/",
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to compute liquidity profile");
  }
}
