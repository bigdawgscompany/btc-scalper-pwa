import { jsonResponse, errorResponse } from "@/lib/server/http";
import { getMarketCandles } from "@/lib/market/provider";
import { validateCandleSeries } from "@/lib/market/validation";
import { computeSupertrend, computeUtBot } from "@/lib/trend";

/**
 * GET /api/trend — Supertrend + UT Bot signals for confirmed candles.
 */
export async function GET() {
  try {
    const { candles, source, observationTime } = await getMarketCandles(1000);
    const { confirmedCandles } = validateCandleSeries(candles, observationTime);
    const st = computeSupertrend(confirmedCandles);
    const ut = computeUtBot(confirmedCandles);
    return jsonResponse({
      schemaVersion: 2,
      instrument: "BTCUSDT",
      interval: "15m",
      source,
      observationTime,
      supertrend: {
        lastTrend: st.lastTrend,
        lastLevel: st.lastLevel,
        buySignal: st.buySignal,
        sellSignal: st.sellSignal,
      },
      utBot: {
        lastStop: ut.lastStop,
        lastPosition: ut.lastPosition,
        buy: ut.buy,
        sell: ut.sell,
      },
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to compute trend signals");
  }
}
