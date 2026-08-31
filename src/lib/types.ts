export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

export type OscillatorValues = {
  rsi: number | null;
  stochK: number | null;
  stochD: number | null;
  macdHist: number | null;
  cci: number | null;
  willR: number | null;
};

export type SignalDirection = "BUY" | "SELL" | "LONG" | "SHORT" | "NEUTRAL";

export type SignalResult = {
  direction: SignalDirection;
  confidence: number; // 0-100
  oscillators: OscillatorValues;
  reasons: string[];
  timestamp: number;
  price: number;
};

export type SignalHistoryItem = {
  id: string;
  timestamp: number;
  price: number;
  direction: SignalDirection;
  confidence: number;
  source: string;
};

export type ConfidenceConfig = {
  minConfidence: number; // default 75
  minConfirmations: number; // default 3
};