import { jsonResponse, errorResponse } from "@/lib/server/http";
import { getMarketCandles } from "@/lib/market/provider";
import { validateCandleSeries } from "@/lib/market/validation";
import { computeSmc } from "@/lib/smc";

/**
 * GET /api/smc — Smart Money Concepts snapshot for confirmed candles.
 */
export async function GET() {
  try {
    const { candles, source, observationTime } = await getMarketCandles(1000);
    const { confirmedCandles } = validateCandleSeries(candles, observationTime);
    const r = computeSmc(confirmedCandles);
    const lastStruct = r.structures.length
      ? r.structures[r.structures.length - 1]
      : null;
    return jsonResponse({
      schemaVersion: 2,
      instrument: "BTCUSDT",
      interval: "15m",
      source,
      observationTime,
      swingBias: r.swingBias,
      internalBias: r.internalBias,
      lastStructure: lastStruct,
      activeOrderBlocks: r.orderBlocks.slice(0, 8),
      equalLevels: r.equalLevels,
      openFvgs: r.fvgs.slice(0, 8),
      premiumTop: r.premiumTop,
      discountBottom: r.discountBottom,
      equilibrium: r.equilibrium,
      attribution: r.attribution,
      license:
        "CC BY-NC-SA 4.0 — © LuxAlgo. Non-commercial use only. https://creativecommons.org/licenses/by-nc-sa/4.0/",
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to compute SMC");
  }
}
