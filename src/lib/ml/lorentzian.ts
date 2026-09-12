/**
 * Lorentzian Classification (KNN with Lorentzian distance) — TypeScript port.
 *
 * Source: "Machine Learning: Lorentzian Classification" by jdehorty (MPL-2.0),
 * ported from the user-supplied Pine Script v6 source.
 *
 * FIDELITY NOTE — read before trusting this as identical to the original:
 * The original script `import`s two closed-source libraries it depends on —
 * `jdehorty/MLExtensions/2` (feature normalization: n_rsi/n_wt/n_cci/n_adx,
 * plus the volatility/regime/ADX filters) and `jdehorty/KernelFunctions/2`
 * (rationalQuadratic/gaussian kernels). Only the *calling* script was
 * supplied here, not those libraries' source. So this port is faithful for
 * everything actually written out in the script you gave me:
 *   - the approximate-nearest-neighbors Lorentzian search (§ Core ML Logic)
 *   - the 4-bar-forward training label definition
 *   - the entry/exit signal composition
 * It is a best-effort, clearly-labeled RECONSTRUCTION (not a verified port)
 * for:
 *   - feature normalization (n_rsi/n_wt/n_cci/n_adx) — reimplemented here as
 *     a rolling min-max normalization to [0,1], which is what "normalize"
 *     means for KNN distance, but is not necessarily byte-identical to
 *     MLExtensions' internal smoothing.
 *   - the volatility filter — reimplemented as ATR(1) > ATR(10), which is
 *     the commonly-documented public shape of this filter.
 *   - the regime filter — reimplemented from a MODERATE-CONFIDENCE recollection
 *     of the KLMF-based (adaptive alpha/beta filter) + normalized-slope-decline
 *     formula that's widely reproduced in independent ports of this specific
 *     indicator. This is recalled from having seen it elsewhere, not verified
 *     against jdehorty's actual MLExtensions source — treat it as a
 *     best-effort reconstruction, not a confirmed byte-identical port.
 *   - the ADX filter — not applied by default (matches the original script's
 *     useAdxFilter=false default), but the underlying ADX value is computed
 *     faithfully via standard Wilder's formula (public domain, not library-
 *     dependent) and is available for a threshold gate if wanted later.
 * Kernel regression (rational quadratic + Gaussian) is implemented from the
 * well-known public Nadaraya-Watson formulas commonly associated with this
 * author's other indicators — treat as best-effort, not verified verbatim.
 *
 * If exact parity with the original matters, the MLExtensions and
 * KernelFunctions library source is needed to close these gaps.
 */

import type { Candle } from "../contracts";
import { rsi as rsiAtPoint, cci as cciAtPoint } from "../indicators";

/** Builds a per-bar series by calling indicators.ts's single-value functions
 * over each growing prefix of the array. O(n^2) but n is ~100 here, so cheap. */
function rsiSeries(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => rsiAtPoint(closes.slice(0, i + 1), period));
}

function cciSeries(highs: number[], lows: number[], closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) =>
    cciAtPoint(highs.slice(0, i + 1), lows.slice(0, i + 1), closes.slice(0, i + 1), period)
  );
}

export type LorentzianResult = {
  prediction: number; // sum of neighbor labels, roughly -neighborsCount..+neighborsCount
  neighborsUsed: number;
  kernelBullish: boolean;
  kernelBearish: boolean;
  volatilityOk: boolean;
  regimeOk: boolean;
  vote: -1 | 0 | 1;
  reason: string;
};

const NEIGHBORS_COUNT = 8;
const FEATURE_COUNT = 5;
const KERNEL_H = 8;
const KERNEL_R = 8;
const KERNEL_X = 25;
const KERNEL_LAG = 2;
const REGIME_THRESHOLD = -0.1; // matches the original script's default input

// ─── Feature indicators not already in indicators.ts ──────────────────

