import { describe, expect, it } from "vitest";
import type { AnalysisResult, QuoteResponse } from "../src/lib/contracts";
import {
  calculateEntryPrice,
  calculateExitPrice,
  calculateFee,
  closePosition,
  createInitialAccount,
  evaluateAutopilotCycle,
  openPosition,
} from "../src/lib/paper/engine";
import { DEFAULT_PAPER_CONFIG, type PaperConfig } from "../src/lib/paper/types";
import { exportTradesToCSV } from "../src/lib/paper/storage";
import { separateConfirmedAndForming } from "../src/lib/market/candles";
import type { Candle } from "../src/lib/contracts";

function makeQuote(bid: number, ask: number): QuoteResponse {
  return {
    symbol: "BTCUSDT",
    bid,
    ask,
    spread: ask - bid,
    serverObservationTimestamp: Date.now(),
  };
}

const baseAnalysis: AnalysisResult = {
  state: "Wait",
  score: 0,
  sumVotes: 0,
  supporters: 0,
  opponents: 0,
  candleTime: Date.now(),
  isForming: false,
  reasons: ["test"],
  indicators: {
    rsi: 50,
    cci: 0,
    macdHist: 0,
    macdLine: 0,
    signalLine: 0,
    stochK: 50,
    stochD: 50,
    willR: -50,
    lorentzianPrediction: 0,
  },
  groupContributions: [],
};

describe("paper engine — core behavior", () => {
  it("opens a LONG at ask + slippage", () => {
    const quote = makeQuote(50000, 50010);
    const account = createInitialAccount();
    const { fill, position } = openPosition(account, "LONG", quote, Date.now(), "d-1", "test");
    const expectedEntry = 50010 * (1 + 0.0005);
    expect(Number(fill.price)).toBeCloseTo(expectedEntry, 3);
    expect(position.entryFillId).toBe(fill.id);
  });

  it("opens a SHORT at bid - slippage", () => {
    const quote = makeQuote(50000, 50010);
    const account = createInitialAccount();
    const { fill } = openPosition(account, "SHORT", quote, Date.now(), "d-2", "test");
    const expectedEntry = 50000 * (1 - 0.0005);
    expect(Number(fill.price)).toBeCloseTo(expectedEntry, 3);
  });

  it("preserves equity when opening a position", () => {
    const quote = makeQuote(50000, 50010);
    const account = createInitialAccount();
    const { account: opened } = openPosition(account, "LONG", quote, Date.now(), "d-3", "test");
    expect(Number(opened.availableCash) + Number(opened.reservedCollateral) + Number(opened.totalFeesPaid)).toBeCloseTo(Number(account.equity), 8);
  });
});

describe("Paper engine — minimum notional", () => {
  it("rejects opening when allocation is below 10 USDT", () => {
    const tinyConfig: PaperConfig = {
      ...DEFAULT_PAPER_CONFIG,
      startingBalance: "5.00",
      entryAllocationPct: 10,
      strategyVersion: "v2.0",
    };
    const acc = createInitialAccount(tinyConfig);
    const quote = makeQuote(50000, 50010);
    expect(() => openPosition(acc, "LONG", quote, Date.now(), "d-6", "tiny")).toThrow("minimum");
  });
});

describe("Paper engine — reversal integrity", () => {
  it("records EXIT_OPPOSITE when replacement entry fails", () => {
    const config = {
      startingBalance: "10.01",
      entryAllocationPct: 100,
      stopLossPct: 1,
      takeProfitPct: 2,
      feeBps: 10,
      slippageBps: 5,
      allowOppositeReversal: true,
      strategyVersion: "v2.0",
    };
    const initial = createInitialAccount(config);
    const { account: opened } = openPosition(
      initial,
      "LONG",
      makeQuote(100, 100.1),
      Date.now(),
      "d-rev-open",
      "test"
    );
    const bearish: AnalysisResult = {
      ...baseAnalysis,
      state: "Bearish",
      score: 80,
      sumVotes: -4,
      supporters: 4,
      candleTime: Date.now(),
      reasons: ["test"],
    };
    const result = evaluateAutopilotCycle(
      opened,
      bearish,
      makeQuote(99.2, 99.3)
    );
    expect(result.updatedAccount.position).toBeNull();
    expect(result.decision.action).toBe("EXIT_OPPOSITE");
    expect(result.decision.reason).toContain("replacement entry failed");
  });
});

