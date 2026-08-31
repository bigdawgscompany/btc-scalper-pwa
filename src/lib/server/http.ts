import { NextResponse } from "next/server";
import { ErrorResponseSchema, type ErrorResponse } from "../contracts";
import { MarketError } from "../market/errors";

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
  } else if (error instanceof Error) {
    message = error.message;
  }

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
