import { jsonResponse, errorResponse } from "@/lib/server/http";
import { getExecutableQuote } from "@/lib/market/provider";
import { QuoteResponseSchema } from "@/lib/contracts";

export async function GET() {
  try {
    const quote = await getExecutableQuote();
    QuoteResponseSchema.parse(quote);
    return jsonResponse(quote);
  } catch (err: unknown) {
    return errorResponse(err, "Failed to fetch executable quote");
  }
}