describe("Paper engine — close position", () => {
  it("closes a LONG at bid - slippage", () => {
    const acc = createInitialAccount();
    const quote = makeQuote(50000, 50010);
    const { account: opened } = openPosition(acc, "LONG", quote, Date.now(), "d-7", "test");

    const closeQuote = makeQuote(51000, 51010);
    const { fill } = closePosition(opened, closeQuote, "TAKE_PROFIT", "d-8", Date.now());
    const expectedExit = 51000 * (1 - 0.0005);
    expect(Number(fill.price)).toBeCloseTo(expectedExit, 3);
  });

  it("closes a SHORT at ask + slippage", () => {
    const acc = createInitialAccount();
    const quote = makeQuote(50000, 50010);
    const { account: opened } = openPosition(acc, "SHORT", quote, Date.now(), "d-9", "test");

    const closeQuote = makeQuote(49000, 49010);
    const { fill } = closePosition(opened, closeQuote, "TAKE_PROFIT", "d-10", Date.now());
    const expectedExit = 49010 * (1 + 0.0005);
    expect(Number(fill.price)).toBeCloseTo(expectedExit, 3);
  });

  it("netPnl equals grossPnl minus all fees", () => {
    const acc = createInitialAccount();
    const quote = makeQuote(50000, 50010);
    const { account: opened } = openPosition(acc, "LONG", quote, Date.now(), "d-11", "test");
    const close = closePosition(opened, makeQuote(51000, 51010), "TAKE_PROFIT", "d-12", Date.now());
    expect(Number(close.closedTrade.netPnl)).toBeCloseTo(
      Number(close.closedTrade.grossPnl) - Number(close.closedTrade.totalFees),
      8
    );
  });
});

describe("Paper engine — formula helpers", () => {
  it("calculateEntryPrice LONG = ask * (1 + slippageBps/10000)", () => {
    expect(calculateEntryPrice("LONG", new (require("decimal.js").Decimal)(100), new (require("decimal.js").Decimal)(99), 5).toNumber()).toBeCloseTo(100.05, 8);
  });

  it("calculateEntryPrice SHORT = bid * (1 - slippageBps/10000)", () => {
    expect(calculateEntryPrice("SHORT", new (require("decimal.js").Decimal)(100), new (require("decimal.js").Decimal)(99), 5).toNumber()).toBeCloseTo(98.995, 8);
  });

  it("calculateFee = notional * bps/10000", () => {
    expect(calculateFee(new (require("decimal.js").Decimal)(1000), 10).toNumber()).toBeCloseTo(1, 8);
  });

  it("calculateExitPrice respects side", () => {
    expect(calculateExitPrice("LONG", new (require("decimal.js").Decimal)(101), new (require("decimal.js").Decimal)(100), 5).toNumber()).toBeCloseTo(99.95, 8);
    expect(calculateExitPrice("SHORT", new (require("decimal.js").Decimal)(101), new (require("decimal.js").Decimal)(100), 5).toNumber()).toBeCloseTo(101.0505, 8);
  });
});

describe("trade export", () => {
  it("emits valid CSV with headers", () => {
    expect(exportTradesToCSV([])).toContain("Trade ID");
  });
});

describe("candle separation", () => {
  it("separates confirmed from forming candle", () => {
    const now = Date.now();
    const candles: Candle[] = [
      { openTime: now - 900_000, open: 1, high: 1, low: 1, close: 1, volume: 1, closeTime: now - 1 },
      { openTime: now, open: 1, high: 1, low: 1, close: 1, volume: 1, closeTime: now + 899_999 },
    ];
    const result = separateConfirmedAndForming(candles, now);
    expect(result.forming).toHaveLength(1);
    expect(result.confirmed).toHaveLength(1);
  });
});
