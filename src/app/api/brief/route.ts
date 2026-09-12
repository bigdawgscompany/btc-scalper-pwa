/**
 * Optional professional briefing via Vercel AI Gateway.
 *
 * The *signal and action* remain 100% deterministic (buildGuidance).
 * This route only rephrases structured facts into a short operator brief.
 * If AI_GATEWAY_API_KEY is missing, returns a deterministic text brief
 * with no model call.
 */

import { jsonResponse, errorResponse } from "@/lib/server/http";
import { getMarketCandles } from "@/lib/market/provider";
import { validateCandleSeries } from "@/lib/market/validation";
import { analyzeCandles } from "@/lib/signals";
import { buildGuidance } from "@/lib/guidance";

function deterministicBrief(
  guidance: ReturnType<typeof buildGuidance>,
  price: number
): string {
  const lines = [
    `BTCUSDT 15m · ${guidance.action} · bias ${guidance.bias}`,
    `Score ${guidance.score}/100 · ${guidance.supporters} support / ${guidance.opponents} oppose`,
    `Last close ≈ ${price.toFixed(2)} USDT`,
    guidance.directive,
    "",
    "Conditions:",
    ...guidance.conditions.map((c) => `• ${c}`),
    "",
    "Invalidation:",
    ...guidance.invalidation.map((c) => `• ${c}`),
    "",
    "Risk:",
    ...guidance.riskNotes.map((c) => `• ${c}`),
  ];
  return lines.join("\n");
}

/** Handle a read-only API request for the route. */
export async function GET() {
  try {
    const { candles, observationTime } = await getMarketCandles(1000);
    const { confirmedCandles } = validateCandleSeries(candles, observationTime);
    const analysis = analyzeCandles(confirmedCandles, false);
    const guidance = buildGuidance(analysis);
    const price = confirmedCandles[confirmedCandles.length - 1]?.close ?? 0;
    const baseBrief = deterministicBrief(guidance, price);

    const apiKey = process.env.AI_GATEWAY_API_KEY;
    if (!apiKey) {
      return jsonResponse({
        schemaVersion: 2,
        source: "deterministic",
        brief: baseBrief,
        guidance,
        model: null,
      });
    }

    // Structured facts only — model may rephrase, not invent new signals
    const system = [
      "You are a professional crypto research operator for a PAPER-ONLY terminal.",
      "Rewrite the provided structured facts into a tight 6–10 line operator brief.",
      "Rules:",
      "- Do not invent indicators, scores, probabilities, or win rates.",
      "- Do not recommend live trading or position sizes beyond what the facts state.",
      "- Use plain language: LONG / SHORT / STAY FLAT / NO TRADE.",
      "- Keep invalidation and risk notes explicit.",
      "- No motivational language, no emojis, no disclaimers beyond the facts.",
    ].join(" ");

    const user = `Facts:\n${baseBrief}`;

    const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.AI_GATEWAY_MODEL || "openai/gpt-4.1-mini",
        temperature: 0.2,
        max_tokens: 500,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      // Fall back to deterministic brief — never fail the operator on AI outage
      return jsonResponse({
        schemaVersion: 2,
        source: "deterministic_fallback",
        brief: baseBrief,
        guidance,
        model: null,
        gatewayError: `HTTP ${res.status}${errText ? `: ${errText.slice(0, 200)}` : ""}`,
      });
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return jsonResponse({
        schemaVersion: 2,
        source: "deterministic_fallback",
        brief: baseBrief,
        guidance,
        model: null,
      });
    }

    return jsonResponse({
      schemaVersion: 2,
      source: "ai_gateway",
      brief: text,
      guidance,
      model: process.env.AI_GATEWAY_MODEL || "openai/gpt-4.1-mini",
    });
  } catch (err: unknown) {
    return errorResponse(err, "Failed to build operator brief");
  }
}
