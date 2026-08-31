"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { MarketResponseSchema, type MarketResponse, type Candle } from "@/lib/contracts";

export type ChartRange = "6h" | "24h" | "7d";

export function useMarket() {
  const [data, setData] = useState<MarketResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [chartRange, setChartRange] = useState<ChartRange>("24h");
  const [lastFetchTime, setLastFetchTime] = useState<number | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

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

      setData(validated);
      setError(null);
      setLastFetchTime(Date.now());
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : "Unknown market error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      fetchMarketData();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setError("Network offline. Retaining historical view-only data.");
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
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

    // 15s visibility-aware polling
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
  const getFilteredCandles = useCallback((): Candle[] => {
    if (!data || !data.candles) return [];
    let count = 96; // 24h default
    if (chartRange === "6h") count = 24;
    else if (chartRange === "7d") count = 672;
    return data.candles.slice(-count);
  }, [data, chartRange]);

  return {
    marketData: data,
    loading,
    error,
    isOnline,
    chartRange,
    setChartRange,
    filteredCandles: getFilteredCandles(),
    lastFetchTime,
    refreshMarket: fetchMarketData,
  };
}
