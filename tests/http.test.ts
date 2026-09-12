import { describe, expect, it } from "vitest";
import { parseStrictQuery } from "../src/lib/server/http";

describe("strict API query parsing", () => {
  it("accepts declared unique keys", () => {
    const request = new Request("https://example.test/api/signal?symbol=BTCUSDT&interval=15m");
    expect(parseStrictQuery(request, ["symbol", "interval"])).toEqual({ symbol: "BTCUSDT", interval: "15m" });
  });

  it("rejects unknown keys", () => {
    const request = new Request("https://example.test/api/signal?evil=1");
    expect(() => parseStrictQuery(request, ["symbol", "interval"])).toThrow("Unsupported query parameter");
  });

  it("rejects duplicate keys", () => {
    const request = new Request("https://example.test/api/signal?symbol=BTCUSDT&symbol=BTCUSDT");
    expect(() => parseStrictQuery(request, ["symbol", "interval"])).toThrow("Duplicate query parameter");
  });
});
