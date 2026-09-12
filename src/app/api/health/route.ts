import { jsonResponse } from "@/lib/server/http";

/** Handle a read-only API request for the route. */
export async function GET() {
  return jsonResponse({
    schemaVersion: 2,
    status: "ok",
    service: "btc-scalper",
    timestamp: Date.now(),
    uptime: process.uptime(),
    notice: "Process liveness only; does not prove upstream exchange connectivity.",
  });
}
