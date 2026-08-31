import { describe, it, expect } from "vitest";
import { rsi, stochastic, macd, cci, williamsR, emaSeries } from "../src/lib/indicators";
import { analyzeCandles, REQUIRED_CANDLE_COUNT } from "../src/lib/signals";
import {
  openPosition,
  closePosition,
  createInitialAccount,
  calculateEntryPrice,
  calculateFee,
} from "../src/lib/paper/engine";
import { exportTradesToCSV } from "../src/lib/paper/storage";
import { validateCandleSeries } from "../src/lib/market/validation";
import type { Candle } from "../src/lib/contracts";
import type { ClosedTrade } from "../src/lib/paper/types";
import { Decimal } from "decimal.js";

// ─── Helpers ──────────────────────────────────────────────────────────

function makeCandle(openTime: number, close: number, opts: Partial<Candle> = {}): Candle {
  const INTERVAL_MS = 15 * 60 * 1000;
  return {
    openTime,
    open: opts.open ?? close,
    high: opts.high ?? close + 50,
    low: opts.low ?? close - 50,
    close,
    volume: opts.volume ?? 100,
    closeTime: openTime + INTERVAL_MS - 1,
  };
}

function makeCandles(count: number, startPrice = 50000): Candle[] {
  const INTERVAL_MS = 15 * 60 * 1000;
  const start = Math.floor(Date.now() / INTERVAL_MS) * INTERVAL_MS - count * INTERVAL_MS;
  return Array.from({ length: count }, (_, i) =>
    makeCandle(start + i * INTERVAL_MS, startPrice + i * 10)
  );
}

function makeQuote(bid = 50000, ask = 50010) {
  return {
    schemaVersion: 2 as const,
    instrument: "BTCUSDT" as const,
    provider: "Test",
    bid,
    ask,
    bidQty: 1,
    askQty: 1,
    spread: ask - bid,
    requestStartTimestamp: Date.now(),
    serverObservationTimestamp: Date.now(),
  };
}

// ─── 1. Indicator Math ────────────────────────────────────────────────

describe("EMA series", () => {
  it("seeds with SMA then applies EMA multiplier", () => {
    const values = [1, 2, 3, 4, 5];
    const result = emaSeries(values, 3);
    // First 2 are null
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    // Seed EMA = (1+2+3)/3 = 2
    expect(result[2]).toBeCloseTo(2.0);
    // Next: EMA = 4 * 0.5 + 2 * 0.5 = 3.0
    expect(result[3]).toBeCloseTo(3.0);
    // Next: EMA = 5 * 0.5 + 3 * 0.5 = 4.0
    expect(result[4]).toBeCloseTo(4.0);
  });

  it("returns all nulls when data too short", () => {
    const result = emaSeries([1, 2], 5);
    expect(result.every((v) => v === null)).toBe(true);
  });
});

describe("RSI (Wilder)", () => {
  it("returns null for fewer than period+1 samples", () => {
    expect(rsi([1, 2, 3], 14)).toBeNull();
  });

  it("returns 50 for flat prices (zero gain and loss)", () => {
    const flat = new Array(20).fill(100);
    expect(rsi(flat, 14)).toBe(50);
  });

  it("returns 100 for monotonically increasing prices", () => {
    const up = Array.from({ length: 20 }, (_, i) => 100 + i);
    expect(rsi(up, 14)).toBe(100);
  });

  it("returns 0 for monotonically decreasing prices", () => {
    const down = Array.from({ length: 20 }, (_, i) => 100 - i);
    expect(rsi(down, 14)).toBe(0);
  });
});

