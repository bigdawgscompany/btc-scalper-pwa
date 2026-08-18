"use client";

import { useEffect, useState, useCallback } from "react";
import type { SignalResult } from "@/lib/types";

export default function Home() {
  const [signal, setSignal] = useState<SignalResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchSignal = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/signal");
      if (!res.ok) throw new Error("Failed to fetch signal");
      const data = await res.json();
      setSignal(data.signal);
      setLastUpdate(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignal();
    const id = setInterval(fetchSignal, 30_000);
    return () => clearInterval(id);
  }, [fetchSignal]);

  const directionColor = (dir: string) => {
    if (dir === "BUY" || dir === "LONG") return "bg-emerald-600 text-white";
    if (dir === "SELL") return "bg-rose-600 text-white";
    return "bg-zinc-700 text-zinc-200";
  };

  const confidenceColor = (c: number) => {
    if (c >= 85) return "bg-emerald-500";
    if (c >= 75) return "bg-amber-500";
    return "bg-zinc-600";
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <header className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">BTC Scalper</h1>
            <p className="text-xs text-zinc-400">15m • High-confidence only</p>
          </div>
          <button
            onClick={fetchSignal}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-6 space-y-6">
        <div className="text-[11px] leading-relaxed text-zinc-500 bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
          Personal experimental tool only. Not financial advice. Signals can be wrong.
          Use at your own risk. No live trading automation.
        </div>

        {error && (
          <div className="bg-rose-950/50 border border-rose-800 text-rose-200 text-sm rounded-xl p-4">
            {error}
          </div>
        )}

        <section className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
          {loading && !signal ? (
            <div className="p-10 text-center text-zinc-500">Loading signal…</div>
          ) : signal ? (
            <>
              <div className={`px-6 py-8 text-center ${directionColor(signal.direction)}`}>
                <div className="text-sm font-medium opacity-90 uppercase tracking-widest mb-1">
                  Signal
                </div>
                <div className="text-4xl font-bold tracking-tight">
                  {signal.direction}
                </div>
                <div className="mt-3 text-sm opacity-90">
                  ${signal.price.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>

              <div className="px-6 py-5 border-t border-zinc-800">
                <div className="flex justify-between text-xs text-zinc-400 mb-2">
                  <span>Confidence</span>
                  <span className="font-medium text-zinc-200">
                    {signal.confidence}%
                  </span>
                </div>
                <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${confidenceColor(signal.confidence)}`}
                    style={{ width: `${signal.confidence}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] text-zinc-500">
                  Only signals ≥ 75% confidence with ≥ 3 confirmations are shown as actionable.
                </p>
              </div>
            </>
          ) : null}
        </section>

        {signal && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <h2 className="text-sm font-medium text-zinc-300 mb-4">
              Oscillator Matrix
            </h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <MatrixItem label="RSI (14)" value={signal.oscillators.rsi} />
              <MatrixItem label="Stoch %K" value={signal.oscillators.stochK} />
              <MatrixItem label="Stoch %D" value={signal.oscillators.stochD} />
              <MatrixItem label="MACD Hist" value={signal.oscillators.macdHist} />
              <MatrixItem label="CCI (20)" value={signal.oscillators.cci} />
              <MatrixItem label="Williams %R" value={signal.oscillators.willR} />
            </div>
          </section>
        )}

        {signal && signal.reasons.length > 0 && (
          <section className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <h2 className="text-sm font-medium text-zinc-300 mb-3">Analysis</h2>
            <ul className="space-y-2">
              {signal.reasons.map((r, i) => (
                <li key={i} className="text-xs text-zinc-400 flex gap-2 items-start">
                  <span className="text-zinc-600 mt-0.5">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="text-center text-[11px] text-zinc-600 pb-8">
          {lastUpdate && <p>Last update: {lastUpdate.toLocaleTimeString()}</p>}
          <p className="mt-1">Data: Binance BTCUSDT 15m • Auto-refresh 30s</p>
        </div>
      </main>
    </div>
  );
}

function MatrixItem({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const display =
    value === null ? "—" : value.toFixed(value > 10 || value < -10 ? 1 : 2);
  return (
    <div className="bg-zinc-950/60 rounded-xl px-3 py-2.5 border border-zinc-800/80">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-0.5">
        {label}
      </div>
      <div className="font-mono text-zinc-200">{display}</div>
    </div>
  );
}
