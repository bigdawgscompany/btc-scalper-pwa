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
});
export type IndicatorValues = z.infer<typeof IndicatorValuesSchema>;

export const VoteValueSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
export type VoteValue = z.infer<typeof VoteValueSchema>;

export const SignedContributionSchema = z.union([z.literal(-25), z.literal(0), z.literal(25)]);
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
  sumVotes: z.number().int().min(-4).max(4),
  supporters: z.number().int().min(0).max(4),
  opponents: z.number().int().min(0).max(4),
  candleTime: z.number().int(),
  isForming: z.boolean(),
  reasons: z.array(z.string()),
  indicators: IndicatorValuesSchema,
  groupContributions: z.array(GroupContributionSchema),
});
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

export const MarketResponseSchema = z.object({
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
    lagSeconds: z.number(),
    confirmedCandleTime: z.number().int(),
  }),
});
export type MarketResponse = z.infer<typeof MarketResponseSchema>;

export const QuoteResponseSchema = z.object({
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