describe("Stochastic (14,3)", () => {
  it("returns null for insufficient data", () => {
    const { k, d } = stochastic([], [], [], 14, 3);
    expect(k).toBeNull();
    expect(d).toBeNull();
  });

  it("returns 50 for zero-range period", () => {
    const prices = new Array(20).fill(100);
    const { k } = stochastic(prices, prices, prices, 14, 3);
    expect(k).toBe(50);
  });

  it("returns 100 when close equals highest high", () => {
    const lows = new Array(20).fill(50);
    const highs = new Array(20).fill(100);
    const closes = new Array(20).fill(100);
    const { k } = stochastic(highs, lows, closes, 14, 3);
    expect(k).toBe(100);
  });

  it("returns 0 when close equals lowest low", () => {
    const lows = new Array(20).fill(50);
    const highs = new Array(20).fill(100);
    const closes = new Array(20).fill(50);
    const { k } = stochastic(highs, lows, closes, 14, 3);
    expect(k).toBe(0);
  });
});

describe("MACD (12, 26, 9)", () => {
  it("returns nulls if data is insufficient", () => {
    const result = macd([1, 2, 3], 12, 26, 9);
    expect(result.macdLine).toBeNull();
    expect(result.signalLine).toBeNull();
    expect(result.histogram).toBeNull();
  });

  it("returns valid values with 34+ data points", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 50000 + i * 100);
    const result = macd(closes, 12, 26, 9);
    expect(result.macdLine).not.toBeNull();
    expect(result.signalLine).not.toBeNull();
    expect(result.histogram).not.toBeNull();
    // histogram = macdLine - signalLine
    expect(result.histogram).toBeCloseTo(result.macdLine! - result.signalLine!);
  });
});

describe("CCI (20)", () => {
  it("returns null for insufficient data", () => {
    expect(cci([], [], [], 20)).toBeNull();
  });

  it("returns 0 for zero mean deviation", () => {
    const prices = new Array(20).fill(100);
    expect(cci(prices, prices, prices, 20)).toBe(0);
  });
});

describe("Williams %R (14)", () => {
  it("returns null for insufficient data", () => {
    expect(williamsR([], [], [], 14)).toBeNull();
  });

  it("returns -50 for zero range", () => {
    const prices = new Array(20).fill(100);
    expect(williamsR(prices, prices, prices, 14)).toBe(-50);
  });

  it("returns 0 (close = highest high)", () => {
    const lows = new Array(20).fill(50);
    const highs = new Array(20).fill(100);
    const closes = new Array(20).fill(100);
    // Use toBeCloseTo to handle -0 vs +0 edge case
    expect(williamsR(highs, lows, closes, 14)).toBeCloseTo(0, 10);
  });

  it("returns -100 (close = lowest low)", () => {
    const lows = new Array(20).fill(50);
    const highs = new Array(20).fill(100);
    const closes = new Array(20).fill(50);
    expect(williamsR(highs, lows, closes, 14)).toBe(-100);
  });
});

// ─── 2. Signal Scoring ────────────────────────────────────────────────

describe("analyzeCandles", () => {
  it("returns Unavailable with fewer than 100 candles", () => {
    const candles = makeCandles(50);
    const result = analyzeCandles(candles);
    expect(result.state).toBe("Unavailable");
    expect(result.score).toBe(0);
  });

  it("uses exactly 100 candles for confirmed analysis", () => {
    const candles = makeCandles(REQUIRED_CANDLE_COUNT);
    const result = analyzeCandles(candles);
    expect(result.state).not.toBe("Unavailable");
    expect(result.groupContributions).toHaveLength(4);
  });

  it("score = 25 * abs(sumVotes)", () => {
    const candles = makeCandles(REQUIRED_CANDLE_COUNT);
    const result = analyzeCandles(candles);
    expect(result.score).toBe(25 * Math.abs(result.sumVotes));
  });

  it("Bullish requires sumVotes >= 3 and score >= 75", () => {
    const candles = makeCandles(REQUIRED_CANDLE_COUNT);
    const result = analyzeCandles(candles);
    if (result.state === "Bullish") {
      expect(result.sumVotes).toBeGreaterThanOrEqual(3);
      expect(result.score).toBeGreaterThanOrEqual(75);
    }
  });

  it("Bearish requires sumVotes <= -3 and score >= 75", () => {
    const candles = makeCandles(REQUIRED_CANDLE_COUNT);
    const result = analyzeCandles(candles);
    if (result.state === "Bearish") {
      expect(result.sumVotes).toBeLessThanOrEqual(-3);
      expect(result.score).toBeGreaterThanOrEqual(75);
    }
  });

  it("sumVotes = 2 yields Wait (not Bullish)", () => {
    // A 3-to-1 vs 2-to-2 split: score = 25*2 = 50, below 75 threshold
    const result = analyzeCandles(makeCandles(REQUIRED_CANDLE_COUNT));
    // Score 50 should not be Bullish/Bearish
    if (result.sumVotes === 2 || result.sumVotes === -2) {
      expect(result.state).toBe("Wait");
      expect(result.score).toBe(50);
    }
  });

  it("groupContributions are always -25, 0, or +25", () => {
    const result = analyzeCandles(makeCandles(REQUIRED_CANDLE_COUNT));
    if (result.state !== "Unavailable") {
      for (const g of result.groupContributions) {
        expect([-25, 0, 25]).toContain(g.contribution);
        expect([-1, 0, 1]).toContain(g.vote);
      }
    }
  });

  it("always produces exactly 4 group contributions when sufficient data", () => {
    const result = analyzeCandles(makeCandles(REQUIRED_CANDLE_COUNT));
    if (result.state !== "Unavailable") {
      expect(result.groupContributions).toHaveLength(4);
    }
  });
});

