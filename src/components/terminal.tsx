"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useMarket } from "@/hooks/use-market";
import { usePaper } from "@/hooks/use-paper";
import type { PaperConfig } from "@/lib/paper/types";
import { DEFAULT_PAPER_CONFIG } from "@/lib/paper/types";
import type { AnalysisResult, GroupContribution } from "@/lib/contracts";
import { buildGuidance, type ProfessionalGuidance } from "@/lib/guidance";
import { detectPatterns, patternToJson } from "@/lib/patterns";
import { computeSwingAnchoredVwap } from "@/lib/vwap";
import { computeLiquidityProfile } from "@/lib/liquidity";
import { computeSmc } from "@/lib/smc";
import { computeSupertrend, computeUtBot } from "@/lib/trend";

const MarketChart = dynamic(
  () => import("./market-chart").then((m) => ({ default: m.MarketChart })),
  { ssr: false, loading: () => <div className="flex-1 flex items-center justify-center text-[#5A6880] text-sm">Loading chart…</div> }
);

// ─── Icons ────────────────────────────────────────────────────────────
function IconChart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  );
}
function IconBot() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/>
    </svg>
  );
}
function IconJournal() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>
    </svg>
  );
}
function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93A10 10 0 0 0 4.93 19.07M4.93 4.93A10 10 0 0 1 19.07 19.07"/>
    </svg>
  );
}
function IconLive() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[#43D4AD] text-xs font-semibold">
      <span className="w-1.5 h-1.5 rounded-full bg-[#43D4AD] animate-pulse-glow inline-block"/>
      LIVE
    </span>
  );
}

// ─── View type ────────────────────────────────────────────────────────
type View = "market" | "autopilot" | "journal" | "settings";

const NAV_ITEMS: { id: View; label: string; Icon: React.FC }[] = [
  { id: "market", label: "Market", Icon: IconChart },
  { id: "autopilot", label: "Autopilot", Icon: IconBot },
  { id: "journal", label: "Journal", Icon: IconJournal },
  { id: "settings", label: "Settings", Icon: IconSettings },
];

// ─── Signal badge ─────────────────────────────────────────────────────
function SignalBadge({ analysis }: { analysis: AnalysisResult | null | undefined }) {
  if (!analysis) return <span className="signal-badge signal-unavail">UNAVAILABLE</span>;
  const cls =
    analysis.state === "Bullish" ? "signal-bullish"
    : analysis.state === "Bearish" ? "signal-bearish"
    : analysis.state === "Wait"   ? "signal-wait"
    : "signal-unavail";
  const dot =
    analysis.state === "Bullish" ? "#43D4AD"
    : analysis.state === "Bearish" ? "#EF777D"
    : analysis.state === "Wait"   ? "#EFBB62"
    : "#6B7DB3";
  return (
    <span className={`signal-badge ${cls}`}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, display: "inline-block" }} />
      {analysis.state.toUpperCase()}
    </span>
  );
}


