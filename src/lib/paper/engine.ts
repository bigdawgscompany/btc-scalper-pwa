import { Decimal } from "decimal.js";
import type {
  PaperAccountState,
  PaperPosition,
  PaperFill,
  ClosedTrade,
  PaperDecision,
  PositionSide,
  PaperConfig,
} from "./types";
import { DEFAULT_PAPER_CONFIG } from "./types";
import type { AnalysisResult, QuoteResponse } from "../contracts";

Decimal.set({ precision: 30, rounding: Decimal.ROUND_DOWN });

export const MIN_NOTIONAL_USDT = new Decimal(10);

export function createInitialAccount(
  config: PaperConfig = DEFAULT_PAPER_CONFIG
): PaperAccountState {
  const starting = new Decimal(config.startingBalance);
  return {
    id: "primary",
    availableCash: starting.toFixed(8),
    reservedCollateral: "0.00000000",
    realizedPnl: "0.00000000",
    totalFeesPaid: "0.00000000",
    equity: starting.toFixed(8),
    position: null,
    isRunning: false,
    isPaused: false,
    lastCandleEvaluated: 0,
    lastExitCandleTime: null,
    config,
    updatedAt: Date.now(),
  };
}

/**
 * Calculate entry execution price accounting for adverse slippage.
 */
export function calculateEntryPrice(
  side: PositionSide,
  ask: Decimal,
  bid: Decimal,
  slippageBps: number
): Decimal {
  const slipMultiplier = new Decimal(slippageBps).dividedBy(10000);
  if (side === "LONG") {
    // Buy at ask + slippage
    return ask.times(new Decimal(1).plus(slipMultiplier));
  } else {
    // Sell at bid - slippage
    return bid.times(new Decimal(1).minus(slipMultiplier));
  }
}

/**
 * Calculate exit execution price accounting for adverse slippage.
 */
export function calculateExitPrice(
  side: PositionSide,
  ask: Decimal,
  bid: Decimal,
  slippageBps: number
): Decimal {
  const slipMultiplier = new Decimal(slippageBps).dividedBy(10000);
  if (side === "LONG") {
    // Sell at bid - slippage
    return bid.times(new Decimal(1).minus(slipMultiplier));
  } else {
    // Buy at ask + slippage
    return ask.times(new Decimal(1).plus(slipMultiplier));
  }
}

export function calculateFee(notional: Decimal, feeBps: number): Decimal {
  return notional.times(new Decimal(feeBps).dividedBy(10000));
}

/**
 * Update mark price, unrealized P&L, and total account equity.
 */
export function updateAccountMarkEquity(
  account: PaperAccountState,
  bid: number,
  ask: number
): PaperAccountState {
  const cash = new Decimal(account.availableCash);
  const collateral = new Decimal(account.reservedCollateral);
  const dBid = new Decimal(bid);
  const dAsk = new Decimal(ask);

  if (!account.position) {
    return {
      ...account,
      equity: cash.toFixed(8),
      updatedAt: Date.now(),
    };
  }

  const pos = account.position;
  const qty = new Decimal(pos.quantity);
  const entryPrice = new Decimal(pos.entryPrice);

  let unrealized: Decimal;
  let markPrice: Decimal;

  if (pos.side === "LONG") {
    markPrice = dBid;
    unrealized = qty.times(dBid.minus(entryPrice));
  } else {
    markPrice = dAsk;
    unrealized = qty.times(entryPrice.minus(dAsk));
  }

  const totalEquity = cash.plus(collateral).plus(unrealized);

  const updatedPosition: PaperPosition = {
    ...pos,
    markPrice: markPrice.toFixed(8),
    unrealizedPnl: unrealized.toFixed(8),
    lastUpdated: Date.now(),
  };

  return {
    ...account,
    position: updatedPosition,
    equity: totalEquity.toFixed(8),
    updatedAt: Date.now(),
  };
}

/**
 * Open a new simulated Long or Short position.
 */
