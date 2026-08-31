import { describe, it, expect } from "vitest";
import { computeSignalFromVotes } from "../src/lib/signals";
import type { VoteValue } from "../src/lib/contracts";

// ─── All 81 combinations of four ternary votes (§8) ────────────────────

const VOTE_VALUES: VoteValue[] = [-1, 0, 1];

describe("computeSignalFromVotes — all 81 combinations", () => {
  for (const a of VOTE_VALUES) {
    for (const b of VOTE_VALUES) {
      for (const c of VOTE_VALUES) {
        for (const d of VOTE_VALUES) {
          const votes: [VoteValue, VoteValue, VoteValue, VoteValue] = [a, b, c, d];
          const sumVotes = a + b + c + d;
          const label = `votes=[${a},${b},${c},${d}] sum=${sumVotes}`;

          it(label, () => {
            const result = computeSignalFromVotes(votes);

            // Score invariant: score = 25 * |sumVotes|
            expect(result.score).toBe(25 * Math.abs(sumVotes));
            expect(result.sumVotes).toBe(sumVotes);

            // Bullish requires sumVotes >= 3 AND supporters >= 3
            if (sumVotes >= 3) {
              const bullishCount = votes.filter((v) => v === 1).length;
              if (bullishCount >= 3) {
                expect(result.state).toBe("Bullish");
                expect(result.supporters).toBe(bullishCount);
              }
            }

            // Bearish requires sumVotes <= -3 AND supporters >= 3
            if (sumVotes <= -3) {
              const bearishCount = votes.filter((v) => v === -1).length;
              if (bearishCount >= 3) {
                expect(result.state).toBe("Bearish");
                expect(result.supporters).toBe(bearishCount);
              }
            }

            // Wait when not enough confluence
            if (Math.abs(sumVotes) < 3) {
              expect(result.state).toBe("Wait");
              expect(result.score).toBeLessThan(75);
            }

            // Three supporters + one opponent → score 50, cannot enter
            if (Math.abs(sumVotes) === 2) {
              expect(result.score).toBe(50);
              expect(result.state).toBe("Wait");
            }

            // Score is always a multiple of 25
            expect(result.score % 25).toBe(0);
            expect(result.score).toBeGreaterThanOrEqual(0);
            expect(result.score).toBeLessThanOrEqual(100);
          });
        }
      }
    }
  }
});

describe("computeSignalFromVotes — boundary equality", () => {
  it("sumVotes = 3 → Bullish (3 supporters)", () => {
    const result = computeSignalFromVotes([1, 1, 1, 0]);
    expect(result.state).toBe("Bullish");
    expect(result.score).toBe(75);
    expect(result.supporters).toBe(3);
    expect(result.opponents).toBe(0);
  });

  it("sumVotes = -3 → Bearish (3 supporters)", () => {
    const result = computeSignalFromVotes([-1, -1, -1, 0]);
    expect(result.state).toBe("Bearish");
    expect(result.score).toBe(75);
    expect(result.supporters).toBe(3);
  });

  it("sumVotes = 2 → Wait (score 50, below 75 threshold)", () => {
    const result = computeSignalFromVotes([1, 1, 0, 0]);
    expect(result.state).toBe("Wait");
    expect(result.score).toBe(50);
  });

  it("sumVotes = -2 → Wait (score 50)", () => {
    const result = computeSignalFromVotes([-1, -1, 0, 0]);
    expect(result.state).toBe("Wait");
    expect(result.score).toBe(50);
  });

  it("sumVotes = 0 → Wait (score 0)", () => {
    const result = computeSignalFromVotes([1, -1, 0, 0]);
    expect(result.state).toBe("Wait");
    expect(result.score).toBe(0);
  });

  it("all neutral → Wait (score 0)", () => {
    const result = computeSignalFromVotes([0, 0, 0, 0]);
    expect(result.state).toBe("Wait");
    expect(result.score).toBe(0);
  });

  it("4 bullish → Bullish (score 100)", () => {
    const result = computeSignalFromVotes([1, 1, 1, 1]);
    expect(result.state).toBe("Bullish");
    expect(result.score).toBe(100);
    expect(result.supporters).toBe(4);
  });

  it("4 bearish → Bearish (score 100)", () => {
    const result = computeSignalFromVotes([-1, -1, -1, -1]);
    expect(result.state).toBe("Bearish");
    expect(result.score).toBe(100);
    expect(result.supporters).toBe(4);
  });

  it("3 bullish + 1 bearish → Wait (sumVotes = 2, score 50)", () => {
    const result = computeSignalFromVotes([1, 1, 1, -1]);
    expect(result.state).toBe("Wait");
    expect(result.score).toBe(50);
    expect(result.sumVotes).toBe(2);
  });
});
