import { NextResponse } from "next/server";
import { ErrorResponseSchema, type ErrorResponse } from "../contracts";
import { InvalidRequestError, MarketError } from "../market/errors";

/** Serialize a successful API payload with no-store caching semantics. */
export function jsonResponse<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Parse a fixed-parameter query string and reject unknown keys. */
export function parseStrictQuery(
  request: Request,
  allowedKeys: readonly string[]
): Record<string, string> {
  const url = new URL(request.url);
  const allowed = new Set(allowedKeys);
  const values: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (!allowed.has(key)) {
      throw new InvalidRequestError(`Unsupported query parameter: ${key}`);
    }
    if (values[key] !== undefined) {
      throw new InvalidRequestError(`Duplicate query parameter: ${key}`);
    }
    values[key] = value;
  }
  return values;
}

/** Serialize a safe API error response without exposing internal details. */
export function errorResponse(
  error: unknown,
  fallbackMessage = "Internal server error"
): NextResponse<ErrorResponse> {
  let code = "INTERNAL_SERVER_ERROR";
  let message = fallbackMessage;
  let status = 500;

  if (error instanceof MarketError) {
    code = error.code;
    message = error.message;
    status = error.httpStatus;
  }
  // Generic Errors: redact internal details — never leak stack traces or
  // internal provider bodies (§4). Use the fallback message instead.

  const payload: ErrorResponse = {
    schemaVersion: 2,
    error: {
      code,
      message,
      timestamp: Date.now(),
    },
  };

  ErrorResponseSchema.parse(payload);
  return jsonResponse(payload, status);
}