/** LazyBear's public WaveTrend formula (wt1 - wt2), the "WT" feature option. */
function waveTrendSeries(hlc3: number[], n1 = 10, n2 = 11): (number | null)[] {
  const ema = (values: number[], period: number): number[] => {
    const k = 2 / (period + 1);
    const out: number[] = [values[0]];
    for (let i = 1; i < values.length; i++) {
      out.push(values[i] * k + out[i - 1] * (1 - k));
    }
    return out;
  };
  const ema1 = ema(hlc3, n1);
  const absDiff = hlc3.map((v, i) => Math.abs(v - ema1[i]));
  const ema2 = ema(absDiff, n1);
  const ci = hlc3.map((v, i) => (ema2[i] === 0 ? 0 : (v - ema1[i]) / (0.015 * ema2[i])));
  const wt1 = ema(ci, n2);
  // wt2 = SMA(wt1, 4)
  const wt2: number[] = wt1.map((_, i) => {
    if (i < 3) return wt1.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1);
    return (wt1[i] + wt1[i - 1] + wt1[i - 2] + wt1[i - 3]) / 4;
  });
  return wt1.map((v, i) => v - wt2[i]);
}

/** Wilder's ADX (standard public technical-analysis formula, not library-dependent). */
function adxSeries(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  const n = highs.length;
  const tr: number[] = [0];
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  for (let i = 1; i < n; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const wilderSmooth = (values: number[], p: number): number[] => {
    const out: number[] = new Array(values.length).fill(0);
    let sum = 0;
    for (let i = 0; i < p && i < values.length; i++) sum += values[i];
    out[p - 1] = sum;
    for (let i = p; i < values.length; i++) {
      out[i] = out[i - 1] - out[i - 1] / p + values[i];
    }
    return out;
  };
  const trSmooth = wilderSmooth(tr, period);
  const plusDMSmooth = wilderSmooth(plusDM, period);
  const minusDMSmooth = wilderSmooth(minusDM, period);
  const plusDI = plusDMSmooth.map((v, i) => (trSmooth[i] === 0 ? 0 : (100 * v) / trSmooth[i]));
  const minusDI = minusDMSmooth.map((v, i) => (trSmooth[i] === 0 ? 0 : (100 * v) / trSmooth[i]));
  const dx = plusDI.map((v, i) => {
    const sum = v + minusDI[i];
    return sum === 0 ? 0 : (100 * Math.abs(v - minusDI[i])) / sum;
  });
  const adx = wilderSmooth(dx, period).map((v) => v / period);
  return adx.map((v, i) => (i < period * 2 - 1 ? null : v));
}

function atrSeries(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const n = highs.length;
  const tr: number[] = [highs[0] - lows[0]];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - period + 1);
    const slice = tr.slice(start, i + 1);
    out.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  return out;
}

/**
 * Regime filter — MODERATE-CONFIDENCE RECONSTRUCTION, not a verified port.
 * See the file header for the confidence caveat.
 *
 * Shape: an adaptive alpha/beta filter (KLMF) tracks a smoothed version of
 * `src`. The filter's bar-to-bar slope is compared against its own EMA(200)
 * baseline; when the current slope is decaying relative to its baseline by
 * more than `threshold`, price action is judged "trending enough" to trade
 * (this reads backwards at first — a normalized_slope_decline ABOVE the
 * (negative) threshold means the market isn't chopping sideways).
 * threshold default in the original script: -0.1.
 */