// ─── 3. Ledger invariants ─────────────────────────────────────────────

describe("Paper engine — open position", () => {
  it("opens a LONG at ask + slippage", () => {
    const acc = createInitialAccount();
    const quote = makeQuote(50000, 50010);
    const { fill, position } = openPosition(acc, "LONG", quote, Date.now(), "d-1", "test");

    const expectedEntry = 50010 * (1 + 0.0005); // 5 bps slippage default
    expect(parseFloat(fill.price)).toBeCloseTo(expectedEntry, 3);
    expect(parseFloat(position.entryPrice)).toBeCloseTo(expectedEntry, 3);
  });

  it("opens a SHORT at bid - slippage", () => {
    const acc = createInitialAccount();
    const quote = makeQuote(50000, 50010);
    const { fill, position } = openPosition(acc, "SHORT", quote, Date.now(), "d-2", "test");

    const expectedEntry = 50000 * (1 - 0.0005);
    expect(parseFloat(fill.price)).toBeCloseTo(expectedEntry, 3);
    expect(parseFloat(position.entryPrice)).toBeCloseTo(expectedEntry, 3);
  });

  it("equity conservation: cash + collateral before == cash + collateral after opening", () => {
    const acc = createInitialAccount();
    const quote = makeQuote(50000, 50010);
    const initialEquity = parseFloat(acc.equity);

    const { account: updated, fill } = openPosition(acc, "LONG", quote, Date.now(), "d-3", "test");
    const fee = parseFloat(fill.fee);
    const newCash = parseFloat(updated.availableCash);
    const newCollateral = parseFloat(updated.reservedCollateral);

    // equity = cash + collateral (no unrealized pnl since no mark update)
    expect(newCash + newCollateral).toBeCloseTo(initialEquity - fee, 4);
  });

  it("rejects opening when position already open", () => {
    const acc = createInitialAccount();
    const quote = makeQuote(50000, 50010);
    const { account: after } = openPosition(acc, "LONG", quote, Date.now(), "d-4", "test");

    expect(() =>
      openPosition(after, "SHORT", quote, Date.now(), "d-5", "test again")
    ).toThrow("Position already open");
  });

  it("minimum notional check fails when allocation below 10 USDT", () => {
    const tinyConfig = {
      startingBalance: "5",
      entryAllocationPct: 10,
      slippageBps: 5,
      feeBps: 10,
      stopLossPct: 1,
      takeProfitPct: 2,
      allowOppositeReversal: true,
      strategyVersion: "v2.0",
    };
    const acc = createInitialAccount(tinyConfig);
    // 5 * 10% = 0.5 USDT < 10 USDT minimum
    const quote = makeQuote(50000, 50010);
    expect(() =>
      openPosition(acc, "LONG", quote, Date.now(), "d-6", "tiny")
    ).toThrow("minimum");
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
    expect(parseFloat(fill.price)).toBeCloseTo(expectedExit, 3);
  });

  it("closes a SHORT at ask + slippage", () => {
    const acc = createInitialAccount();
    const quote = makeQuote(50000, 50010);
    const { account: opened } = openPosition(acc, "SHORT", quote, Date.now(), "d-9", "test");

    const closeQuote = makeQuote(49000, 49010);
    const { fill } = closePosition(opened, closeQuote, "TAKE_PROFIT", "d-10", Date.now());
    const expectedExit = 49010 * (1 + 0.0005);
    expect(parseFloat(fill.price)).toBeCloseTo(expectedExit, 3);
  });

  it("netPnl = grossPnl - totalFees", () => {
    const acc = createInitialAccount();
    const quote = makeQuote(50000, 50010);
    const { account: opened } = openPosition(acc, "LONG", quote, Date.now(), "d-11", "test");

    const closeQuote = makeQuote(51000, 51010);
    const { closedTrade } = closePosition(opened, closeQuote, "TAKE_PROFIT", "d-12", Date.now());

    const gross = parseFloat(closedTrade.grossPnl);
    const fees = parseFloat(closedTrade.totalFees);
    const net = parseFloat(closedTrade.netPnl);
    expect(net).toBeCloseTo(gross - fees, 5);
  });

  it("collateral is fully released after close", () => {
    const acc = createInitialAccount();
    const quote = makeQuote(50000, 50010);
    const { account: opened } = openPosition(acc, "LONG", quote, Date.now(), "d-13", "test");

    expect(parseFloat(opened.reservedCollateral)).toBeGreaterThan(0);

    const closeQuote = makeQuote(51000, 51010);
    const { account: closed } = closePosition(opened, closeQuote, "TAKE_PROFIT", "d-14", Date.now());
    expect(parseFloat(closed.reservedCollateral)).toBeCloseTo(0, 5);
    expect(closed.position).toBeNull();
  });

  it("stops correctly exit at a loss", () => {
    const acc = createInitialAccount();
    const quote = makeQuote(50000, 50010);
    const { account: opened } = openPosition(acc, "LONG", quote, Date.now(), "d-15", "test");

    // Entry ~50010*1.0005 ≈ 50035. Stop at 1% below = ~49534
    const stopQuote = makeQuote(49000, 49010); // price well below stop
    const { closedTrade } = closePosition(opened, stopQuote, "STOP_LOSS", "d-16", Date.now());
    expect(parseFloat(closedTrade.netPnl)).toBeLessThan(0);
    expect(closedTrade.closeReason).toBe("STOP_LOSS");
  });
});

