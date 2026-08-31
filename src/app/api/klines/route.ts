import { jsonResponse, errorResponse } from "@/lib/server/http";
import { getMarketCandles } from "@/lib/market/provider";

export async function GET() {
  try {
    const { candles, source, observationTime } = await getMarketCandles(1000);
    return jsonResponse({
      schemaVersion: 2,
      symbol: "BTCUSDT",
      interval: "15m",
      candles,
      source,
      observationTime,
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to fetch klines projection");
  }
}
