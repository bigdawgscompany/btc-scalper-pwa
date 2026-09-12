import { describe, expect, it } from "vitest";
import { INTERVAL_MS } from "../src/lib/contracts";
import { validateSingleCandle, spansBoundary, isExpectedIntervalMissing } from "../src/lib/market/validation";

describe("market validation hardening", () => {
  it("rejects a mismatched supplied closeTime", () => {
    const openTime = 1_800_000_000_000 - (1_800_000_000_000 % INTERVAL_MS);
    expect(() => validateSingleCandle(openTime, 100, 110, 90, 105, 1, openTime + INTERVAL_MS - 2)).toThrow("does not match expected");
  });

  it("detects a 15-minute boundary crossing", () => {
    const before = 10 * INTERVAL_MS + 999;
    const after = 11 * INTERVAL_MS + 1;
    expect(spansBoundary(before, after)).toBe(true);
  });

  it("expires a series early when the expected next interval is missing", () => {
    const openTime = 100 * INTERVAL_MS;
    const closeTime = openTime + INTERVAL_MS - 1;
    expect(isExpectedIntervalMissing({
      openTime,
      closeTime,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 10,
    }, openTime + INTERVAL_MS + 1)).toBe(true);
  });
});