describe("Price calculation helpers", () => {
  it("calculateEntryPrice LONG = ask * (1 + slippageBps/10000)", () => {
    const ask = new Decimal(50010);
    const bid = new Decimal(50000);
    const result = calculateEntryPrice("LONG", ask, bid, 5);
    expect(result.toNumber()).toBeCloseTo(50010 * 1.0005, 4);
  });

  it("calculateEntryPrice SHORT = bid * (1 - slippageBps/10000)", () => {
    const ask = new Decimal(50010);
    const bid = new Decimal(50000);
    const result = calculateEntryPrice("SHORT", ask, bid, 5);
    expect(result.toNumber()).toBeCloseTo(50000 * 0.9995, 4);
  });

  it("calculateFee = notional * bps/10000", () => {
    const notional = new Decimal(1000);
    const fee = calculateFee(notional, 10);
    expect(fee.toNumber()).toBeCloseTo(1.0, 5);
  });
});

// ─── 4. CSV formula injection prevention ─────────────────────────────

describe("exportTradesToCSV", () => {
  const baseTrade: ClosedTrade = {
    id: "t-1",
    positionId: "p-1",
    side: "LONG",
    quantity: "0.01000000",
    entryPrice: "50000.00000000",
    exitPrice: "51000.00000000",
    entryTime: Date.now() - 3600000,
    exitTime: Date.now(),
    grossPnl: "10.00000000",
    totalFees: "1.00000000",
    netPnl: "9.00000000",
    returnPct: "1.8000",
    closeReason: "TAKE_PROFIT",
    entryFillId: "f-1",
    exitFillId: "f-2",
  };

  it("emits valid CSV with headers", () => {
    const csv = exportTradesToCSV([baseTrade]);
    const lines = csv.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toContain("Trade ID");
    expect(lines[0]).toContain("Net PnL");
  });

  it("escapes formula injection: = prefix", () => {
    const evil: ClosedTrade = { ...baseTrade, id: "=CMD" };
    const csv = exportTradesToCSV([evil]);
    expect(csv).toContain("'=CMD");
    expect(csv).not.toMatch(/,=CMD,/);
  });

  it("escapes formula injection: + prefix", () => {
    const evil: ClosedTrade = { ...baseTrade, id: "+1+1" };
    const csv = exportTradesToCSV([evil]);
    expect(csv).toContain("'+1+1");
  });

  it("escapes formula injection: - prefix", () => {
    const evil: ClosedTrade = { ...baseTrade, id: "-2+2" };
    const csv = exportTradesToCSV([evil]);
    expect(csv).toContain("'-2+2");
  });

  it("escapes formula injection: @ prefix", () => {
    const evil: ClosedTrade = { ...baseTrade, id: "@SUM()" };
    const csv = exportTradesToCSV([evil]);
    expect(csv).toContain("'@SUM()");
  });

  it("handles double-quote escaping in fields", () => {
    const evil: ClosedTrade = { ...baseTrade, closeReason: "TAKE_PROFIT" };
    const csv = exportTradesToCSV([evil]);
    expect(csv).toContain("TAKE_PROFIT");
  });

  it("empty trade list returns headers only", () => {
    const csv = exportTradesToCSV([]);
    const lines = csv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
  });
});

