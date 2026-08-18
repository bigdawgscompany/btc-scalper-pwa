# BTC Scalper PWA

Personal mobile-first Progressive Web App that emits **only high-confidence** buy/sell/long signals for BTCUSD on the 15-minute timeframe.

**Not financial advice. Experimental personal tool only.**

## Features (v1)

- Oscillator matrix: RSI, Stochastic, MACD histogram, CCI, Williams %R
- Confidence scoring + minimum confirmation gate (default ≥ 75% confidence and ≥ 3 confirming oscillators)
- Fail-closed design: NEUTRAL when conditions are not met
- Real-time data from Binance public API (BTCUSDT 15m)
- Mobile-first dark UI, installable as PWA
- Auto-refresh every 30 seconds

## Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS
- Pure TypeScript indicator + signal engine (no external TA library)
- Deployed on Vercel

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

1. Push this repo to GitHub (already done if following the plan)
2. Import the repository in the Vercel dashboard
3. Deploy – zero config required

Or use the Vercel CLI:

```bash
npx vercel
```

## Project Structure

```
src/
  app/
    api/
      klines/route.ts   # market data
      signal/route.ts   # compute signal
    page.tsx            # mobile dashboard
    layout.tsx
  lib/
    types.ts
    indicators.ts       # pure math
    signals.ts          # matrix + confidence gate
```

## Configuration

Confidence thresholds live in `src/lib/signals.ts` (`DEFAULT_CONFIG`).

## Roadmap

- [ ] Paper-trade outcome logging
- [ ] Simple adaptive ML layer (logistic / small model on the same features)
- [ ] Historical backtest view
- [ ] Push notifications for high-confidence signals
- [ ] Better PWA icons & offline shell

## Disclaimer

This is a personal research project. Markets are unpredictable. Past signals do not guarantee future results. Never risk money you cannot afford to lose. No automated trading is included in v1.