function regimeFilterOk(ohlc4: number[], threshold: number): boolean {
  const n = ohlc4.length;
  if (n < 10) return true; // not enough history to judge regime — don't block

  let value1 = 0;
  let value2 = 0;
  let klmf = ohlc4[0];
  const klmfSeries: number[] = [klmf];
  const highLowRange = (i: number) => {
    // ohlc4 doesn't carry high/low separately here, so approximate the
    // "value2" volatility term with the bar-to-bar ohlc4 range instead of
    // true high-low — a further simplification within the "moderate
    // confidence" reconstruction noted above.
    return i === 0 ? 0 : Math.abs(ohlc4[i] - ohlc4[i - 1]);
  };

  for (let i = 1; i < n; i++) {
    value1 = 0.2 * (ohlc4[i] - ohlc4[i - 1]) + 0.8 * value1;
    value2 = 0.1 * highLowRange(i) + 0.8 * value2;
    const omega = value2 === 0 ? 0 : Math.abs(value1 / value2);
    const alpha =
      (-Math.pow(omega, 2) + Math.sqrt(Math.pow(omega, 4) + 16 * Math.pow(omega, 2))) / 8;
    klmf = alpha * ohlc4[i] + (1 - alpha) * klmf;
    klmfSeries.push(klmf);
  }

  const absSlope = klmfSeries.map((v, i) => (i === 0 ? 0 : Math.abs(v - klmfSeries[i - 1])));
  // EMA(200) of absSlope, or as much history as we have.
  const emaPeriod = Math.min(200, n);
  const k = 2 / (emaPeriod + 1);
  let emaAbsSlope = absSlope[0];
  for (let i = 1; i < absSlope.length; i++) {
    emaAbsSlope = absSlope[i] * k + emaAbsSlope * (1 - k);
  }

  const currentAbsSlope = absSlope[absSlope.length - 1];
  if (emaAbsSlope === 0) return true;
  const normalizedSlopeDecline = (currentAbsSlope - emaAbsSlope) / emaAbsSlope;
  return normalizedSlopeDecline >= threshold;
}

function minMaxNormalize(values: (number | null)[]): number[] {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (finite.length === 0) return values.map(() => 0.5);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const range = max - min;
  return values.map((v) => {
    if (v === null || !Number.isFinite(v)) return 0.5;
    return range === 0 ? 0.5 : (v - min) / range;
  });
}

// ─── Kernel regression (Nadaraya-Watson) ───────────────────────────────

function rationalQuadratic(src: number[], h: number, r: number, x: number): number {
  const n = Math.min(x, src.length - 1);
  let num = 0;
  let den = 0;
  for (let i = 0; i <= n; i++) {
    const weight = Math.pow(1 + (i * i) / (h * h * 2 * r), -r);
    num += src[src.length - 1 - i] * weight;
    den += weight;
  }
  return den === 0 ? src[src.length - 1] : num / den;
}

function gaussianKernel(src: number[], h: number, x: number): number {
  const n = Math.min(x, src.length - 1);
  let num = 0;
  let den = 0;
  for (let i = 0; i <= n; i++) {
    const weight = Math.exp(-(i * i) / (2 * h * h));
    num += src[src.length - 1 - i] * weight;
    den += weight;
  }
  return den === 0 ? src[src.length - 1] : num / den;
}

// ─── Lorentzian ANN search (faithful port of the script's Core ML Logic) ──

function lorentzianDistance(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < FEATURE_COUNT; i++) {
    d += Math.log(1 + Math.abs(a[i] - b[i]));
  }
  return d;
}

/**
 * Approximate nearest neighbors: iterates the training set chronologically,
 * keeping only every-4th-bar-skipped, monotonically-increasing distances,
 * exactly as in the script's ANN loop (including the "reset lastDistance to
 * the 75th-percentile index" trick when the window overflows).
 */
function approximateNearestNeighbors(
  featuresSeries: number[][],
  labels: number[]
): { prediction: number; neighborsUsed: number } {
  let lastDistance = -1;
  const distances: number[] = [];
  const predictions: number[] = [];
  const current = featuresSeries[featuresSeries.length - 1];
  const trainEnd = featuresSeries.length - 1; // exclude current bar itself

  for (let i = 0; i < trainEnd; i++) {
    const d = lorentzianDistance(current, featuresSeries[i]);
    if (d >= lastDistance && i % 4 !== 0) {
      lastDistance = d;
      distances.push(d);
      predictions.push(labels[i]);
      if (predictions.length > NEIGHBORS_COUNT) {
        lastDistance = distances[Math.round((NEIGHBORS_COUNT * 3) / 4)];
        distances.shift();
        predictions.shift();
      }
    }
  }

  return {
    prediction: predictions.reduce((a, b) => a + b, 0),
    neighborsUsed: predictions.length,
  };
}

