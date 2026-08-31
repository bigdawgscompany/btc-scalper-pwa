# BTC Scalper — Paper Research Terminal

**Paper only. No real orders.**

A personal mobile-first Progressive Web App for BTC/USDT 15-minute signal analysis and simulated autopilot. Signal scores are uncalibrated strategy scores — never probabilities, win rates, or profitability claims.

## Features

- **Market view**: Fixed Binance BTCUSDT 15m candles, candlestick chart with 6h/24h/7d range controls, forming-candle identification, confirmed Bullish/Bearish/Wait/Unavailable state, grouped signed contributions and signal score, indicator matrix (RSI, CCI, MACD histogram, Stoch K/D, Williams %R), provider/source attribution, server observation time and freshness.
- **Autopilot**: Simulated equity, available cash, reserved collateral, current position, execution state, Start/Pause/Resume controls, explicit Close paper position action, pending evaluations remain cancellable.
- **Journal**: Recorded fills, closed trades, decision reasons, entry/exit fees, net results, observed equity history, direction filtering, CSV export.
- **Settings**: Editable simulation assumptions, storage/persistence status, request-persistent-storage action, JSON backup/download/import, recovery export, guarded reset.
- **PWA**: Installable, offline shell, owner-only service worker updates.
- **Design**: Dark research-terminal UI, local Geist/Geist Mono fonts, tabular numerals, 44px touch targets, skip navigation, reduced-motion support, 320/390px mobile and 1280/1600px desktop support, 200% zoom.

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
npm run dev
```

Open http://localhost:3000

## Build & Deploy

### Production build (webpack required for Serwist)

```bash
npm run build -- --webpack
```

> **Note:** Serwist uses webpack for service worker generation. Next.js 16 defaults to Turbopack, so the `--webpack` flag is required for production builds.

### Deploy to Vercel

1. Push this repo to GitHub
2. Import the repository in the Vercel dashboard
3. Set the build command to `npm run build -- --webpack`
4. Deploy — zero additional config required

Or use the Vercel CLI:

```bash
npx vercel
```

## Testing

```bash
npm test          # Run all tests
npm run lint      # Lint
npx tsc --noEmit  # Type check
```

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
</arg_value><arg_key>task_progress</arg_key><arg_value>- [x] Inspect project tree, config, package.json, tests, git status
- [x] Review lib/contracts, indicators, signals, market provider/validation
- [x] Review paper engine/storage/types, writer-lock
- [x] Review API routes, hooks, components, app shell
- [x] Review tests and verification coverage
- [x] Identify gaps vs spec and produce implementation plan
- [x] Phase 0: Dependency alignment, geist fonts, test tooling, branch + baseline
- [x] Phase 1: Market layer hardening (Binance-only, deadlines, boundary races, serialization recheck)
- [x] Phase 2: Contracts & signals cleanup (remove legacy types, pure vote fn, param rejection)
- [x] Phase 3 (engine): quote-age validation, decision dedup, strategy-version tracking
- [x] Phase 3 (storage): retention, import validation, corrupt-state, revision checks
- [x] Phase 4: browser-market.ts + hooks + UI integration (state machine, eligibility, validation)
- [x] Phase 5: Serwist PWA + local fonts + owner-only updates
- [ ] Phase 6: Tests expansion, full verification gate, screenshots, docs
- [ ] Phase 7: Vercel production readiness (CI, deploy docs, final commit)</arg_value></tool_call>