import { describe, it, expect } from "vitest";
import { computeSignalFromVotes } from "../src/lib/signals";
import type { VoteValue } from "../src/lib/contracts";

// ─── All 243 combinations of five ternary votes ────────────────────────

const VOTE_VALUES: VoteValue[] = [-1, 0, 1];

describe("computeSignalFromVotes — all 243 combinations", () => {
  for (const a of VOTE_VALUES) {
    for (const b of VOTE_VALUES) {
      for (const c of VOTE_VALUES) {
        for (const d of VOTE_VALUES) {
          for (const e of VOTE_VALUES) {
            const votes: [VoteValue, VoteValue, VoteValue, VoteValue, VoteValue] = [a, b, c, d, e];
            const sumVotes = a + b + c + d + e;
            const label = `votes=[${a},${b},${c},${d},${e}] sum=${sumVotes}`;

            it(label, () => {
              const result = computeSignalFromVotes(votes);

              // Score invariant: score = 20 * |sumVotes|
              expect(result.score).toBe(20 * Math.abs(sumVotes));
              expect(result.sumVotes).toBe(sumVotes);

              // Bullish requires sumVotes >= 4 AND supporters >= 4. With 5
              // ternary votes this is only reachable via 4 agreeing + 1
              // neutral, or all 5 agreeing — never with an opposing vote.
              if (sumVotes >= 4) {
                const bullishCount = votes.filter((v) => v === 1).length;
                expect(bullishCount).toBeGreaterThanOrEqual(4);
                expect(result.state).toBe("Bullish");
                expect(result.supporters).toBe(bullishCount);
                expect(result.opponents).toBe(0);
              }

              if (sumVotes <= -4) {
                const bearishCount = votes.filter((v) => v === -1).length;
                expect(bearishCount).toBeGreaterThanOrEqual(4);
                expect(result.state).toBe("Bearish");
                expect(result.supporters).toBe(bearishCount);
                expect(result.opponents).toBe(0);
              }

              // Wait when not enough confluence
              if (Math.abs(sumVotes) < 4) {
                expect(result.state).toBe("Wait");
                expect(result.score).toBeLessThan(80);
              }

              // Score is always a multiple of 20
              expect(result.score % 20).toBe(0);
              expect(result.score).toBeGreaterThanOrEqual(0);
              expect(result.score).toBeLessThanOrEqual(100);
            });
          }
        }
      }
    }
  }
});

describe("computeSignalFromVotes — boundary equality", () => {
  it("sumVotes = 4 → Bullish (4 supporters, 1 neutral)", () => {
    const result = computeSignalFromVotes([1, 1, 1, 1, 0]);
    expect(result.state).toBe("Bullish");
    expect(result.score).toBe(80);
    expect(result.supporters).toBe(4);
    expect(result.opponents).toBe(0);
  });

  it("sumVotes = -4 → Bearish (4 supporters, 1 neutral)", () => {
    const result = computeSignalFromVotes([-1, -1, -1, -1, 0]);
    expect(result.state).toBe("Bearish");
    expect(result.score).toBe(80);
    expect(result.supporters).toBe(4);
  });

  it("sumVotes = 3 → Wait (score 60, below 80 threshold)", () => {
    const result = computeSignalFromVotes([1, 1, 1, 0, 0]);
    expect(result.state).toBe("Wait");
    expect(result.score).toBe(60);
  });

  it("sumVotes = -3 → Wait (score 60)", () => {
    const result = computeSignalFromVotes([-1, -1, -1, 0, 0]);
    expect(result.state).toBe("Wait");
    expect(result.score).toBe(60);
  });

  it("sumVotes = 0 → Wait (score 0)", () => {
    const result = computeSignalFromVotes([1, -1, 0, 0, 0]);
    expect(result.state).toBe("Wait");
    expect(result.score).toBe(0);
  });

  it("all neutral → Wait (score 0)", () => {
    const result = computeSignalFromVotes([0, 0, 0, 0, 0]);
    expect(result.state).toBe("Wait");
    expect(result.score).toBe(0);
  });

  it("5 bullish → Bullish (score 100)", () => {
    const result = computeSignalFromVotes([1, 1, 1, 1, 1]);
    expect(result.state).toBe("Bullish");
    expect(result.score).toBe(100);
    expect(result.supporters).toBe(5);
  });

  it("5 bearish → Bearish (score 100)", () => {
    const result = computeSignalFromVotes([-1, -1, -1, -1, -1]);
    expect(result.state).toBe("Bearish");
    expect(result.score).toBe(100);
    expect(result.supporters).toBe(5);
  });

  it("4 bullish + 1 bearish → Wait (sumVotes = 3, score 60)", () => {
    const result = computeSignalFromVotes([1, 1, 1, 1, -1]);
    expect(result.state).toBe("Wait");
    expect(result.score).toBe(60);
    expect(result.sumVotes).toBe(3);
  });
});

// ─── Professional guidance (deterministic) ───────────────────────────
import { buildGuidance } from "../src/lib/guidance";

describe("buildGuidance", () => {
  it("maps Bullish confirmed analysis to actionable OPEN_LONG", () => {
    const analysis = {
      state: "Bullish" as const,
      score: 80,
      sumVotes: 4,
      supporters: 4,
      opponents: 0,
      candleTime: Date.now(),
      isForming: false,
      reasons: ["test"],
      indicators: {
        rsi: 25,
        cci: -120,
        macdHist: 10,
        macdLine: 1,
        signalLine: 0,
        stochK: 10,
        stochD: 12,
        willR: -85,
        lorentzianPrediction: 3,
      },
      groupContributions: [
        {
          groupName: "RSI (14)",
          vote: 1 as const,
          contribution: 20 as const,
          reason: "RSI oversold",
        },
      ],
    };
    const g = buildGuidance(analysis);
    expect(g.action).toBe("OPEN_LONG");
    expect(g.bias).toBe("LONG");
    expect(g.actionable).toBe(true);
    expect(g.directive.toLowerCase()).toContain("long");
  });

  it("marks forming Bullish as non-actionable", () => {
    const analysis = {
      state: "Bullish" as const,
      score: 100,
      sumVotes: 5,
      supporters: 5,
      opponents: 0,
      candleTime: Date.now(),
      isForming: true,
      reasons: [],
      indicators: {
        rsi: null,
        cci: null,
        macdHist: null,
        macdLine: null,
        signalLine: null,
        stochK: null,
        stochD: null,
        willR: null,
        lorentzianPrediction: null,
      },
      groupContributions: [],
    };
    const g = buildGuidance(analysis);
    expect(g.action).toBe("OPEN_LONG");
    expect(g.actionable).toBe(false);
    expect(g.directive.toLowerCase()).toContain("provisional");
  });

  it("maps Wait to STAY_FLAT", () => {
    const analysis = {
      state: "Wait" as const,
      score: 20,
      sumVotes: 1,
      supporters: 1,
      opponents: 0,
      candleTime: Date.now(),
      isForming: false,
      reasons: [],
      indicators: {
        rsi: 50,
        cci: 0,
        macdHist: 0,
        macdLine: 0,
        signalLine: 0,
        stochK: 50,
        stochD: 50,
        willR: -50,
        lorentzianPrediction: 0,
      },
      groupContributions: [],
    };
    const g = buildGuidance(analysis);
    expect(g.action).toBe("STAY_FLAT");
    expect(g.bias).toBe("NEUTRAL");
    expect(g.actionable).toBe(false);
  });
});