/**
 * Computes the Lorentzian Classification vote for the most recent (last)
 * candle in the given series. Requires enough history for indicator
 * warm-up plus the 4-bar-forward label lookahead. Training-set size is
 * entirely a function of how much history the caller passes in — pass the
 * full available candle history (not just the display window used by the
 * other 4 vote groups) to get a training set close to the original
 * script's spirit. With ~1000 candles (the pipeline's current Binance
 * fetch limit) this yields roughly 950 usable training points, versus the
 * original script's default 2000-bar maxBarsBack — a real, but far
 * smaller, gap than the ~76-point training set this integration started
 * with.
 */
export function computeLorentzianVote(candles: Candle[]): LorentzianResult {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const hlc3 = candles.map((c) => (c.high + c.low + c.close) / 3);
  const ohlc4 = candles.map((c) => (c.open + c.high + c.low + c.close) / 4);

  const f1 = minMaxNormalize(rsiSeries(closes, 14));
  const f2 = minMaxNormalize(waveTrendSeries(hlc3, 10, 11));
  const f3 = minMaxNormalize(cciSeries(highs, lows, closes, 20));
  const f4 = minMaxNormalize(adxSeries(highs, lows, closes, 20));
  const f5 = minMaxNormalize(rsiSeries(closes, 9));

  const n = candles.length;
  const featuresSeries: number[][] = [];
  for (let i = 0; i < n; i++) {
    featuresSeries.push([f1[i], f2[i], f3[i], f4[i], f5[i]]);
  }

  // Training label: direction of price 4 bars later. Only defined up to n-5.
  const labels: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 4; i++) {
    labels[i] = closes[i + 4] > closes[i] ? 1 : closes[i + 4] < closes[i] ? -1 : 0;
  }
  // Truncate the training set to bars with a defined label (i < n - 4).
  const trainableFeatures = featuresSeries.slice(0, n - 4).concat([featuresSeries[n - 1]]);
  const trainableLabels = labels.slice(0, n - 4);

  const { prediction, neighborsUsed } = approximateNearestNeighbors(trainableFeatures, trainableLabels);

  const volatilityOk = (() => {
    const atrShort = atrSeries(highs, lows, closes, 1);
    const atrLong = atrSeries(highs, lows, closes, 10);
    return atrShort[n - 1] > atrLong[n - 1];
  })();

  const regimeOk = regimeFilterOk(ohlc4, REGIME_THRESHOLD);

  const yhat1: number[] = [];
  const yhat2: number[] = [];
  for (let end = Math.max(2, n - 3); end <= n; end++) {
    const slice = closes.slice(0, end);
    yhat1.push(rationalQuadratic(slice, KERNEL_H, KERNEL_R, KERNEL_X));
    yhat2.push(gaussianKernel(slice, KERNEL_H - KERNEL_LAG, KERNEL_X));
  }
  const kernelBullish = yhat1[yhat1.length - 1] > yhat1[yhat1.length - 2] && yhat1[yhat1.length - 1] >= yhat2[yhat2.length - 1];
  const kernelBearish = yhat1[yhat1.length - 1] < yhat1[yhat1.length - 2] && yhat1[yhat1.length - 1] <= yhat2[yhat2.length - 1];

  const filtersOk = volatilityOk && regimeOk;

  let vote: -1 | 0 | 1 = 0;
  let reason = `Lorentzian ML neutral (prediction=${prediction}, ${neighborsUsed} neighbors)`;
  if (prediction > 0 && filtersOk && kernelBullish) {
    vote = 1;
    reason = `Lorentzian ML bullish (prediction=+${prediction}, kernel trending up, ${neighborsUsed} neighbors)`;
  } else if (prediction < 0 && filtersOk && kernelBearish) {
    vote = -1;
    reason = `Lorentzian ML bearish (prediction=${prediction}, kernel trending down, ${neighborsUsed} neighbors)`;
  } else if (!volatilityOk) {
    reason = `Lorentzian ML withheld — volatility filter blocked (prediction=${prediction})`;
  } else if (!regimeOk) {
    reason = `Lorentzian ML withheld — regime filter blocked (prediction=${prediction})`;
  }

  return { prediction, neighborsUsed, kernelBullish, kernelBearish, volatilityOk, regimeOk, vote, reason };
}
