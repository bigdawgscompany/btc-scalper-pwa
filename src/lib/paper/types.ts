export type PositionSide = "LONG" | "SHORT";

export type PaperConfig = {
  startingBalance: string; // "10000.00"
  entryAllocationPct: number; // 1 - 100, default 10
  stopLossPct: number; // 0.1 - 50, default 1.0
  takeProfitPct: number; // 0.1 - 50, default 2.0
  feeBps: number; // 0 - 100, default 10
  slippageBps: number; // 0 - 100, default 5
  allowOppositeReversal: boolean; // default true
  strategyVersion: string; // "v2.0"
};

export const DEFAULT_PAPER_CONFIG: PaperConfig = {
  startingBalance: "10000.00",
  entryAllocationPct: 10,
  stopLossPct: 1.0,
  takeProfitPct: 2.0,
  feeBps: 10,
  slippageBps: 5,
  allowOppositeReversal: true,
  strategyVersion: "v2.0",
};

export type PaperPosition = {
  id: string;
  side: PositionSide;
  quantity: string; // Decimal string 8 decimals
  entryPrice: string; // Decimal string
  entryTime: number;
  entryCandleTime: number;
  entryFee: string;
  entryNotional: string;
  reservedCollateral: string;
  stopPrice: string;
  targetPrice: string;
  unrealizedPnl: string;
  markPrice: string;
  lastUpdated: number;
  config: PaperConfig;
};

export type PaperFill = {
  id: string;
  decisionId: string;
  timestamp: number;
  side: "BUY" | "SELL";
  price: string;
  quantity: string;
  notional: string;
  fee: string;
  slippageApplied: string;
  reason: string;
};

export type ClosedTrade = {
  id: string;
  positionId: string;
  side: PositionSide;
  quantity: string;
  entryPrice: string;
  exitPrice: string;
  entryTime: number;
  exitTime: number;
  grossPnl: string;
  totalFees: string;
  netPnl: string;
  returnPct: string;
  closeReason: "STOP_LOSS" | "TAKE_PROFIT" | "OPPOSITE_SIGNAL" | "MANUAL";
  entryFillId: string;
  exitFillId: string;
};

export type PaperDecision = {
  id: string;
  timestamp: number;
  confirmedCandleTime: number;
  strategyVersion: string;
  action: "ENTER_LONG" | "ENTER_SHORT" | "EXIT_STOP" | "EXIT_TARGET" | "REVERSE" | "MANUAL_CLOSE" | "HOLD";
  reason: string;
  signalState: string;
  signalScore: number;
  quoteBid: string;
  quoteAsk: string;
};

export type EquityObservation = {
  id: string;
  timestamp: number;
  equity: string;
  availableCash: string;
  reservedCollateral: string;
  unrealizedPnl: string;
  hasOpenPosition: boolean;
  isPausedGap?: boolean;
};

export type PaperAccountState = {
  id: string; // "primary"
  availableCash: string; // Decimal string
  reservedCollateral: string; // Decimal string
  realizedPnl: string; // Decimal string
  totalFeesPaid: string; // Decimal string
  equity: string; // Decimal string
  position: PaperPosition | null;
  isRunning: boolean;
  isPaused: boolean;
  lastCandleEvaluated: number;
  lastExitCandleTime: number | null; // blocks same-candle re-entry
  config: PaperConfig;
  updatedAt: number;
};
