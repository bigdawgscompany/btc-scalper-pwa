import { jsonResponse } from "@/lib/server/http";

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
