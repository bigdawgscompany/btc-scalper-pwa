import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createInitialAccount } from "../src/lib/paper/engine";
import { getDatabase, recordEvaluationStep, resetDatabase } from "../src/lib/paper/storage";

describe("paper storage revision continuity", () => {
  it("returns the stored incremented revision so the next evaluation can commit", async () => {
    await resetDatabase();
    const initial = await getDatabase().account.get("primary");
    expect(initial).toBeDefined();

    const decision = {
      id: "dec-revision-1",
      timestamp: Date.now(),
      confirmedCandleTime: 1,
      strategyVersion: "v2.0",
      action: "HOLD" as const,
      reason: "revision test",
      signalState: "Wait",
      signalScore: 0,
      quoteBid: "1",
      quoteAsk: "1",
    };

    const first = await recordEvaluationStep(initial ?? createInitialAccount(), decision, [], null, null);
    expect(first.revision).toBe(1);

    const decision2 = { ...decision, id: "dec-revision-2", timestamp: Date.now() + 1 };
    const second = await recordEvaluationStep(first, decision2, [], null, null);
    expect(second.revision).toBe(2);
    expect((await getDatabase().account.get("primary"))?.revision).toBe(2);
  });
});
