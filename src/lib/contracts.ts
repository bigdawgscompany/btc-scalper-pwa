import { z } from "zod";

export const SCHEMA_VERSION = 2 as const;
export const FIXED_INSTRUMENT = "BTCUSDT" as const;
export const FIXED_INTERVAL = "15m" as const;
export const FIXED_VENUE = "Binance" as const;
export const INTERVAL_MS = 15 * 60 * 1000; // 900,000 ms

export const SignalStateEnum = z.enum(["Bullish", "Bearish", "Wait", "Unavailable"]);
export type SignalState = z.infer<typeof SignalStateEnum>;

export const CandleSchema = z.object({
  openTime: z.number().int().nonnegative(),
  open: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  close: z.number().positive(),
  volume: z.number().nonnegative(),
  closeTime: z.number().int().nonnegative(),
});
export type Candle = z.infer<typeof CandleSchema>;

export const IndicatorValuesSchema = z.object({
  rsi: z.number().min(0).max(100).nullable(),
  cci: z.number().nullable(),
  macdHist: z.number().nullable(),
  macdLine: z.number().nullable(),
  signalLine: z.number().nullable(),
  stochK: z.number().min(0).max(100).nullable(),
  stochD: z.number().min(0).max(100).nullable(),
  willR: z.number().min(-100).max(0).nullable(),
  lorentzianPrediction: z.number().nullable(),
});
export type IndicatorValues = z.infer<typeof IndicatorValuesSchema>;

export const VoteValueSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
export type VoteValue = z.infer<typeof VoteValueSchema>;

// 5 equal-weight groups (100 / 5 = 20 each) — was 4 groups at 25 each before
// the Lorentzian ML group was added.
export const SignedContributionSchema = z.union([z.literal(-20), z.literal(0), z.literal(20)]);
export type SignedContribution = z.infer<typeof SignedContributionSchema>;

export const GroupContributionSchema = z.object({
  groupName: z.string(),
  vote: VoteValueSchema,
  contribution: SignedContributionSchema,
  reason: z.string(),
});
export type GroupContribution = z.infer<typeof GroupContributionSchema>;

export const AnalysisResultSchema = z.object({
  state: SignalStateEnum,
  score: z.number().min(0).max(100),
  sumVotes: z.number().int().min(-5).max(5),
  supporters: z.number().int().min(0).max(5),
  opponents: z.number().int().min(0).max(5),
  candleTime: z.number().int(),
  isForming: z.boolean(),
  reasons: z.array(z.string()),
  indicators: IndicatorValuesSchema,
  groupContributions: z.array(GroupContributionSchema),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const MarketResponseSchema = z
  .object({
    schemaVersion: z.literal(2),
    instrument: z.literal(FIXED_INSTRUMENT),
    interval: z.literal(FIXED_INTERVAL),
    venue: z.literal(FIXED_VENUE),
    source: z.string(),
    candles: z.array(CandleSchema),
    confirmedAnalysis: AnalysisResultSchema,
    provisionalAnalysis: AnalysisResultSchema.nullable(),
    observationTimestamp: z.number().int(),
    generatedTimestamp: z.number().int(),
    expiresAt: z.number().int(),
    status: z.object({
      isLive: z.boolean(),
      isLagging: z.boolean(),
      lagSeconds: z.number().nonnegative(),
      confirmedCandleTime: z.number().int(),
    }),
  })
  .refine((value) => value.confirmedAnalysis.isForming === false, {
    message: "Confirmed analysis must never be marked as forming",
  })
  .refine(
    (value) => value.confirmedAnalysis.candleTime === value.status.confirmedCandleTime,
    { message: "Confirmed analysis and status candle times must match" }
  )
  .refine(
    (value) => value.provisionalAnalysis === null || value.provisionalAnalysis.isForming === true,
    { message: "Provisional analysis must be marked as forming" }
  );
export type MarketResponse = z.infer<typeof MarketResponseSchema>;

export const QuoteResponseSchema = z
  .object({
    schemaVersion: z.literal(2),
    instrument: z.literal(FIXED_INSTRUMENT),
    provider: z.string(),
    bid: z.number().positive(),
    ask: z.number().positive(),
    bidQty: z.number().nonnegative(),
    askQty: z.number().nonnegative(),
    spread: z.number().nonnegative(),
    requestStartTimestamp: z.number().int(),
    serverObservationTimestamp: z.number().int(),
  })
  .refine((value) => value.ask >= value.bid, { message: "Ask must be >= bid" })
  .refine((value) => Math.abs(value.spread - (value.ask - value.bid)) < 1e-12, {
    message: "Spread must equal ask - bid",
  })
  .refine((value) => value.serverObservationTimestamp >= value.requestStartTimestamp, {
    message: "Server observation timestamp must be >= request start timestamp",
  });
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

export const ErrorResponseSchema = z.object({
  schemaVersion: z.literal(2),
  error: z.object({
    code: z.string(),
    message: z.string(),
    timestamp: z.number().int(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