export function openPosition(
  account: PaperAccountState,
  side: PositionSide,
  quote: QuoteResponse,
  candleTime: number,
  decisionId: string,
  reason: string
): {
  account: PaperAccountState;
  fill: PaperFill;
  position: PaperPosition;
} {
  const equity = new Decimal(account.equity);
  if (equity.lessThanOrEqualTo(0)) {
    throw new Error("Cannot open position with non-positive equity.");
  }
  if (account.position) {
    throw new Error("Position already open; maximum 1 simultaneous position allowed.");
  }

  const cfg = account.config;
  const dAsk = new Decimal(quote.ask);
  const dBid = new Decimal(quote.bid);

  const entryPrice = calculateEntryPrice(side, dAsk, dBid, cfg.slippageBps);
  const allocatedCollateral = equity.times(new Decimal(cfg.entryAllocationPct).dividedBy(100));

  if (allocatedCollateral.lessThan(MIN_NOTIONAL_USDT)) {
    throw new Error(
      `Allocated capital ${allocatedCollateral.toFixed(2)} USDT is below minimum ${MIN_NOTIONAL_USDT.toFixed(2)} USDT.`
    );
  }

  // Quantity rounded down to 8 decimal places
  const quantity = allocatedCollateral.dividedBy(entryPrice).toDecimalPlaces(8, Decimal.ROUND_DOWN);
  const actualNotional = quantity.times(entryPrice);
  const entryFee = calculateFee(actualNotional, cfg.feeBps);

  const newCash = new Decimal(account.availableCash).minus(actualNotional).minus(entryFee);
  const newCollateral = new Decimal(account.reservedCollateral).plus(actualNotional);
  const newTotalFees = new Decimal(account.totalFeesPaid).plus(entryFee);

  // Stop & Target thresholds
  const stopFraction = new Decimal(cfg.stopLossPct).dividedBy(100);
  const targetFraction = new Decimal(cfg.takeProfitPct).dividedBy(100);

  let stopPrice: Decimal;
  let targetPrice: Decimal;

  if (side === "LONG") {
    stopPrice = entryPrice.times(new Decimal(1).minus(stopFraction));
    targetPrice = entryPrice.times(new Decimal(1).plus(targetFraction));
  } else {
    stopPrice = entryPrice.times(new Decimal(1).plus(stopFraction));
    targetPrice = entryPrice.times(new Decimal(1).minus(targetFraction));
  }

  const fillId = `fill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const positionId = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const fill: PaperFill = {
    id: fillId,
    decisionId,
    timestamp: Date.now(),
    side: side === "LONG" ? "BUY" : "SELL",
    price: entryPrice.toFixed(8),
    quantity: quantity.toFixed(8),
    notional: actualNotional.toFixed(8),
    fee: entryFee.toFixed(8),
    slippageApplied: `${cfg.slippageBps} bps`,
    reason,
  };

  const position: PaperPosition = {
    id: positionId,
    side,
    quantity: quantity.toFixed(8),
    entryPrice: entryPrice.toFixed(8),
    entryTime: Date.now(),
    entryCandleTime: candleTime,
    entryFee: entryFee.toFixed(8),
    entryNotional: actualNotional.toFixed(8),
    reservedCollateral: actualNotional.toFixed(8),
    stopPrice: stopPrice.toFixed(8),
    targetPrice: targetPrice.toFixed(8),
    unrealizedPnl: "0.00000000",
    markPrice: (side === "LONG" ? dBid : dAsk).toFixed(8),
    lastUpdated: Date.now(),
    config: cfg,
  };

  const updatedAccount: PaperAccountState = {
    ...account,
    availableCash: newCash.toFixed(8),
    reservedCollateral: newCollateral.toFixed(8),
    totalFeesPaid: newTotalFees.toFixed(8),
    position,
    updatedAt: Date.now(),
  };

  return {
    account: updatedAccount,
    fill,
    position,
  };
}

/**
 * Close an active position and realize P&L and exit fee.
 */
export function closePosition(
  account: PaperAccountState,
  quote: QuoteResponse,
  closeReason: "STOP_LOSS" | "TAKE_PROFIT" | "OPPOSITE_SIGNAL" | "MANUAL",
  decisionId: string,
  candleTime: number
): {
  account: PaperAccountState;
  fill: PaperFill;
  closedTrade: ClosedTrade;
} {
  const pos = account.position;
  if (!pos) {
    throw new Error("No active position to close.");
  }

  const cfg = pos.config;
  const dAsk = new Decimal(quote.ask);
  const dBid = new Decimal(quote.bid);

  const exitPrice = calculateExitPrice(pos.side, dAsk, dBid, cfg.slippageBps);
  const quantity = new Decimal(pos.quantity);
  const entryPrice = new Decimal(pos.entryPrice);
  const entryFee = new Decimal(pos.entryFee);

  const exitNotional = quantity.times(exitPrice);
  const exitFee = calculateFee(exitNotional, cfg.feeBps);

  let grossPnl: Decimal;
  if (pos.side === "LONG") {
    grossPnl = quantity.times(exitPrice.minus(entryPrice));
  } else {
    grossPnl = quantity.times(entryPrice.minus(exitPrice));
  }

  const netPnl = grossPnl.minus(entryFee).minus(exitFee);
  const totalFees = entryFee.plus(exitFee);
  const entryNotional = new Decimal(pos.entryNotional);
  const returnPct = entryNotional.isZero()
    ? new Decimal(0)
    : netPnl.dividedBy(entryNotional).times(100);

  // Return collateral to cash and credit gross P&L minus exit fee
  const newCash = new Decimal(account.availableCash)
    .plus(new Decimal(pos.reservedCollateral))
    .plus(grossPnl)
    .minus(exitFee);

  const newCollateral = new Decimal(account.reservedCollateral).minus(
    new Decimal(pos.reservedCollateral)
  );
  const newRealizedPnl = new Decimal(account.realizedPnl).plus(netPnl);
  const newTotalFees = new Decimal(account.totalFeesPaid).plus(exitFee);
  const newEquity = newCash.plus(newCollateral);

  const fillId = `fill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const tradeId = `trade-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const fill: PaperFill = {
    id: fillId,
    decisionId,
    timestamp: Date.now(),
    side: pos.side === "LONG" ? "SELL" : "BUY",
    price: exitPrice.toFixed(8),
    quantity: pos.quantity,
    notional: exitNotional.toFixed(8),
    fee: exitFee.toFixed(8),
    slippageApplied: `${cfg.slippageBps} bps`,
    reason: `Exit (${closeReason})`,
  };

  const closedTrade: ClosedTrade = {
    id: tradeId,
    positionId: pos.id,
    side: pos.side,
    quantity: pos.quantity,
    entryPrice: pos.entryPrice,
    exitPrice: exitPrice.toFixed(8),
    entryTime: pos.entryTime,
    exitTime: Date.now(),
    grossPnl: grossPnl.toFixed(8),
    totalFees: totalFees.toFixed(8),
    netPnl: netPnl.toFixed(8),
    returnPct: returnPct.toFixed(4),
    closeReason,
    entryFillId: pos.id,
    exitFillId: fillId,
  };

  const updatedAccount: PaperAccountState = {
    ...account,
    availableCash: newCash.toFixed(8),
    reservedCollateral: newCollateral.toFixed(8),
    realizedPnl: newRealizedPnl.toFixed(8),
    totalFeesPaid: newTotalFees.toFixed(8),
    equity: newEquity.toFixed(8),
    position: null,
    lastExitCandleTime: candleTime,
    updatedAt: Date.now(),
  };

  return {
    account: updatedAccount,
    fill,
    closedTrade,
  };
}

/**
 * Core Autopilot Cycle Evaluation:
 * Evaluates in strict priority:
 * 1. Stop / Target checks on active position.
 * 2. Opposite confirmed signal reversal / exit.
 * 3. New entry (if flat, not on same candle as exit, and confirmed Bullish/Bearish).
 */
export function evaluateAutopilotCycle(
  account: PaperAccountState,
  analysis: AnalysisResult,
  quote: QuoteResponse
): {
  updatedAccount: PaperAccountState;
  decision: PaperDecision;
  fills: PaperFill[];
  closedTrade: ClosedTrade | null;
} {
  const decisionId = `dec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const candleTime = analysis.candleTime;
  const dBid = new Decimal(quote.bid);
  const dAsk = new Decimal(quote.ask);

  let currentAccount = updateAccountMarkEquity(account, quote.bid, quote.ask);
  const fills: PaperFill[] = [];
  let closedTrade: ClosedTrade | null = null;

  // 1. Existing position: Evaluate Stops & Targets first
  if (currentAccount.position) {
    const pos = currentAccount.position;
    const stopPrice = new Decimal(pos.stopPrice);
    const targetPrice = new Decimal(pos.targetPrice);

    let stopHit = false;
    let targetHit = false;

    if (pos.side === "LONG") {
      // Long exits at bid
      if (dBid.lessThanOrEqualTo(stopPrice)) stopHit = true;
      else if (dBid.greaterThanOrEqualTo(targetPrice)) targetHit = true;
    } else {
      // Short exits at ask
      if (dAsk.greaterThanOrEqualTo(stopPrice)) stopHit = true;
      else if (dAsk.lessThanOrEqualTo(targetPrice)) targetHit = true;
    }

    if (stopHit || targetHit) {
      const reason = stopHit ? "STOP_LOSS" : "TAKE_PROFIT";
      const action = stopHit ? "EXIT_STOP" : "EXIT_TARGET";
      const res = closePosition(currentAccount, quote, reason, decisionId, candleTime);
      currentAccount = res.account;
      fills.push(res.fill);
      closedTrade = res.closedTrade;

      const decision: PaperDecision = {
        id: decisionId,
        timestamp: Date.now(),
        confirmedCandleTime: candleTime,
        strategyVersion: currentAccount.config.strategyVersion,
        action,
        reason: `Triggered ${reason} at ${stopHit ? pos.stopPrice : pos.targetPrice}`,
        signalState: analysis.state,
        signalScore: analysis.score,
        quoteBid: quote.bid.toString(),
        quoteAsk: quote.ask.toString(),
      };

      return {
        updatedAccount: {
          ...currentAccount,
          lastCandleEvaluated: candleTime,
        },
        decision,
        fills,
        closedTrade,
      };
    }

    // 2. Existing position: Opposite confirmed signal exit/reversal
    const isOppositeBullish = pos.side === "SHORT" && analysis.state === "Bullish";
    const isOppositeBearish = pos.side === "LONG" && analysis.state === "Bearish";

    if (currentAccount.config.allowOppositeReversal && (isOppositeBullish || isOppositeBearish)) {
      // Close old position first
      const closeRes = closePosition(
        currentAccount,
        quote,
        "OPPOSITE_SIGNAL",
        decisionId,
        candleTime
      );
      currentAccount = closeRes.account;
      fills.push(closeRes.fill);
      closedTrade = closeRes.closedTrade;

      // Reverse into opposite position
      const newSide: PositionSide = isOppositeBullish ? "LONG" : "SHORT";
      try {
        const openRes = openPosition(
          currentAccount,
          newSide,
          quote,
          candleTime,
          decisionId,
          `Opposite signal reversal to ${newSide}`
        );
        currentAccount = openRes.account;
        fills.push(openRes.fill);
      } catch {
        // If reopening fails risk check, remain flat
      }

      const decision: PaperDecision = {
        id: decisionId,
        timestamp: Date.now(),
        confirmedCandleTime: candleTime,
        strategyVersion: currentAccount.config.strategyVersion,
        action: "REVERSE",
        reason: `Opposite confirmed ${analysis.state} signal triggered reversal`,
        signalState: analysis.state,
        signalScore: analysis.score,
        quoteBid: quote.bid.toString(),
        quoteAsk: quote.ask.toString(),
      };

      return {
        updatedAccount: {
          ...currentAccount,
          lastCandleEvaluated: candleTime,
        },
        decision,
        fills,
        closedTrade,
      };
    }
  }

  // 3. Flat: Consider new entry
  if (!currentAccount.position) {
    const isBullish = analysis.state === "Bullish";
    const isBearish = analysis.state === "Bearish";
    const sameCandleBlocked = currentAccount.lastExitCandleTime === candleTime;

    if ((isBullish || isBearish) && !sameCandleBlocked) {
      const side: PositionSide = isBullish ? "LONG" : "SHORT";
      const action = isBullish ? "ENTER_LONG" : "ENTER_SHORT";

      try {
        const openRes = openPosition(
          currentAccount,
          side,
          quote,
          candleTime,
          decisionId,
          `Confirmed ${analysis.state} signal (score: ${analysis.score}/100)`
        );
        currentAccount = openRes.account;
        fills.push(openRes.fill);

        const decision: PaperDecision = {
          id: decisionId,
          timestamp: Date.now(),
          confirmedCandleTime: candleTime,
          strategyVersion: currentAccount.config.strategyVersion,
          action,
          reason: `Confirmed ${analysis.state} signal (score: ${analysis.score}/100)`,
          signalState: analysis.state,
          signalScore: analysis.score,
          quoteBid: quote.bid.toString(),
          quoteAsk: quote.ask.toString(),
        };

        return {
          updatedAccount: {
            ...currentAccount,
            lastCandleEvaluated: candleTime,
          },
          decision,
          fills,
          closedTrade,
        };
      } catch {
        // Entry failed risk or sizing check — remain flat
      }
    }
  }

  // 4. Default: Hold
  const decision: PaperDecision = {
    id: decisionId,
    timestamp: Date.now(),
    confirmedCandleTime: candleTime,
    strategyVersion: currentAccount.config.strategyVersion,
    action: "HOLD",
    reason: currentAccount.position
      ? `Holding ${currentAccount.position.side} position (Signal: ${analysis.state})`
      : `Flat (Signal: ${analysis.state}, Score: ${analysis.score}/100)`,
    signalState: analysis.state,
    signalScore: analysis.score,
    quoteBid: quote.bid.toString(),
    quoteAsk: quote.ask.toString(),
  };

  return {
    updatedAccount: {
      ...currentAccount,
      lastCandleEvaluated: candleTime,
    },
    decision,
    fills,
    closedTrade,
  };
}
