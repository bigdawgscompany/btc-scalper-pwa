# BTC Scalper — Paper Research Terminal

**Paper only. No real orders.**

A personal mobile-first Progressive Web App for BTC/USDT 15-minute signal analysis and simulated autopilot. Signal scores are uncalibrated strategy scores — never probabilities, win rates, or profitability claims.

## Status

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Dependency alignment, fonts, test tooling | Complete |
| 1 | Market layer hardening (Binance-only, deadlines, boundary races) | Complete |
| 2 | Contracts & signals cleanup (5-group voting, pure vote fn) | Complete |
| 3 | Paper engine + storage (quote-age, dedup, retention, import validation) | Complete |
| 4 | Browser-market + hooks + UI integration | Complete |
| 5 | Serwist PWA + local fonts + owner-only updates | Complete |
| 6 | Tests expansion, verification gate, docs | Complete (baseline suite + fixes) |
| 7 | Vercel production readiness | Candidate — requires clean CI/Vercel preview verification |

**Patches applied in this release:**
- Fixed contribution display (`+25/-25` → `+20/-20`) after Lorentzian group was added.
- Fixed confluence threshold text (`≥ 75` → `≥ 80`) to match the actual voting rule.
- Added transparent Lorentzian fidelity note in the Market view.
- Improved reasons list rendering and group-row tooltips.

## Features

- **Market view**: Fixed Binance BTCUSDT 15m candles, candlestick chart with 6h/24h/7d range controls, forming-candle identification, confirmed Bullish/Bearish/Wait/Unavailable state, grouped signed contributions and signal score, indicator matrix (RSI, CCI, MACD histogram, Stoch K/D, Williams %R) + Lorentzian ML vote, provider/source attribution, server observation time and freshness.
- **Autopilot**: Simulated equity, available cash, reserved collateral, current position, execution state, Start/Pause/Resume controls, explicit Close paper position action, pending evaluations remain cancellable.
- **Journal**: Recorded fills, closed trades, decision reasons, entry/exit fees, net results, observed equity history, direction filtering, CSV export.
- **Settings**: Editable simulation assumptions, storage/persistence status, request-persistent-storage action, JSON backup/download/import, recovery export, guarded reset.
- **PWA**: Installable, offline shell, owner-only service worker updates.
- **Design**: Dark research-terminal UI, local Geist/Geist Mono fonts, tabular numerals, 44px touch targets, skip navigation, reduced-motion support, 320/390px mobile and 1280/1600px desktop support, 200% zoom.

## Operator guidance (deterministic)

| State | Action | Actionable |
|-------|--------|------------|
| Bullish (confirmed) | `OPEN_LONG` | Yes |
| Bearish (confirmed) | `OPEN_SHORT` | Yes |
| Wait | `STAY_FLAT` | No |
| Unavailable | `NO_TRADE` | No |
| Forming candle (any state) | same action, provisional | No |

Guidance is pure math from the 5-group matrix (directive, bias, invalidation, risk notes). No model invents the signal.

Optional `GET /api/brief` rephrases those facts via **Vercel AI Gateway** when `AI_GATEWAY_API_KEY` is set; otherwise returns the same deterministic brief.


## Chart patterns (MarkitTick port)

Deterministic breakout pattern detection adapted from **Auto Pattern Detector Targets [MarkitTick]** (Pine Script v6); this TypeScript implementation is not presented as byte-for-byte Pine parity.

- Patterns: Double/Triple Top & Bottom, H&S / Inverse, Flag/Pennant, Wedge, Triangle, Rectangle, Cup & Handle
- Output: entry / stop / target + R:R when a breakout is confirmed
- API: `GET /api/patterns`
- UI: Chart pattern panel under Operator guidance