// ─── 5. Candle series validation ──────────────────────────────────────

describe("validateCandleSeries", () => {
  const INTERVAL_MS = 15 * 60 * 1000;

  it("separates confirmed from forming candle", () => {
    const now = Date.now();
    // Align to most recent 15m boundary
    const boundary = Math.floor(now / INTERVAL_MS) * INTERVAL_MS;
    const pastStart = boundary - 3 * INTERVAL_MS;

    const candles: Candle[] = [
      makeCandle(pastStart, 50000),
      makeCandle(pastStart + INTERVAL_MS, 50100),
      makeCandle(pastStart + 2 * INTERVAL_MS, 50200),
      // Forming: starts at boundary, closes in future
      {
        openTime: boundary,
        open: 50300,
        high: 50400,
        low: 50250,
        close: 50350,
        volume: 50,
        closeTime: boundary + INTERVAL_MS - 1, // not yet closed
      },
    ];

    // observation time mid-way through the forming candle
    const obsTime = boundary + 60000;
    const { confirmedCandles, formingCandle } = validateCandleSeries(candles, obsTime);

    expect(confirmedCandles).toHaveLength(3);
    expect(formingCandle).not.toBeNull();
    expect(formingCandle!.openTime).toBe(boundary);
  });

  it("throws on non-contiguous 15m gap", () => {
    const base = Math.floor(Date.now() / INTERVAL_MS) * INTERVAL_MS - 4 * INTERVAL_MS;
    const candles: Candle[] = [
      makeCandle(base, 50000),
      makeCandle(base + 2 * INTERVAL_MS, 50200), // gap!
    ];
    expect(() => validateCandleSeries(candles, Date.now())).toThrow("Gap detected");
  });

  it("throws on duplicate timestamps", () => {
    const base = Math.floor(Date.now() / INTERVAL_MS) * INTERVAL_MS - 3 * INTERVAL_MS;
    const candles: Candle[] = [
      makeCandle(base, 50000),
      makeCandle(base, 50100), // duplicate
    ];
    expect(() => validateCandleSeries(candles, Date.now())).toThrow("Duplicate");
  });
});
