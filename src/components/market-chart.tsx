"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  ColorType,
} from "lightweight-charts";
import type { Candle } from "@/lib/contracts";
import type { ChartRange } from "@/hooks/use-market";

interface MarketChartProps {
  candles: Candle[];
  formingCandleTime?: number | null;
  chartRange: ChartRange;
  onRangeChange: (range: ChartRange) => void;
}

export function MarketChart({ candles, formingCandleTime, chartRange, onRangeChange }: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // Initialize chart once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0B0E11" },
        textColor: "#A7B0BC",
        fontFamily: "'Geist Mono', 'Courier New', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(40,51,64,0.5)" },
        horzLines: { color: "rgba(40,51,64,0.5)" },
      },
      crosshair: {
        vertLine: { color: "rgba(167,176,188,0.4)", labelBackgroundColor: "#11161D" },
        horzLine: { color: "rgba(167,176,188,0.4)", labelBackgroundColor: "#11161D" },
      },
      timeScale: {
        borderColor: "#283340",
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: false,
        fixRightEdge: false,
      },
      rightPriceScale: {
        borderColor: "#283340",
        scaleMargins: { top: 0.1, bottom: 0.3 },
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#43D4AD",
      downColor: "#EF777D",
      borderUpColor: "#43D4AD",
      borderDownColor: "#EF777D",
      wickUpColor: "#43D4AD",
      wickDownColor: "#EF777D",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Resize observer for responsiveness
    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, []);

  // Update chart data when candles or forming candle changes
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !candles.length) return;

    const candleData: CandlestickData[] = candles.map((c) => ({
      time: Math.floor(c.openTime / 1000) as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData: HistogramData[] = candles.map((c) => ({
      time: Math.floor(c.openTime / 1000) as Time,
      value: c.volume,
      color: c.close >= c.open
        ? "rgba(67,212,173,0.35)"
        : "rgba(239,119,125,0.35)",
    }));

    // Highlight forming candle in amber if present
    if (formingCandleTime) {
      const formingIdx = candleData.findIndex(
        (c) => Math.floor(formingCandleTime / 1000) === (c.time as number)
      );
      if (formingIdx >= 0) {
        candleData[formingIdx] = {
          ...candleData[formingIdx],
          color: "#EFBB62",
          borderColor: "#EFBB62",
          wickColor: "#EFBB62",
        } as CandlestickData & { color: string; borderColor: string; wickColor: string };
      }
    }

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    chartRef.current?.timeScale().fitContent();
  }, [candles, formingCandleTime]);

  return (
    <div className="flex flex-col h-full">
      {/* Range selectors */}
      <div className="flex items-center gap-1 px-3 py-2 shrink-0" role="group" aria-label="Chart time range">
        {(["6h", "24h", "7d"] as ChartRange[]).map((r) => (
          <button
            key={r}
            onClick={() => onRangeChange(r)}
            className={`px-3 py-1 rounded text-xs font-semibold uppercase tracking-wider transition-colors ${
              chartRange === r
                ? "bg-[#43D4AD]/15 text-[#43D4AD]"
                : "text-[#A7B0BC] hover:text-[#E9EEF5]"
            }`}
            aria-pressed={chartRange === r}
          >
            {r}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[10px] text-[#5A6880] hidden sm:block">
          BTCUSDT · 15m · Binance
        </span>
      </div>
      {/* Chart canvas */}
      <div ref={containerRef} className="flex-1 w-full" />
      {/* Attribution (required by TradingView / Lightweight Charts) */}
      <div className="shrink-0 px-3 py-1">
        <a
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-[#5A6880] hover:text-[#A7B0BC] transition-colors"
        >
          Charts powered by TradingView Lightweight Charts™
        </a>
      </div>
    </div>
  );
}