**License:** [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — © MarkitTick.  
Attribution required. **Non-commercial use only.** ShareAlike applies to adaptations.

This port is for the paper research terminal only; it does not place live orders.

## Signal Logic (5-group ternary)


| Group | Rule (Bullish / Bearish) |
|-------|--------------------------|
| RSI (14) | ≤ 30 / ≥ 70 |
| CCI (20) | < −100 / > 100 |
| MACD Hist (12,26,9) | > 0.03% of price / < −0.03% of price |
| Stoch (14,3) + Williams %R (14) | K&D < 20 & W%R ≤ −80 / K&D > 80 & W%R ≥ −20 |
| Lorentzian ML (KNN) | prediction > 0 + filters + kernel bullish / opposite |

- Score = `20 × |sum(votes)|` (range 0–100).
- **Bullish** requires `sumVotes ≥ 4`, `supporters ≥ 4`, `score ≥ 80`.
- **Bearish** requires the symmetric negative conditions.
- Otherwise **Wait**. Insufficient history → **Unavailable**.

### Lorentzian fidelity note

The Lorentzian component is a **best-effort reconstruction** of jdehorty’s public Pine Script “Machine Learning: Lorentzian Classification”. The original script imports two closed-source libraries (`MLExtensions`, `KernelFunctions`). Feature normalization, regime filter, and kernel regression are therefore approximations, not byte-identical ports. The core ANN Lorentzian distance search and 4-bar-forward label definition are faithful to the supplied script. Treat the Lorentzian vote as experimental.


## Swing VWAP & Liquidity (ports)

| Module | Source | License |
|--------|--------|---------|
| `src/lib/vwap` | Dynamic Swing Anchored VWAP (Zeiierman), adapted | CC BY-NC-SA 4.0 |
| `src/lib/liquidity` | Liquidity Delta Profiler (LuxAlgo), adapted | CC BY-NC-SA 4.0 |

- APIs: `GET /api/vwap`, `GET /api/liquidity`
- UI panels under Market view (ARIA-labelled, responsive grid)
- Non-commercial use only; attribution required

**Engineering notes:** TypeScript strict (no `any`). Public exports are documented with JSDoc where they form a stable module/API surface; generated code is excluded. Complexity is reviewed by the release test suite rather than treated as an unverified documentation claim. Zustand + TanStack Query are installed for future state/data work; the current market/paper hooks remain intentionally local. OpenTelemetry is not instrumented in this repo — do not infer OTEL-backed diagnoses.


## SMC, Supertrend, UT Bot

| Module | Source | License / note |
|--------|--------|----------------|
| `src/lib/smc` | Smart Money Concepts [LuxAlgo], adapted | CC BY-NC-SA 4.0 © LuxAlgo |
| `src/lib/trend/supertrend` | Classic Supertrend | Public algorithm |
| `src/lib/trend/utbot` | UT Bot Alerts | Public algorithm |

APIs: `GET /api/smc`, `GET /api/trend`

SMC includes swing/internal BOS & CHoCH, order blocks, EQH/EQL, FVG, premium/discount levels. Non-commercial for LuxAlgo-derived code.

## Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS
- Zod for runtime validation at API boundaries
- decimal.js for ledger arithmetic
- Dexie/IndexedDB for persistence
- Lightweight Charts for price/volume
- Serwist for PWA behavior (webpack required for production builds)
- Vitest for testing

## Getting Started

```bash
npm install
cp .env.example .env.local   # optional: AI_GATEWAY_API_KEY
npm run dev
```

Open http://localhost:3000

### Vercel AI Gateway (optional `/api/brief`)

1. Dashboard → AI Gateway → API keys → create key (`vck_...`).
2. Local: `AI_GATEWAY_API_KEY` in `.env.local` (gitignored).
3. Vercel: Project → Settings → Environment Variables.
4. Optional: `AI_GATEWAY_MODEL` (default `openai/gpt-4.1-mini`).

If a key was ever pasted in chat or committed, **rotate it** in the dashboard.

### Coding agents on your machine

```bash
npm i -g vercel@latest
vercel login
vercel ai-gateway coding-agents setup
# or:
vercel ai-gateway coding-agents setup --key "$AI_GATEWAY_API_KEY" --yes
```

Configures Claude Code / Codex / Cursor / Cline / etc. to route model spend through AI Gateway. This is local agent setup, not part of the BTC app runtime. Docs: https://vercel.com/docs/ai-gateway/coding-agents

## Build & Deploy

### Production build (webpack required for Serwist)

```bash
npm run build
# (package.json already sets --webpack)
```

> **Note:** Serwist uses webpack for service worker generation. Next.js 16 defaults to Turbopack, so the `--webpack` flag is required.

### Deploy to Vercel

**Recommended (GitHub):**

1. Push this repository to GitHub.
2. Import the repository in the [Vercel dashboard](https://vercel.com/new).
3. Framework preset: **Next.js**.
4. Build command: `npm run build` (already includes `--webpack`).
5. Output directory: leave default (`.next`).
6. Deploy. Region is set to `sin1` in `vercel.json` (change if desired).

**CLI:**

```bash
npx vercel
```

No environment variables are required. The app is paper-only and talks only to public Binance endpoints.

### CI

`.github/workflows/ci.yml` runs on push/PR to `main`/`master`:

- `tsc --noEmit`
- `npm run lint`
- `npm test`
- `npm run build`

## Testing

```bash
npm test          # Run all tests
npm run lint      # Lint
npx tsc --noEmit  # Type check
```

Coverage includes indicator math, signal voting rules, Lorentzian vote shape, paper engine entry/exit/stop/target, candle validation, and browser-market helpers.

## Security & Audit Summary

| Area | Finding |
|------|---------|
| Real trading | None. Paper simulation only. No API keys, no private keys, no order endpoints. |
| Secrets | None present in source or config. |
| XSS / injection | No `dangerouslySetInnerHTML`, no `eval`, no untrusted HTML rendering. |
| API surface | All responses Zod-validated. Binance-only transport with hard deadlines, size caps, and bounded 429 cooldown. |
| Headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Permissions-Policy`. |
| Storage | Client-side IndexedDB (Dexie) only. Multi-tab writer lock. Import path validates schema and accounting invariants. |
| PWA | Owner-only SW activation; API routes are not precached as live data. |
| CSP | Not yet present. Consider adding a strict Content-Security-Policy in a future hardening pass if you serve this publicly. |

## Project Structure

```
src/
  app/
    api/
      market/route.ts   # Market data + signal analysis
      quote/route.ts    # Executable bid/ask quote
      signal/route.ts   # Signal computation
      klines/route.ts   # Candle data
      health/route.ts   # Health check
    layout.tsx          # Root layout with PWA registration
    page.tsx            # Main terminal page
    sw.ts               # Serwist service worker
  components/
    terminal.tsx        # Main terminal UI
    market-chart.tsx    # Candlestick chart
    pwa-registration.tsx # SW registration (production only)
  hooks/
    use-market.ts       # Market data lifecycle
    use-paper.ts        # Paper autopilot state machine
  lib/
    contracts.ts        # Zod schemas + types
    indicators.ts       # Pure math indicators
    signals.ts          # Signal matrix + scoring
    browser-market.ts   # Browser-side validation
    writer-lock.ts      # Multi-tab writer lock
    ml/
      lorentzian.ts     # Lorentzian Classification (KNN) reconstruction
    market/
      provider.ts       # Binance API transport
      validation.ts     # Candle validation
      errors.ts         # Market errors
    paper/
      types.ts          # Paper account types
      engine.ts         # Deterministic paper execution
      storage.ts        # Dexie/IndexedDB persistence
    server/
      http.ts           # Server HTTP utilities
```

## Configuration

Simulation assumptions and signal thresholds are configurable via the Settings view. Configuration changes require the autopilot to be paused and flat.

## Disclaimer

This is a personal research project. Markets are unpredictable. Past signals do not guarantee future results. Never risk money you cannot afford to lose. No automated trading is included — this is a paper-only simulation workspace.


## Release gate

Production promotion requires a clean dependency install followed by type-check, lint, tests, and the production build. The release CI workflow is the authoritative gate. A Vercel Preview deployment must also be smoke-tested before promoting Production.

The terminal is PAPER ONLY. It has no live order-routing endpoint and does not accept exchange trading credentials.

### Port fidelity

The third-party indicator modules are research adaptations. Exact Pine parity is not claimed unless a module has a matching golden-output fixture derived from a canonical source version. The repository does not treat approximated closed-library internals as validated equivalents.