// ─── Swing VWAP panel (Zeiierman, CC BY-NC-SA 4.0) ───────────────────
function SwingVwapPanel({ candles }: { candles: { open: number; high: number; low: number; close: number; volume: number; openTime: number; closeTime: number }[] }) {
  if (!candles || candles.length < 60) return null;
  const r = computeSwingAnchoredVwap(candles);
  const dirLabel = r.direction > 0 ? "Up-swing regime" : "Down-swing regime";
  const dirColor = r.direction > 0 ? "#43D4AD" : "#EF777D";
  const lastPivot = r.pivots.length > 0 ? r.pivots[r.pivots.length - 1] : null;
  return (
    <section
      className="mt-3 rounded-md border border-[#283340] bg-[#0E1319] p-3 space-y-2"
      aria-label="Swing anchored VWAP analysis"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] text-[#5A6880] uppercase tracking-widest font-semibold m-0">
          Swing VWAP
        </h3>
        <span className="text-xs font-bold" style={{ color: dirColor }} aria-live="polite">
          {dirLabel}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] tabular-nums">
        <div>
          <div className="text-[10px] text-[#5A6880]">VWAP</div>
          <div className="text-[#E9EEF5] font-semibold">
            {r.lastVwap !== null ? r.lastVwap.toFixed(2) : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#5A6880]">APT</div>
          <div className="text-[#E9EEF5] font-semibold">{r.apt.toFixed(1)}</div>
        </div>
        <div>
          <div className="text-[10px] text-[#5A6880]">ATR ratio</div>
          <div className="text-[#E9EEF5] font-semibold">{r.atrRatio.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] text-[#5A6880]">Last pivot</div>
          <div className="text-[#E9EEF5] font-semibold">
            {lastPivot ? `${lastPivot.label || "—"} ${lastPivot.price.toFixed(0)}` : "—"}
          </div>
        </div>
      </div>
      <p className="text-[10px] text-[#5A6880] leading-snug m-0">
        Anchored at swing flips · © Zeiierman (CC BY-NC-SA 4.0) · paper research only
      </p>
    </section>
  );
}

// ─── Liquidity panel (LuxAlgo, CC BY-NC-SA 4.0) ──────────────────────
function LiquidityPanel({ candles }: { candles: { open: number; high: number; low: number; close: number; volume: number; openTime: number; closeTime: number }[] }) {
  if (!candles || candles.length < 50) return null;
  const r = computeLiquidityProfile(candles);
  const activeBsl = r.bslZones.filter((z) => !z.swept).slice(0, 3);
  const activeSsl = r.sslZones.filter((z) => !z.swept).slice(0, 3);
  const lastSig = r.signals.length > 0 ? r.signals[r.signals.length - 1] : null;
  return (
    <section
      className="mt-3 rounded-md border border-[#283340] bg-[#0E1319] p-3 space-y-2"
      aria-label="Liquidity delta profiler"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-[10px] text-[#5A6880] uppercase tracking-widest font-semibold m-0">
          Liquidity zones
        </h3>
        {lastSig && (
          <span
            className="text-xs font-bold tabular-nums"
            style={{ color: lastSig.direction > 0 ? "#43D4AD" : "#EF777D" }}
            title={lastSig.tooltip}
            aria-label={`Latest reversal signal ${lastSig.type}`}
          >
            {lastSig.type} · {lastSig.side}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
        <div aria-label="Buy side liquidity zones">
          <div className="text-[10px] text-[#EF777D] mb-1">BSL (resistance)</div>
          {activeBsl.length === 0 ? (
            <div className="text-[#5A6880]">none active</div>
          ) : (
            activeBsl.map((z, i) => (
              <div key={`bsl-${i}`} className="tabular-nums text-[#A7B0BC]">
                {z.bottom.toFixed(0)}–{z.top.toFixed(0)} · health {z.healthPct}%
              </div>
            ))
          )}
        </div>
        <div aria-label="Sell side liquidity zones">
          <div className="text-[10px] text-[#43D4AD] mb-1">SSL (support)</div>
          {activeSsl.length === 0 ? (
            <div className="text-[#5A6880]">none active</div>
          ) : (
            activeSsl.map((z, i) => (
              <div key={`ssl-${i}`} className="tabular-nums text-[#A7B0BC]">
                {z.bottom.toFixed(0)}–{z.top.toFixed(0)} · health {z.healthPct}%
              </div>
            ))
          )}
        </div>
      </div>
      <p className="text-[10px] text-[#5A6880] leading-snug m-0">
        Delta-profiled zones · ABS/EXH/DIV/REJ · © LuxAlgo (CC BY-NC-SA 4.0) · paper only
      </p>
    </section>
  );
}



// ─── SMC panel (LuxAlgo, CC BY-NC-SA 4.0) ─────────────────────────────
function SmcPanel({ candles }: { candles: { open: number; high: number; low: number; close: number; volume: number; openTime: number; closeTime: number }[] }) {
  if (!candles || candles.length < 60) return null;
  const r = computeSmc(candles);
  const biasLabel = r.swingBias === 1 ? "Bullish structure" : r.swingBias === -1 ? "Bearish structure" : "Neutral";
  const biasColor = r.swingBias === 1 ? "#43D4AD" : r.swingBias === -1 ? "#EF777D" : "#5A6880";
  const last = r.structures.length ? r.structures[r.structures.length - 1] : null;
  const obs = r.orderBlocks.filter((b) => !b.mitigated).slice(0, 3);
  return (
    <section className="mt-3 rounded-md border border-[#283340] bg-[#0E1319] p-3 space-y-2" aria-label="Smart money concepts">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-[10px] text-[#5A6880] uppercase tracking-widest font-semibold m-0">SMC</h3>
        <span className="text-xs font-bold" style={{ color: biasColor }} aria-live="polite">{biasLabel}</span>
      </div>
      <div className="text-[11px] text-[#A7B0BC] tabular-nums">
        {last ? (
          <span>Last {last.internal ? "internal" : "swing"} <strong className="text-[#E9EEF5]">{last.tag}</strong> @ {last.level.toFixed(2)}</span>
        ) : (
          <span>No recent BOS/CHoCH</span>
        )}
      </div>
      <div className="text-[11px] text-[#A7B0BC]">
        OB active: {obs.length === 0 ? "none" : obs.map((b, i) => (
          <span key={i} className="mr-2 tabular-nums">{b.bias === 1 ? "Bull" : "Bear"} {b.low.toFixed(0)}–{b.high.toFixed(0)}</span>
        ))}
      </div>
      <div className="text-[11px] text-[#A7B0BC] tabular-nums">
        FVG open: {r.fvgs.length} · EQH/EQL: {r.equalLevels.length}
        {r.equilibrium !== null ? ` · EQ ${r.equilibrium.toFixed(0)}` : ""}
      </div>
      <p className="text-[10px] text-[#5A6880] leading-snug m-0">© LuxAlgo SMC (CC BY-NC-SA 4.0) · paper research only</p>
    </section>
  );
}

// ─── Supertrend + UT Bot panel ────────────────────────────────────────
function TrendPanel({ candles }: { candles: { open: number; high: number; low: number; close: number; volume: number; openTime: number; closeTime: number }[] }) {
  if (!candles || candles.length < 30) return null;
  const st = computeSupertrend(candles);
  const ut = computeUtBot(candles);
  const stColor = st.lastTrend === 1 ? "#43D4AD" : "#EF777D";
  const utColor = ut.buy ? "#43D4AD" : ut.sell ? "#EF777D" : "#5A6880";
  return (
    <section className="mt-3 rounded-md border border-[#283340] bg-[#0E1319] p-3 space-y-2" aria-label="Trend systems Supertrend and UT Bot">
      <h3 className="text-[10px] text-[#5A6880] uppercase tracking-widest font-semibold m-0">Trend systems</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
        <div>
          <div className="text-[10px] text-[#5A6880]">Supertrend</div>
          <div className="font-bold tabular-nums" style={{ color: stColor }}>
            {st.lastTrend === 1 ? "UP" : "DOWN"}
            {st.lastLevel !== null ? ` · ${st.lastLevel.toFixed(2)}` : ""}
          </div>
          <div className="text-[#A7B0BC]" aria-live="polite">
            {st.buySignal ? "Buy flip" : st.sellSignal ? "Sell flip" : "No flip"}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#5A6880]">UT Bot</div>
          <div className="font-bold tabular-nums" style={{ color: utColor }}>
            {ut.buy ? "BUY" : ut.sell ? "SELL" : "FLAT"}
            {ut.lastStop !== null ? ` · stop ${ut.lastStop.toFixed(2)}` : ""}
          </div>
          <div className="text-[#A7B0BC]">ATR trail · key=1 · period=10</div>
        </div>
      </div>
      <p className="text-[10px] text-[#5A6880] leading-snug m-0">Classic Supertrend + UT Bot · paper signals only</p>
    </section>
  );
}


// ─── Chart pattern panel (MarkitTick port, CC BY-NC-SA 4.0) ────────────
function PatternPanel({ candles }: { candles: { open: number; high: number; low: number; close: number; volume: number; openTime: number; closeTime: number }[] }) {
  if (!candles || candles.length < 60) return null;
  const raw = detectPatterns(candles);
  const p = patternToJson(raw);
  if (!p.detected) {
    return (
      <section className="mt-3 rounded-md border border-[#283340] bg-[#0E1319] p-3" aria-label="Chart pattern detector">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] text-[#5A6880] uppercase tracking-widest font-semibold m-0">
            Chart pattern
          </h3>
          <span className="text-[10px] text-[#5A6880]">none confirmed</span>
        </div>
        <p className="text-[10px] text-[#5A6880] mt-1 leading-snug">
          MarkitTick pattern engine · CC BY-NC-SA 4.0 · paper research only
        </p>
      </section>
    );
  }
  const color = p.isBullish ? "#43D4AD" : "#EF777D";
  return (
    <section className="mt-3 rounded-md border border-[#283340] bg-[#0E1319] p-3 space-y-2" aria-label="Chart pattern detector">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] text-[#5A6880] uppercase tracking-widest font-semibold m-0">
          Chart pattern
        </h3>
        <span className="text-xs font-bold tracking-wide" style={{ color }}>
          {p.name} · {p.bias}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[11px] tabular-nums">
        <div>
          <div className="text-[10px] text-[#5A6880]">Entry</div>
          <div className="text-[#E9EEF5] font-semibold">{p.entryPrice.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] text-[#5A6880]">Stop</div>
          <div className="text-[#EF777D] font-semibold">{p.stopPrice.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-[10px] text-[#5A6880]">Target</div>
          <div className="text-[#43D4AD] font-semibold">{p.targetPrice.toFixed(2)}</div>
        </div>
      </div>
      <div className="text-[11px] text-[#A7B0BC] tabular-nums">
        R:R <span className="text-[#E9EEF5] font-semibold">{p.riskReward.toFixed(2)}</span>
        {" · "}
        measured height <span className="text-[#E9EEF5]">{p.height.toFixed(2)}</span>
      </div>
      <p className="text-[10px] text-[#5A6880] leading-snug">
        Breakout-confirmed pattern levels for paper planning only. Logic © MarkitTick (CC BY-NC-SA 4.0).
      </p>
    </section>
  );
}

// ─── Professional guidance panel (deterministic) ─────────────────────
function GuidancePanel({ analysis }: { analysis: AnalysisResult }) {
  const g: ProfessionalGuidance = buildGuidance(analysis);
  const actionColor =
    g.action === "OPEN_LONG"
      ? "#43D4AD"
      : g.action === "OPEN_SHORT"
        ? "#EF777D"
        : g.action === "STAY_FLAT"
          ? "#EFBB62"
          : "#6B7DB3";

  return (
    <div className="mt-3 rounded-md border border-[#283340] bg-[#0E1319] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-[#5A6880] uppercase tracking-widest font-semibold">
          Operator guidance
        </span>
        <span
          className="text-xs font-bold tabular-nums tracking-wide"
          style={{ color: actionColor }}
        >
          {g.action.replace("_", " ")}
          {g.actionable ? " · ACTIONABLE" : g.isForming ? " · PROVISIONAL" : ""}
        </span>
      </div>
      <p className="text-[12px] text-[#E9EEF5] leading-snug font-medium">
        {g.directive}
      </p>
      <div className="grid grid-cols-2 gap-2 text-[10px] tabular-nums">
        <div className="text-[#A7B0BC]">
          Bias{" "}
          <span className="text-[#E9EEF5] font-semibold">{g.bias}</span>
        </div>
        <div className="text-[#A7B0BC] text-right">
          Score{" "}
          <span className="text-[#E9EEF5] font-semibold">{g.score}/100</span>
        </div>
        <div className="text-[#A7B0BC]">
          Support{" "}
          <span className="text-[#E9EEF5] font-semibold">{g.supporters}</span>
        </div>
        <div className="text-[#A7B0BC] text-right">
          Oppose{" "}
          <span className="text-[#E9EEF5] font-semibold">{g.opponents}</span>
        </div>
      </div>
      {g.invalidation.length > 0 && (
        <div>
          <p className="text-[10px] text-[#5A6880] uppercase tracking-widest mb-1">
            Invalidation
          </p>
          <ul className="space-y-0.5">
            {g.invalidation.map((line, i) => (
              <li key={i} className="text-[11px] text-[#A7B0BC] leading-snug">
                • {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-[10px] text-[#5A6880] leading-snug">
        Paper research only. Score is confluence, not probability.
      </p>
    </div>
  );
}

// ─── Contribution row ─────────────────────────────────────────────────
function ContribRow({ g }: { g: GroupContribution }) {
  const color = g.vote === 1 ? "#43D4AD" : g.vote === -1 ? "#EF777D" : "#5A6880";
  // 5 equal-weight groups → ±20 each (was ±25 when there were only 4 groups)
  const label = g.vote === 1 ? "+20" : g.vote === -1 ? "-20" : "0";
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-[#283340]/60 last:border-0">
      <span className="text-xs text-[#A7B0BC] w-40 shrink-0 truncate" title={g.reason}>
        {g.groupName}
      </span>
      <div className="flex-1 h-1.5 bg-[#11161D] rounded-full overflow-hidden">
        {g.vote !== 0 && (
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: "100%",
              background: color,
              opacity: 0.7,
            }}
          />
        )}
        {g.vote === 0 && (
          <div className="h-full rounded-full bg-[#283340] w-full" />
        )}
      </div>
      <span
        className="text-xs font-bold tabular-nums w-8 text-right shrink-0"
        style={{ color }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── Market View ──────────────────────────────────────────────────────
function MarketView({
  marketData,
  loading,
  error,
  filteredCandles,
  chartRange,
  setChartRange,
}: ReturnType<typeof useMarket>) {
  const confirmed = marketData?.confirmedAnalysis;
  const provisional = marketData?.provisionalAnalysis;
  const lastCandle = filteredCandles[filteredCandles.length - 1];
  const formingCandleTime = provisional?.isForming ? provisional.candleTime : null;

  return (
    <div className="flex flex-col h-full overflow-hidden" id="main-content">
      {/* Price header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[#283340] shrink-0">
        <div>
          <span className="text-[10px] text-[#5A6880] uppercase tracking-widest">BTCUSDT · 15m</span>
          <div className="text-xl font-bold tabular-nums text-[#E9EEF5]">
            {lastCandle ? `$${lastCandle.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
          </div>
        </div>
        {loading && <div className="spinner ml-2" aria-label="Loading" />}
        {!loading && !error && <IconLive />}
        {error && <span className="text-xs text-[#EF777D] ml-2 truncate max-w-40">{error}</span>}
        {/* Confirmed signal pill */}
        <div className="ml-auto">
          <SignalBadge analysis={confirmed} />
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {filteredCandles.length > 0 ? (
          <MarketChart
            candles={filteredCandles}
            formingCandleTime={formingCandleTime}
            chartRange={chartRange}
            onRangeChange={setChartRange}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-[#5A6880] text-sm">
            {loading ? "Fetching candles…" : "No chart data"}
          </div>
        )}
      </div>

      {/* Analysis inspector panel */}
      <div className="border-t border-[#283340] shrink-0 max-h-[42%] overflow-y-auto">
        {/* Confirmed Analysis */}
        {confirmed && (
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[10px] text-[#5A6880] uppercase tracking-widest font-semibold">
                Confirmed Signal
              </h2>
              <span className="text-[10px] text-[#5A6880] tabular-nums">
                Score: <span className="text-[#E9EEF5] font-bold">{confirmed.score}/100</span>
              </span>
            </div>
            <div className="mb-2">
              <SignalBadge analysis={confirmed} />
            </div>
            <GuidancePanel analysis={confirmed} />
            <PatternPanel candles={marketData?.candles ?? filteredCandles} />
            <SwingVwapPanel candles={marketData?.candles ?? filteredCandles} />
            <LiquidityPanel candles={marketData?.candles ?? filteredCandles} />
            <SmcPanel candles={marketData?.candles ?? filteredCandles} />
            <TrendPanel candles={marketData?.candles ?? filteredCandles} />
            {/* Group contributions */}
            <div className="space-y-0 mt-2">
              {confirmed.groupContributions.map((g) => (
                <ContribRow key={g.groupName} g={g} />
              ))}
            </div>
            {/* Reasons — show all non-empty, with slight emphasis on the final confluence line */}
            {confirmed.reasons.length > 0 && (
              <div className="mt-2 space-y-1">
                {confirmed.reasons.map((r, i) => (
                  <p
                    key={i}
                    className={`text-[11px] ${
                      i === confirmed.reasons.length - 1 && confirmed.state === "Wait"
                        ? "text-[#EFBB62]/90"
                        : "text-[#A7B0BC]"
                    }`}
                  >
                    {r}
                  </p>
                ))}
              </div>
            )}
            {/* Transparency note for reconstructed Lorentzian component */}
            {confirmed.groupContributions.some((g) =>
              g.groupName.includes("Lorentzian")
            ) && (
              <p className="mt-2 text-[10px] text-[#5A6880] leading-snug">
                Lorentzian ML is a best-effort reconstruction of a public Pine
                Script indicator (closed-source library internals approximated).
                Treat its vote as experimental, not identical to the original.
              </p>
            )}
          </div>
        )}

        {/* Provisional analysis for forming candle */}
        {provisional && (
          <div className="p-3 border-t border-[#283340] bg-[rgba(239,187,98,0.04)]">
            <h3 className="text-[10px] text-[#EFBB62] uppercase tracking-widest font-semibold mb-2">
              Forming Candle (Provisional)
            </h3>
            <SignalBadge analysis={provisional} />
            <p className="text-[11px] text-[#EFBB62]/80 mt-1">
              Analysis is preliminary and will change as the candle develops.
            </p>
          </div>
        )}

        {/* Candle time */}
        {confirmed && (
          <div className="px-3 pb-3 flex items-center gap-2">
            <span className="text-[10px] text-[#5A6880]">
              Confirmed candle closed:{" "}
              <span className="tabular-nums text-[#A7B0BC]">
                {new Date(confirmed.candleTime).toUTCString()}
              </span>
            </span>
            {marketData?.status.isLagging && (
              <span className="text-[10px] text-[#EFBB62] ml-auto">
                ⚠ Provider lag {marketData.status.lagSeconds}s
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Autopilot View ───────────────────────────────────────────────────
function AutopilotView({ paper, isReadonly }: { paper: ReturnType<typeof usePaper>; isReadonly: boolean }) {
  const { account, isEvaluating, error, startAutopilot, pauseAutopilot, resumeAutopilot, closeCurrentPosition } = paper;

  if (!account) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="spinner" />
      </div>
    );
  }

  const pos = account.position;
  const equity = parseFloat(account.equity);
  const startBal = parseFloat(account.config.startingBalance);
  const totalReturnPct = startBal > 0 ? ((equity - startBal) / startBal) * 100 : 0;
  const isPos = totalReturnPct >= 0;

  const unrealizedPnl = pos ? parseFloat(pos.unrealizedPnl) : 0;
  const unrealPosNeg = unrealizedPnl >= 0;

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 space-y-3 animate-fade-in" id="main-content">
      <h1 className="text-sm font-bold text-[#E9EEF5] uppercase tracking-widest">Paper Autopilot</h1>

      {/* Status */}
      {isReadonly && (
        <div className="panel p-3 text-xs text-[#EFBB62] flex items-center gap-2">
          <span>⚠</span> Another tab is the active writer. This tab is read-only.
        </div>
      )}

      {account.isPaused && (
        <div className="rounded-md px-3 py-2 text-xs font-semibold text-[#EFBB62] bg-[rgba(239,187,98,0.1)] border border-[rgba(239,187,98,0.25)]">
          ⏸ Paused — Stops and targets are not monitored while paused.
        </div>
      )}

      {error && (
        <div className="rounded-md px-3 py-2 text-xs text-[#EF777D] bg-[rgba(239,119,125,0.1)] border border-[rgba(239,119,125,0.25)]">
          {error}
        </div>
      )}

      {/* Equity cards */}
      <div className="grid grid-cols-2 gap-2">
        <div className="panel p-3">
          <div className="stat-label">Total Equity</div>
          <div className={`stat-value text-lg ${isPos ? "text-pos" : "text-neg"}`}>
            ${equity.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={`text-xs tabular-nums mt-0.5 ${isPos ? "text-pos" : "text-neg"}`}>
            {isPos ? "+" : ""}{totalReturnPct.toFixed(2)}%
          </div>
        </div>
        <div className="panel p-3">
          <div className="stat-label">Available Cash</div>
          <div className="stat-value">
            ${parseFloat(account.availableCash).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-[#5A6880] mt-0.5 tabular-nums">
            Reserved: ${parseFloat(account.reservedCollateral).toFixed(2)}
          </div>
        </div>
      </div>

      {/* Open position card */}
      {pos ? (
        <div className="panel p-3 border-l-2" style={{ borderLeftColor: pos.side === "LONG" ? "#43D4AD" : "#EF777D" }}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-bold uppercase tracking-widest ${pos.side === "LONG" ? "text-pos" : "text-neg"}`}>
              {pos.side} Position
            </span>
            <span className={`text-sm font-bold tabular-nums ${unrealPosNeg ? "text-pos" : "text-neg"}`}>
              {unrealPosNeg ? "+" : ""}{unrealizedPnl.toFixed(2)} USDT
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-[#5A6880]">Entry</span>
              <div className="text-[#E9EEF5] tabular-nums">${parseFloat(pos.entryPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
            </div>
            <div>
              <span className="text-[#5A6880]">Mark</span>
              <div className="text-[#E9EEF5] tabular-nums">${parseFloat(pos.markPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
            </div>
            <div>
              <span className="text-[#5A6880]">Stop</span>
              <div className="text-[#EF777D] tabular-nums">${parseFloat(pos.stopPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
            </div>
            <div>
              <span className="text-[#5A6880]">Target</span>
              <div className="text-[#43D4AD] tabular-nums">${parseFloat(pos.targetPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
            </div>
            <div>
              <span className="text-[#5A6880]">Qty</span>
              <div className="tabular-nums">{parseFloat(pos.quantity).toFixed(6)} BTC</div>
            </div>
            <div>
              <span className="text-[#5A6880]">Collateral</span>
              <div className="tabular-nums">${parseFloat(pos.reservedCollateral).toFixed(2)}</div>
            </div>
          </div>
          {/* Manual close */}
          <button
            onClick={closeCurrentPosition}
            disabled={isReadonly || isEvaluating}
            className="btn btn-danger w-full mt-3 text-xs"
          >
            Close paper position
          </button>
        </div>
      ) : (
        <div className="panel p-3 text-center text-xs text-[#5A6880]">
          No open position — Flat
        </div>
      )}

      {/* Config summary */}
      <div className="panel p-3">
        <div className="text-[10px] text-[#5A6880] uppercase tracking-widest mb-2">Simulation Config</div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <span className="text-[#5A6880]">Allocation</span>
            <div>{account.config.entryAllocationPct}%</div>
          </div>
          <div>
            <span className="text-[#5A6880]">Stop</span>
            <div>{account.config.stopLossPct}%</div>
          </div>
          <div>
            <span className="text-[#5A6880]">Target</span>
            <div>{account.config.takeProfitPct}%</div>
          </div>
          <div>
            <span className="text-[#5A6880]">Fee</span>
            <div>{account.config.feeBps} bps</div>
          </div>
          <div>
            <span className="text-[#5A6880]">Slippage</span>
            <div>{account.config.slippageBps} bps</div>
          </div>
          <div>
            <span className="text-[#5A6880]">Reversal</span>
            <div>{account.config.allowOppositeReversal ? "On" : "Off"}</div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex gap-2">
        {!account.isRunning && !account.isPaused && (
          <button onClick={startAutopilot} disabled={isReadonly} className="btn btn-primary flex-1">
            ▶ Start
          </button>
        )}
        {account.isRunning && !account.isPaused && (
          <button onClick={pauseAutopilot} className="btn btn-warning flex-1">
            ⏸ Pause
          </button>
        )}
        {account.isPaused && (
          <button onClick={resumeAutopilot} disabled={isReadonly} className="btn btn-primary flex-1">
            ▶ Resume
          </button>
        )}
        {isEvaluating && <div className="spinner" aria-label="Evaluating" />}
      </div>

      <p className="text-[10px] text-[#5A6880] text-center pb-2">
        Paper only. No real orders. Signal scores are uncalibrated strategy scores.
      </p>
    </div>
  );
}

// ─── Journal View ──────────────────────────────────────────────────────
function JournalView({ paper }: { paper: ReturnType<typeof usePaper> }) {
  const { closedTrades, exportCSV } = paper;
  const [filter, setFilter] = useState<"ALL" | "LONG" | "SHORT">("ALL");

  const filtered = closedTrades.filter((t) => filter === "ALL" || t.side === filter);

  const totalNet = filtered.reduce((s, t) => s + parseFloat(t.netPnl), 0);
  const winners = filtered.filter((t) => parseFloat(t.netPnl) > 0).length;
  const losers = filtered.filter((t) => parseFloat(t.netPnl) <= 0).length;
  const winRate = filtered.length > 0 ? (winners / filtered.length) * 100 : null;

  const handleExportCSV = () => {
    const csv = exportCSV();
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `btc-scalper-journal-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full" id="main-content">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[#283340] shrink-0">
        <h1 className="text-sm font-bold text-[#E9EEF5] uppercase tracking-widest">Journal</h1>
        <div className="flex gap-1 ml-auto">
          {(["ALL", "LONG", "SHORT"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded text-xs font-semibold uppercase tracking-wide transition-colors ${
                filter === f ? "bg-[#43D4AD]/15 text-[#43D4AD]" : "text-[#A7B0BC] hover:text-[#E9EEF5]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <button onClick={handleExportCSV} className="btn btn-ghost text-xs px-3" style={{ minHeight: 32 }}>
          CSV
        </button>
      </div>

      {/* Stats summary */}
      <div className="grid grid-cols-4 gap-0 border-b border-[#283340] shrink-0">
        {[
          { label: "Trades", value: filtered.length.toString() },
          { label: "Net P&L", value: `${totalNet >= 0 ? "+" : ""}${totalNet.toFixed(2)}`, color: totalNet >= 0 ? "#43D4AD" : "#EF777D" },
          { label: "Win Rate", value: winRate !== null ? `${winRate.toFixed(0)}%` : "—" },
          { label: "W/L", value: `${winners}/${losers}` },
        ].map((s) => (
          <div key={s.label} className="px-3 py-2 text-center border-r border-[#283340] last:border-0">
            <div className="text-[10px] text-[#5A6880] uppercase tracking-wide">{s.label}</div>
            <div className="text-sm font-bold tabular-nums" style={{ color: s.color ?? "#E9EEF5" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Trades table */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[#5A6880] text-sm">
            No trades recorded yet.
          </div>
        ) : (
          <table className="journal-table">
            <thead className="sticky top-0 bg-[#0B0E11]">
              <tr>
                <th>Side</th>
                <th>Entry</th>
                <th>Exit</th>
                <th>Net P&L</th>
                <th>Rtn%</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const net = parseFloat(t.netPnl);
                const isWin = net > 0;
                return (
                  <tr key={t.id}>
                    <td>
                      <span style={{ color: t.side === "LONG" ? "#43D4AD" : "#EF777D", fontWeight: 700 }}>
                        {t.side}
                      </span>
                    </td>
                    <td className="tabular-nums">${parseFloat(t.entryPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                    <td className="tabular-nums">${parseFloat(t.exitPrice).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
                    <td className="tabular-nums" style={{ color: isWin ? "#43D4AD" : "#EF777D" }}>
                      {isWin ? "+" : ""}{net.toFixed(2)}
                    </td>
                    <td className="tabular-nums" style={{ color: isWin ? "#43D4AD" : "#EF777D" }}>
                      {parseFloat(t.returnPct) >= 0 ? "+" : ""}{parseFloat(t.returnPct).toFixed(2)}%
                    </td>
                    <td className="text-[10px] text-[#A7B0BC]">{t.closeReason.replace("_", " ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Settings View ────────────────────────────────────────────────────
function SettingsView({ paper }: { paper: ReturnType<typeof usePaper> }) {
  const { account, updateConfig, resetAccount, exportBackup, importBackup } = paper;
  const [cfg, setCfg] = useState<PaperConfig>(account?.config ?? DEFAULT_PAPER_CONFIG);
  const [showResetModal, setShowResetModal] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const canEdit = account ? (!account.isRunning || account.isPaused) && !account.position : false;

  const handleSave = async () => {
    try {
      await updateConfig(cfg);
      setSaveMsg("Configuration saved.");
      setTimeout(() => setSaveMsg(null), 2500);
    } catch (e: unknown) {
      setSaveMsg((e as Error).message);
    }
  };

  const handleExport = async () => {
    const json = await exportBackup();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `btc-scalper-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      await importBackup(text);
      setSaveMsg("Backup imported successfully.");
    } catch (err: unknown) {
      setSaveMsg((err as Error).message);
    }
    e.target.value = "";
  };

  const fieldClass = `input-field ${!canEdit ? "opacity-50 cursor-not-allowed" : ""}`;

  return (
    <div className="flex flex-col h-full overflow-y-auto" id="main-content">
      <div className="px-4 py-3 border-b border-[#283340] shrink-0">
        <h1 className="text-sm font-bold text-[#E9EEF5] uppercase tracking-widest">Settings</h1>
        {!canEdit && (
          <p className="text-xs text-[#EFBB62] mt-1">
            Autopilot must be paused and flat before editing configuration.
          </p>
        )}
      </div>

      <div className="p-4 space-y-5 flex-1">
        {/* Starting balance */}
        <section>
          <h2 className="text-[10px] text-[#5A6880] uppercase tracking-widest mb-2">Simulation Assumptions</h2>
          <div className="space-y-3">
            <div>
              <label className="stat-label mb-1 block" htmlFor="set-balance">Starting Balance (USDT)</label>
              <input
                id="set-balance"
                type="number"
                className={fieldClass}
                value={cfg.startingBalance}
                min="100"
                max="10000000"
                step="100"
                disabled={!canEdit}
                onChange={(e) => setCfg({ ...cfg, startingBalance: e.target.value })}
              />
            </div>
            <div>
              <label className="stat-label mb-1 block" htmlFor="set-alloc">Entry Allocation (1–100%)</label>
              <input
                id="set-alloc"
                type="number"
                className={fieldClass}
                value={cfg.entryAllocationPct}
                min="1"
                max="100"
                step="1"
                disabled={!canEdit}
                onChange={(e) => setCfg({ ...cfg, entryAllocationPct: Number(e.target.value) })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="stat-label mb-1 block" htmlFor="set-stop">Stop Loss (0.1–50%)</label>
                <input
                  id="set-stop"
                  type="number"
                  className={fieldClass}
                  value={cfg.stopLossPct}
                  min="0.1"
                  max="50"
                  step="0.1"
                  disabled={!canEdit}
                  onChange={(e) => setCfg({ ...cfg, stopLossPct: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="stat-label mb-1 block" htmlFor="set-target">Take Profit (0.1–50%)</label>
                <input
                  id="set-target"
                  type="number"
                  className={fieldClass}
                  value={cfg.takeProfitPct}
                  min="0.1"
                  max="50"
                  step="0.1"
                  disabled={!canEdit}
                  onChange={(e) => setCfg({ ...cfg, takeProfitPct: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="stat-label mb-1 block" htmlFor="set-fee">Fee (0–100 bps)</label>
                <input
                  id="set-fee"
                  type="number"
                  className={fieldClass}
                  value={cfg.feeBps}
                  min="0"
                  max="100"
                  step="1"
                  disabled={!canEdit}
                  onChange={(e) => setCfg({ ...cfg, feeBps: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="stat-label mb-1 block" htmlFor="set-slip">Slippage (0–100 bps)</label>
                <input
                  id="set-slip"
                  type="number"
                  className={fieldClass}
                  value={cfg.slippageBps}
                  min="0"
                  max="100"
                  step="1"
                  disabled={!canEdit}
                  onChange={(e) => setCfg({ ...cfg, slippageBps: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <input
                id="set-reversal"
                type="checkbox"
                className="w-4 h-4 accent-[#43D4AD]"
                checked={cfg.allowOppositeReversal}
                disabled={!canEdit}
                onChange={(e) => setCfg({ ...cfg, allowOppositeReversal: e.target.checked })}
              />
              <label htmlFor="set-reversal" className="text-sm text-[#A7B0BC] cursor-pointer">
                Opposite signal reversal (auto-reverse on confirmed opposing signal)
              </label>
            </div>
          </div>
        </section>

        {saveMsg && (
          <p className="text-xs text-[#43D4AD]">{saveMsg}</p>
        )}

        <button onClick={handleSave} disabled={!canEdit} className="btn btn-primary w-full">
          Save Configuration
        </button>

        <div className="divider" />

        {/* Backup & restore */}
        <section className="space-y-2">
          <h2 className="text-[10px] text-[#5A6880] uppercase tracking-widest mb-2">Backup & Restore</h2>
          <div className="flex gap-2">
            <button onClick={handleExport} className="btn btn-ghost flex-1">
              Export JSON Backup
            </button>
            <label className="btn btn-ghost flex-1 cursor-pointer" tabIndex={0} role="button">
              Import JSON
              <input type="file" accept=".json" className="hidden" onChange={handleImport} />
            </label>
          </div>
        </section>

        <div className="divider" />

        {/* Reset */}
        <section>
          <h2 className="text-[10px] text-[#5A6880] uppercase tracking-widest mb-2">Danger Zone</h2>
          <button
            onClick={() => setShowResetModal(true)}
            className="btn btn-danger w-full"
          >
            Reset Simulation
          </button>
        </section>

        <div className="pb-6 text-[10px] text-[#5A6880] space-y-1 text-center">
          <p>Scores are uncalibrated strategy signals — not probabilities, win rates, or profitability claims.</p>
          <p>No exchange or cloud credentials stored. Data is local browser only.</p>
        </div>
      </div>

      {/* Reset confirmation modal */}
      {showResetModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Confirm reset simulation">
          <div className="modal-card p-6">
            <h2 className="text-base font-bold text-[#EF777D] mb-2">Reset Simulation?</h2>
            <p className="text-sm text-[#A7B0BC] mb-4">
              This will delete all recorded trades, fills, decisions, and equity history, and reset your balance to the configured starting balance. This action cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowResetModal(false)} className="btn btn-ghost flex-1">Cancel</button>
              <button
                onClick={async () => {
                  await resetAccount();
                  setShowResetModal(false);
                }}
                className="btn btn-danger flex-1"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Root Terminal Shell ──────────────────────────────────────────────
export function Terminal() {
  const market = useMarket();
  const paper = usePaper(market.marketData, market.isEligible, market.marketState);
  const [activeView, setActiveView] = useState<View>("market");

  const isReadonly = paper.lockStatus === "SECONDARY_READONLY" || paper.lockStatus === "UNSUPPORTED";

  return (
    <div
      className="flex h-full w-full overflow-hidden"
      style={{ background: "#0B0E11" }}
    >
      {/* ── Desktop nav rail ── */}
      <nav
        className="hidden md:flex flex-col border-r border-[#283340] shrink-0"
        style={{ width: "var(--nav-rail)", background: "#11161D" }}
        aria-label="Main navigation"
      >
        {/* Brand header */}
        <div className="flex flex-col gap-0.5 px-4 py-4 border-b border-[#283340]">
          <div className="flex items-center gap-2">
            <span className="text-[#43D4AD] text-lg font-black tracking-tight">₿</span>
            <span className="font-bold text-sm text-[#E9EEF5] tracking-tight">BTC Scalper</span>
          </div>
          <div className="text-[10px] text-[#EFBB62] font-semibold tracking-widest uppercase">
            Paper only. No real orders.
          </div>
        </div>

        {/* Price summary */}
        {market.marketData && (
          <div className="px-4 py-3 border-b border-[#283340]">
            <div className="text-[10px] text-[#5A6880] uppercase">BTCUSDT · 15m</div>
            {market.filteredCandles.length > 0 && (
              <div className="text-base font-bold tabular-nums text-[#E9EEF5] mt-0.5">
                ${market.filteredCandles[market.filteredCandles.length - 1]?.close.toLocaleString("en-US", { minimumFractionDigits: 2 }) ?? "—"}
              </div>
            )}
            <SignalBadge analysis={market.marketData.confirmedAnalysis} />
          </div>
        )}

        {/* Nav items */}
        <div className="flex-1 p-2 space-y-0.5">
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveView(id)}
              className={`nav-item ${activeView === id ? "active" : ""}`}
              aria-current={activeView === id ? "page" : undefined}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>

        {/* Connectivity status */}
        <div className="px-4 py-3 border-t border-[#283340]">
          {market.isOnline ? <IconLive /> : (
            <span className="text-xs text-[#EF777D]">● Offline</span>
          )}
          {isReadonly && (
            <div className="text-[10px] text-[#EFBB62] mt-1">Read-only tab</div>
          )}
        </div>
      </nav>

      {/* ── Main content ── */}
      <main
        className="flex-1 flex flex-col min-w-0 overflow-hidden"
        aria-label={`${activeView} view`}
      >
        {/* Mobile header */}
        <header className="flex md:hidden items-center gap-2 px-3 border-b border-[#283340] shrink-0" style={{ height: "var(--header-h)", background: "#11161D" }}>
          <span className="text-[#43D4AD] font-black">₿</span>
          <span className="font-bold text-sm text-[#E9EEF5]">BTC Scalper</span>
          {market.filteredCandles.length > 0 && (
            <span className="ml-auto text-sm font-bold tabular-nums text-[#E9EEF5]">
              ${market.filteredCandles[market.filteredCandles.length - 1]?.close.toLocaleString("en-US", { minimumFractionDigits: 2 }) ?? "—"}
            </span>
          )}
          {market.loading && <div className="spinner ml-1" aria-label="Loading" />}
        </header>

        {/* Paper warning banner */}
        <div className="paper-banner" role="note" aria-label="Paper trading notice">
          <span>⚠</span>
          <span>Paper only. No real orders. Signal scores are uncalibrated strategy scores.</span>
        </div>

        {/* View content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {activeView === "market" && (
            <MarketView {...market} />
          )}
          {activeView === "autopilot" && (
            <AutopilotView paper={paper} isReadonly={isReadonly} />
          )}
          {activeView === "journal" && (
            <JournalView paper={paper} />
          )}
          {activeView === "settings" && (
            <SettingsView paper={paper} />
          )}
        </div>

        {/* Mobile bottom nav */}
        <nav
          className="flex md:hidden border-t border-[#283340] shrink-0"
          style={{ background: "#11161D" }}
          aria-label="Mobile navigation"
        >
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveView(id)}
              className={`mobile-nav-item ${activeView === id ? "active" : ""}`}
              aria-current={activeView === id ? "page" : undefined}
            >
              <Icon />
              {label}
            </button>
          ))}
        </nav>
      </main>
    </div>
  );
}
