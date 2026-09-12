"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MarketResponseSchema, type MarketResponse, type Candle } from "@/lib/contracts";
import {
  validateMarketResponse,
  isEligibleForExecution,
} from "@/lib/browser-market";

export type ChartRange = "6h" | "24h" | "7d";

/**
 * Market data state machine (§2): loading → waiting → fresh → stale →
 * disconnected → unavailable → paused.
 */
export type MarketState =
  | "loading"
  | "waiting"
  | "fresh"
  | "stale"
  | "disconnected"
  | "unavailable";

export function useMarket() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [marketState, setMarketState] = useState<MarketState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [chartRange, setChartRange] = useState<ChartRange>("24h");
  const [lastFetchTime, setLastFetchTime] = useState<number | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  // Monotonic guard: reject older responses that arrive out of order (§4)
  const lastResponseTimestampRef = useRef<number>(0);

  const fetchMarketData = useCallback(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch("/api/market", {
        signal: controller.signal,
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Failed to fetch market analysis`);
      }

      const json = await res.json();
      const validated = MarketResponseSchema.parse(json);

      // Reject older responses that arrive after a newer one (§4)
      if (
        lastResponseTimestampRef.current > 0 &&
        validated.generatedTimestamp < lastResponseTimestampRef.current
      ) {
        return;
      }
      lastResponseTimestampRef.current = validated.generatedTimestamp;

      // Browser-side re-validation (§4)
      const browserValidation = validateMarketResponse(validated);
      if (!browserValidation.valid) {
        setError(`Browser validation failed: ${browserValidation.errors.join("; ")}`);
        setMarketState("unavailable");
        return;
      }

      setData(validated);
      setError(null);
      setLastFetchTime(Date.now());

      // Determine state from freshness/eligibility
      const eligibility = isEligibleForExecution(validated);
      if (eligibility.eligible) {
        setMarketState("fresh");
      } else if (!isOnline) {
        setMarketState("disconnected");
      } else if (validated.status.isLagging) {
        setMarketState("stale");
      } else {
        setMarketState("unavailable");
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      if (!isOnline) {
        setMarketState("disconnected");
        setError("Network offline. Retaining historical view-only data.");
      } else {
        setMarketState("unavailable");
        setError(err instanceof Error ? err.message : "Unknown market error");
      }
    }
  }, [isOnline]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setMarketState("waiting");
      fetchMarketData();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setMarketState("disconnected");
      setError("Network offline. Retaining historical view-only data.");
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        // Immediately withdraw execution eligibility on hide (§4)
        fetchMarketData();
      } else {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Defer initial fetch to avoid setState in effect body
    const initTimer = setTimeout(() => void fetchMarketData(), 0);

    // 15s visibility-aware polling (§4)
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchMarketData();
      }
    }, 15_000);

    return () => {
      clearTimeout(initTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchMarketData]);

  // Filter candles based on chosen chartRange (6h: 24 candles, 24h: 96 candles, 7d: 672 candles)
  const getFilteredCandles = useCallback( (): Candle[] => {
    if (!data || !data.candles) return [];
    let count = 96; // 24h default
    if (chartRange === "6h") count = 24;
    else if (chartRange === "7d") count = 672;
    return data.candles.slice(-count);
  }, [data, chartRange]);

  // Synchronous eligibility guard for the paper controller (§4)
  const isEligible = data ? isEligibleForExecution(data).eligible : false;

  return {
    marketData: data,
    marketState,
    loading: marketState === "loading" || marketState === "waiting",
    error,
    isOnline,
    isEligible,
    chartRange,
    setChartRange,
    filteredCandles: getFilteredCandles(),
    lastFetchTime,
    refreshMarket: fetchMarketData,
  };
}