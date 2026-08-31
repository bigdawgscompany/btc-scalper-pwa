"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type {
  PaperAccountState,
  ClosedTrade,
  EquityObservation,
  PaperConfig,
} from "@/lib/paper/types";
import {
  getOrInitAccount,
  saveAccount,
  recordEvaluationStep,
  getClosedTrades,
  getEquityHistory,
  resetDatabase,
  exportBackupJSON,
  importBackupJSON,
  exportTradesToCSV,
} from "@/lib/paper/storage";
import {
  evaluateAutopilotCycle,
  closePosition,
  updateAccountMarkEquity,
} from "@/lib/paper/engine";
import {
  requestWriterLock,
  releaseWriterLock,
  type LockStatus,
} from "@/lib/writer-lock";
import { QuoteResponseSchema, type MarketResponse } from "@/lib/contracts";

export function usePaper(
  marketData: MarketResponse | null,
  isEligible: boolean,
  marketState: string
) {
  const [account, setAccount] = useState<PaperAccountState | null>(null);
  const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);
  const [equityHistory, setEquityHistory] = useState<EquityObservation[]>([]);
  const [lockStatus, setLockStatus] = useState<LockStatus>("UNINITIALIZED");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountRef = useRef<PaperAccountState | null>(null);
  // Pending Start cancellation support (§6)
  const pendingStartRef = useRef<boolean>(false);

  // Initialize DB and request writer lock on mount
  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        const acc = await getOrInitAccount();
        const trades = await getClosedTrades();
        const eq = await getEquityHistory(500);

        if (isMounted) {
          setAccount(acc);
          // Update ref immediately after state is set
          accountRef.current = acc;
          setClosedTrades(trades);
          setEquityHistory(eq);
        }

        await requestWriterLock((status) => {
          if (isMounted) {
            setLockStatus(status);
            if (status === "SECONDARY_READONLY" && accountRef.current?.isRunning) {
              // Pause execution if writer lock is lost or secondary
              setAccount((prev) => (prev ? { ...prev, isRunning: false, isPaused: true } : null));
            }
          }
        });
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to initialize storage.");
        }
      }
    }

    init();

    return () => {
      isMounted = false;
      releaseWriterLock();
    };
  }, []);

  // Fetch executable quote helper
  const fetchExecutableQuote = useCallback(async () => {
    const res = await fetch("/api/quote", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch quote`);
    const json = await res.json();
    return QuoteResponseSchema.parse(json);
  }, []);

  // Pause immediately on ineligible market data (§6)
  useEffect(() => {
    if (!isEligible && account?.isRunning && !account?.isPaused) {
      const paused: PaperAccountState = {
        ...account,
        isRunning: false,
        isPaused: true,
        updatedAt: Date.now(),
      };
      setAccount(paused); // eslint-disable-line react-hooks/set-state-in-effect
      void saveAccount(paused);
    }
  }, [isEligible, account?.isRunning, account?.isPaused]);

  // Run single evaluation cycle
  const runEvaluation = useCallback(async () => {
    const currentAccount = accountRef.current;
    if (
      !currentAccount ||
      !currentAccount.isRunning ||
      currentAccount.isPaused ||
      !marketData ||
      !marketData.confirmedAnalysis ||
      marketData.confirmedAnalysis.state === "Unavailable" ||
      isEvaluating
    ) {
      return;
    }

    // Synchronous eligibility guard — withdraw on failure/expiry/hiding (§4)
    if (!isEligible) {
      const paused: PaperAccountState = {
        ...currentAccount,
        isRunning: false,
        isPaused: true,
        updatedAt: Date.now(),
      };
      setAccount(paused); // eslint-disable-line react-hooks/set-state-in-effect
      await saveAccount(paused);
      return;
    }

    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      // Pause immediately on backgrounding
      const paused: PaperAccountState = {
        ...currentAccount,
        isRunning: false,
        isPaused: true,
        updatedAt: Date.now(),
      };
      setAccount(paused); // eslint-disable-line react-hooks/set-state-in-effect
      await saveAccount(paused);
      return;
    }

    setIsEvaluating(true);
    try {
      const quote = await fetchExecutableQuote();
      const { updatedAccount, decision, fills, closedTrade } =
        evaluateAutopilotCycle(
          currentAccount,
          marketData.confirmedAnalysis,
          quote
        );

      await recordEvaluationStep(
        updatedAccount,
        decision,
        fills,
        closedTrade,
        marketData.confirmedAnalysis
      );

      setAccount(updatedAccount);
      accountRef.current = updatedAccount;

      if (closedTrade) {
        setClosedTrades((prev) => [closedTrade, ...prev]);
      }
      const updatedEq = await getEquityHistory(500);
      setEquityHistory(updatedEq);
      setError(null);
    } catch (err: unknown) {
      // Storage failure / corrupt state → pause execution (§6)
      const paused: PaperAccountState = {
        ...currentAccount,
        isRunning: false,
        isPaused: true,
        updatedAt: Date.now(),
      };
      setAccount(paused); // eslint-disable-line react-hooks/set-state-in-effect
      accountRef.current = paused;
      setError(err instanceof Error ? err.message : "Evaluation failed.");
    } finally {
      setIsEvaluating(false);
    }
  }, [marketData, isEvaluating, fetchExecutableQuote, isEligible]);

  // Update mark price via ref to avoid setState-in-effect cascade
  useEffect(() => {
    if (!account || !marketData || !marketData.candles.length) return;
    const lastCandle = marketData.candles[marketData.candles.length - 1];
    if (!lastCandle) return;

    const updated = updateAccountMarkEquity(account, lastCandle.close, lastCandle.close);
    const equityChanged = updated.equity !== account.equity;
    const pnlChanged = updated.position && account.position &&
      updated.position.unrealizedPnl !== account.position.unrealizedPnl;

    if (equityChanged || pnlChanged) {
      // Use timeout to defer setState out of the effect body, preventing cascade
      const timer = setTimeout(() => {
        setAccount(updated);
        accountRef.current = updated;
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [marketData]); // eslint-disable-line react-hooks/set-state-in-effect

  // 5s Autopilot loop
  useEffect(() => {
    if (!account?.isRunning || account?.isPaused) return;

    const interval = setInterval(() => {
      runEvaluation();
    }, 5000);

    return () => clearInterval(interval);
  }, [account?.isRunning, account?.isPaused, runEvaluation]);

  // Start Autopilot
  const startAutopilot = useCallback(async () => {
    if (!account) return;
    if (lockStatus === "SECONDARY_READONLY" || lockStatus === "UNSUPPORTED") {
      setError("Cannot start autopilot: another tab holds exclusive writer ownership.");
      return;
    }

    const runningAccount: PaperAccountState = {
      ...account,
      isRunning: true,
      isPaused: false,
      updatedAt: Date.now(),
    };
    setAccount(runningAccount);
    await saveAccount(runningAccount);
    setError(null);
    void runEvaluation();
  }, [account, lockStatus, runEvaluation]);

  // Pause Autopilot
  const pauseAutopilot = useCallback(async () => {
    if (!account) return;
    const pausedAccount: PaperAccountState = {
      ...account,
      isRunning: false,
      isPaused: true,
      updatedAt: Date.now(),
    };
    setAccount(pausedAccount);
    await saveAccount(pausedAccount);
  }, [account]);

  // Resume Autopilot (requires fresh refresh first)
  const resumeAutopilot = useCallback(async () => {
    if (!account) return;
    if (lockStatus === "SECONDARY_READONLY" || lockStatus === "UNSUPPORTED") {
      setError("Cannot resume: another tab holds exclusive writer ownership.");
      return;
    }

    const runningAccount: PaperAccountState = {
      ...account,
      isRunning: true,
      isPaused: false,
      updatedAt: Date.now(),
    };
    setAccount(runningAccount);
    await saveAccount(runningAccount);
    setError(null);
    void runEvaluation();
  }, [account, lockStatus, runEvaluation]);

  // Close active position manually
  const closeCurrentPosition = useCallback(async () => {
    if (!account || !account.position) return;
    try {
      const quote = await fetchExecutableQuote();
      const decisionId = `dec-${Date.now()}-manual`;
      const candleTime = marketData?.confirmedAnalysis.candleTime ?? Date.now();

      const { account: updatedAccount, fill, closedTrade } = closePosition(
        account,
        quote,
        "MANUAL",
        decisionId,
        candleTime
      );

      const decision = {
        id: decisionId,
        timestamp: Date.now(),
        confirmedCandleTime: candleTime,
        strategyVersion: account.config.strategyVersion,
        action: "MANUAL_CLOSE" as const,
        reason: "User manual position close",
        signalState: marketData?.confirmedAnalysis.state ?? "Manual",
        signalScore: marketData?.confirmedAnalysis.score ?? 0,
        quoteBid: quote.bid.toString(),
        quoteAsk: quote.ask.toString(),
      };

      await recordEvaluationStep(
        updatedAccount,
        decision,
        [fill],
        closedTrade,
        marketData?.confirmedAnalysis ?? null
      );

      setAccount(updatedAccount);
      setClosedTrades((prev) => [closedTrade, ...prev]);
      const eq = await getEquityHistory(500);
      setEquityHistory(eq);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to close position.");
    }
  }, [account, marketData, fetchExecutableQuote]);

  // Update configuration (requires paused and flat)
  const updateConfig = useCallback(async (newConfig: PaperConfig) => {
    if (!account) return;
    if (account.isRunning && !account.isPaused) {
      throw new Error("Autopilot must be paused before updating configuration.");
    }
    if (account.position) {
      throw new Error("Cannot change configuration while holding an open position.");
    }

    const updated: PaperAccountState = {
      ...account,
      config: newConfig,
      updatedAt: Date.now(),
    };
    setAccount(updated);
    await saveAccount(updated);
  }, [account]);

  // Reset database & starting balance
  const resetAccount = useCallback(async (newConfig?: PaperConfig) => {
    const cfg = newConfig ?? account?.config;
    const fresh = await resetDatabase(cfg);
    setAccount(fresh);
    setClosedTrades([]);
    setEquityHistory([]);
    setError(null);
  }, [account]);

  // Export JSON backup
  const handleExportBackup = useCallback(async () => {
    return exportBackupJSON();
  }, []);

  // Import JSON backup
  const handleImportBackup = useCallback(async (jsonString: string) => {
    const restored = await importBackupJSON(jsonString);
    setAccount(restored);
    const trades = await getClosedTrades();
    const eq = await getEquityHistory(500);
    setClosedTrades(trades);
    setEquityHistory(eq);
    setError(null);
  }, []);

  // Export CSV
  const handleExportCSV = useCallback(() => {
    return exportTradesToCSV(closedTrades);
  }, [closedTrades]);

  return {
    account,
    closedTrades,
    equityHistory,
    lockStatus,
    isEvaluating,
    error,
    startAutopilot,
    pauseAutopilot,
    resumeAutopilot,
    closeCurrentPosition,
    updateConfig,
    resetAccount,
    exportBackup: handleExportBackup,
    importBackup: handleImportBackup,
    exportCSV: handleExportCSV,
  };
}
