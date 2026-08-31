"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { SignalResult, SignalHistoryItem, SignalDirection } from "@/lib/types";

const MAX_HISTORY = 25;
const STORAGE_KEY = "btc_scalper_history_v1";
const AUDIO_ENABLED_KEY = "btc_scalper_audio_alert";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function Home() {
  const [signal, setSignal] = useState<SignalResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [dataSource, setDataSource] = useState<string>("Coinbase");
  const [latency, setLatency] = useState<number | null>(null);

  // Lazy state initializers to avoid setState cascading renders inside useEffect
  const [history, setHistory] = useState<SignalHistoryItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const [audioAlerts, setAudioAlerts] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(AUDIO_ENABLED_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [showHistory, setShowHistory] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.matchMedia("(display-mode: standalone)").matches;
    } catch {
      return false;
    }
  });
  const [countdown, setCountdown] = useState(30);

  const prevSignalDirection = useRef<SignalDirection | null>(null);

  // Play audio chime on actionable signal
  const playAlertSound = useCallback((direction: SignalDirection) => {
    if (typeof window === "undefined" || direction === "NEUTRAL") return;
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;

      const audioCtx = new AudioContextClass();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (direction === "BUY" || direction === "LONG") {
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
        osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.1); // A5
      } else {
        osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
        osc.frequency.setValueAtTime(587.33, audioCtx.currentTime + 0.1); // D5
      }

      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);

      if (navigator.vibrate) {
        navigator.vibrate([100, 50, 100]);
      }
    } catch {
      // AudioContext policy restrictions
    }
  }, []);

  // Fetch signal from API
  const fetchSignal = useCallback(async () => {
    try {
      const res = await fetch("/api/signal", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to fetch market signal`);
      const data = await res.json();

      if (!data.signal) throw new Error("Invalid API payload");

      setSignal(data.signal);
      setDataSource(data.source || "Market Feed");
      if (data.latencyMs) setLatency(data.latencyMs);
      const now = new Date();
      setLastUpdate(now);
      setCountdown(30);
      setError(null);

      // Play alert if new actionable signal emerges
      if (
        audioAlerts &&
        prevSignalDirection.current !== data.signal.direction &&
        data.signal.direction !== "NEUTRAL"
      ) {
        playAlertSound(data.signal.direction);
      }
      prevSignalDirection.current = data.signal.direction;

      // Update history
      setHistory((prev) => {
        const newItem: SignalHistoryItem = {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          timestamp: Date.now(),
          price: data.signal.price,
          direction: data.signal.direction,
          confidence: data.signal.confidence,
          source: data.source || "Market",
        };
        const updated = [newItem, ...prev.slice(0, MAX_HISTORY - 1)];
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // ignore
        }
        return updated;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [audioAlerts, playAlertSound]);

  const handleManualRefresh = () => {
    setLoading(true);
    void fetchSignal();
  };

  // Initial load, service worker & PWA listeners
  useEffect(() => {
    // Register service worker for PWA
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((err) => console.debug("SW registration skipped:", err));
    }

    // PWA install banner hook
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);

    const mediaQuery = window.matchMedia("(display-mode: standalone)");
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      setIsInstalled(e.matches);
    };
    mediaQuery.addEventListener("change", handleDisplayModeChange);

    const timer = setTimeout(() => {
      void fetchSignal();
    }, 0);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      mediaQuery.removeEventListener("change", handleDisplayModeChange);
    };
  }, [fetchSignal]);

  // 30s auto-refresh timer & countdown tick
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          void fetchSignal();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [fetchSignal]);

  const toggleAudio = () => {
    const next = !audioAlerts;
    setAudioAlerts(next);
    localStorage.setItem(AUDIO_ENABLED_KEY, String(next));
    if (next) {
      playAlertSound("BUY"); // audio preview
    }
  };

  const handleInstallClick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      setInstallPrompt(null);
      setIsInstalled(true);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  };

  // Signal banner color classes
  const getSignalCardStyles = (dir: SignalDirection) => {
    switch (dir) {
      case "LONG":
        return "bg-linear-to-br from-emerald-600 via-teal-600 to-cyan-700 text-white shadow-emerald-950/50";
      case "BUY":
        return "bg-emerald-600 text-white shadow-emerald-950/40";
      case "SHORT":
        return "bg-linear-to-br from-rose-600 via-red-600 to-purple-800 text-white shadow-rose-950/50";
      case "SELL":
        return "bg-rose-600 text-white shadow-rose-950/40";
      case "NEUTRAL":
      default:
        return "bg-zinc-900 text-zinc-200 border-zinc-800";
    }
  };

  const getConfidenceBarColor = (c: number, dir: SignalDirection) => {
    if (dir === "LONG" || dir === "BUY") return "bg-emerald-400";
    if (dir === "SHORT" || dir === "SELL") return "bg-rose-400";
    if (c >= 75) return "bg-amber-400";
    return "bg-zinc-500";
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans selection:bg-amber-500/30">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-20 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800/80 px-4 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 font-bold text-sm shadow-inner">
              ₿
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold tracking-tight text-zinc-100">
                  BTC Scalper
                </h1>
                <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  15m
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>{dataSource}</span>
                {latency !== null && (
                  <span className="text-zinc-500">({latency}ms)</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Audio alert toggle */}
            <button
              onClick={toggleAudio}
              title={audioAlerts ? "Sound alerts enabled" : "Sound alerts disabled"}
              className={`p-2 rounded-full border transition-all text-xs ${
                audioAlerts
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                  : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {audioAlerts ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                </svg>
              )}
            </button>

            {/* Manual refresh button */}
            <button
              onClick={handleManualRefresh}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/60 disabled:opacity-50 transition-all text-zinc-200 active:scale-95"
            >
              <svg
                className={`w-3.5 h-3.5 ${loading ? "animate-spin text-amber-400" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>{loading ? "Syncing" : `${countdown}s`}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-lg mx-auto w-full px-4 py-5 space-y-5">
        {/* PWA Install Banner */}
        {installPrompt && !isInstalled && (
          <div className="bg-linear-to-r from-amber-500/20 via-zinc-900 to-zinc-900 border border-amber-500/30 rounded-2xl p-3.5 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-400 text-lg font-bold">
                📱
              </div>
              <div>
                <div className="text-xs font-semibold text-zinc-100">
                  Install BTC Scalper PWA
                </div>
                <div className="text-[11px] text-zinc-400">
                  Instant mobile access & offline support
                </div>
              </div>
            </div>
            <button
              onClick={handleInstallClick}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold transition-all"
            >
              Install
            </button>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="bg-rose-950/40 border border-rose-800/80 text-rose-200 text-xs rounded-2xl p-3.5 flex items-start gap-2.5 shadow-lg">
            <span className="text-rose-400 text-sm">⚠️</span>
            <div className="flex-1">
              <div className="font-semibold mb-0.5">Market Feed Error</div>
              <div className="text-rose-300/90">{error}</div>
            </div>
            <button
              onClick={handleManualRefresh}
              className="text-[11px] underline text-rose-300 hover:text-rose-100"
            >
              Retry
            </button>
          </div>
        )}

        {/* Primary Signal Hero Card */}
        <section className="rounded-3xl overflow-hidden border border-zinc-800/80 bg-zinc-900 shadow-2xl">
          {loading && !signal ? (
            <div className="py-16 text-center text-zinc-400 space-y-3">
              <div className="w-8 h-8 border-2 border-amber-500/40 border-t-amber-400 rounded-full animate-spin mx-auto"></div>
              <div className="text-sm font-medium">Computing 15m Oscillator Matrix…</div>
              <div className="text-xs text-zinc-600">Connecting to {dataSource}</div>
            </div>
          ) : signal ? (
            <>
              <div
                className={`px-6 py-7 text-center transition-all ${getSignalCardStyles(
                  signal.direction
                )} ${signal.direction !== "NEUTRAL" ? "animate-pulse-glow" : ""}`}
              >
                <div className="text-[11px] font-semibold opacity-85 uppercase tracking-widest mb-1 flex items-center justify-center gap-1.5">
                  <span>15m Scalp Signal</span>
                  {signal.direction === "LONG" && <span>🚀</span>}
                  {signal.direction === "SHORT" && <span>💥</span>}
                </div>

                <div className="text-4xl sm:text-5xl font-black tracking-tight my-1">
                  {signal.direction}
                </div>

                <div className="mt-2.5 text-base font-mono font-medium opacity-95">
                  ${signal.price.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>

              {/* Confidence Meter Section */}
              <div className="px-6 py-4 bg-zinc-900/95 border-t border-zinc-800/80 space-y-2.5">
                <div className="flex justify-between items-center text-xs text-zinc-400">
                  <span className="font-medium text-zinc-300">Confidence Confluence</span>
                  <span className="font-mono font-semibold text-zinc-100 text-sm">
                    {signal.confidence}%
                  </span>
                </div>

                <div className="h-2.5 bg-zinc-950 rounded-full overflow-hidden p-0.5 border border-zinc-800">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${getConfidenceBarColor(
                      signal.confidence,
                      signal.direction
                    )}`}
                    style={{ width: `${Math.max(5, signal.confidence)}%` }}
                  />
                </div>

                <div className="flex justify-between text-[10px] text-zinc-500 pt-0.5">
                  <span>Fail-Closed (Gate ≥ 75%)</span>
                  <span>Minimum Confirmations: 3</span>
                </div>
              </div>
            </>
          ) : null}
        </section>

        {/* Oscillator Matrix */}
        {signal && (
          <section className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-xl backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3.5">
              <h2 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                <span>Oscillator Matrix</span>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
              </h2>
              <span className="text-[11px] text-zinc-500">15m Window</span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <OscillatorCard
                label="RSI (14)"
                value={signal.oscillators.rsi}
                status={
                  signal.oscillators.rsi === null
                    ? "NEUTRAL"
                    : signal.oscillators.rsi <= 30
                    ? "BULLISH"
                    : signal.oscillators.rsi >= 70
                    ? "BEARISH"
                    : "NEUTRAL"
                }
                statusText={
                  signal.oscillators.rsi === null
                    ? ""
                    : signal.oscillators.rsi <= 30
                    ? "Oversold"
                    : signal.oscillators.rsi >= 70
                    ? "Overbought"
                    : "Neutral"
                }
              />
              <OscillatorCard
                label="Stoch %K"
                value={signal.oscillators.stochK}
                status={
                  signal.oscillators.stochK === null
                    ? "NEUTRAL"
                    : signal.oscillators.stochK < 20
                    ? "BULLISH"
                    : signal.oscillators.stochK > 80
                    ? "BEARISH"
                    : "NEUTRAL"
                }
                statusText={
                  signal.oscillators.stochK === null
                    ? ""
                    : signal.oscillators.stochK < 20
                    ? "Oversold"
                    : signal.oscillators.stochK > 80
                    ? "Overbought"
                    : "Neutral"
                }
              />
              <OscillatorCard
                label="Stoch %D"
                value={signal.oscillators.stochD}
                status={
                  signal.oscillators.stochD === null
                    ? "NEUTRAL"
                    : signal.oscillators.stochD < 20
                    ? "BULLISH"
                    : signal.oscillators.stochD > 80
                    ? "BEARISH"
                    : "NEUTRAL"
                }
                statusText={
                  signal.oscillators.stochD === null
                    ? ""
                    : signal.oscillators.stochD < 20
                    ? "Oversold"
                    : signal.oscillators.stochD > 80
                    ? "Overbought"
                    : "Neutral"
                }
              />
              <OscillatorCard
                label="MACD Hist"
                value={signal.oscillators.macdHist}
                decimals={2}
                status={
                  signal.oscillators.macdHist === null
                    ? "NEUTRAL"
                    : signal.oscillators.macdHist >= 1.0
                    ? "BULLISH"
                    : signal.oscillators.macdHist <= -1.0
                    ? "BEARISH"
                    : "NEUTRAL"
                }
                statusText={
                  signal.oscillators.macdHist === null
                    ? ""
                    : signal.oscillators.macdHist >= 1.0
                    ? "Bullish"
                    : signal.oscillators.macdHist <= -1.0
                    ? "Bearish"
                    : "Flat"
                }
              />
              <OscillatorCard
                label="CCI (20)"
                value={signal.oscillators.cci}
                status={
                  signal.oscillators.cci === null
                    ? "NEUTRAL"
                    : signal.oscillators.cci < -100
                    ? "BULLISH"
                    : signal.oscillators.cci > 100
                    ? "BEARISH"
                    : "NEUTRAL"
                }
                statusText={
                  signal.oscillators.cci === null
                    ? ""
                    : signal.oscillators.cci < -100
                    ? "Oversold"
                    : signal.oscillators.cci > 100
                    ? "Overbought"
                    : "Neutral"
                }
              />
              <OscillatorCard
                label="Williams %R"
                value={signal.oscillators.willR}
                status={
                  signal.oscillators.willR === null
                    ? "NEUTRAL"
                    : signal.oscillators.willR <= -80
                    ? "BULLISH"
                    : signal.oscillators.willR >= -20
                    ? "BEARISH"
                    : "NEUTRAL"
                }
                statusText={
                  signal.oscillators.willR === null
                    ? ""
                    : signal.oscillators.willR <= -80
                    ? "Oversold"
                    : signal.oscillators.willR >= -20
                    ? "Overbought"
                    : "Neutral"
                }
              />
            </div>
          </section>
        )}

        {/* Reasons / Confluence Analysis */}
        {signal && signal.reasons.length > 0 && (
          <section className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-xl">
            <h2 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-3">
              Trigger Diagnostics
            </h2>
            <ul className="space-y-2">
              {signal.reasons.map((r, i) => (
                <li
                  key={i}
                  className="text-xs text-zinc-300 bg-zinc-950/60 rounded-xl px-3 py-2 border border-zinc-800/60 flex items-start gap-2.5"
                >
                  <span className="text-amber-400 font-bold mt-0.5">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Signal History Collapsible */}
        <section className="bg-zinc-900/90 border border-zinc-800/80 rounded-3xl p-5 shadow-xl">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowHistory((prev) => !prev)}
              className="flex items-center gap-2 text-xs font-semibold text-zinc-300 uppercase tracking-wider hover:text-zinc-100 transition-all"
            >
              <span>Signal History ({history.length})</span>
              <svg
                className={`w-3.5 h-3.5 transition-transform ${showHistory ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {history.length > 0 && showHistory && (
              <button
                onClick={clearHistory}
                className="text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                Clear
              </button>
            )}
          </div>

          {showHistory && (
            <div className="mt-3.5 space-y-2">
              {history.length === 0 ? (
                <p className="text-xs text-zinc-500 text-center py-3">No signals recorded yet.</p>
              ) : (
                history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between bg-zinc-950/70 rounded-xl px-3 py-2 border border-zinc-800/60 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          item.direction === "LONG" || item.direction === "BUY"
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : item.direction === "SHORT" || item.direction === "SELL"
                            ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {item.direction}
                      </span>
                      <span className="font-mono text-zinc-200">
                        ${item.price.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-zinc-500 text-[11px]">
                      <span>{item.confidence}%</span>
                      <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {/* Disclaimer Card */}
        <div className="text-[11px] leading-relaxed text-zinc-500 bg-zinc-950/60 border border-zinc-900 rounded-2xl p-4 text-center">
          Personal research tool only. Not financial advice. Markets are volatile. Past signals do not guarantee future results.
        </div>

        {/* Footer info */}
        <footer className="text-center text-[11px] text-zinc-600 pb-8 space-y-1">
          {lastUpdate && <p>Last refresh: {lastUpdate.toLocaleTimeString()}</p>}
          <p>Multi-Exchange Confluence • Next.js 16 PWA</p>
        </footer>
      </main>
    </div>
  );
}

function OscillatorCard({
  label,
  value,
  status,
  statusText,
  decimals = 1,
}: {
  label: string;
  value: number | null;
  status: "BULLISH" | "BEARISH" | "NEUTRAL";
  statusText: string;
  decimals?: number;
}) {
  const display = value === null ? "—" : value.toFixed(decimals);

  const statusColor =
    status === "BULLISH"
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
      : status === "BEARISH"
      ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
      : "text-zinc-500 bg-zinc-800/40 border-zinc-800";

  return (
    <div className="bg-zinc-950/70 rounded-2xl p-3 border border-zinc-800/70 flex flex-col justify-between">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider font-medium text-zinc-400">
          {label}
        </span>
        {statusText && (
          <span
            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${statusColor}`}
          >
            {statusText}
          </span>
        )}
      </div>
      <div className="font-mono text-base font-semibold text-zinc-100 mt-1">
        {display}
      </div>
    </div>
  );
}
