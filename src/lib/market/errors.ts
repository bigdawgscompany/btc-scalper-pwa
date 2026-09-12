export class MarketError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;

  constructor(message: string, code = "MARKET_ERROR", httpStatus = 502) {
    super(message);
    this.name = "MarketError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** Represents a malformed or unsupported client request. */
export class InvalidRequestError extends MarketError {
  constructor(message: string) {
    super(message, "INVALID_REQUEST", 400);
    this.name = "InvalidRequestError";
  }
}

export class ValidationError extends MarketError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 422);
    this.name = "ValidationError";
  }
}

export class ProviderUnavailableError extends MarketError {
  constructor(message = "Market data providers unavailable") {
    super(message, "PROVIDER_UNAVAILABLE", 503);
    this.name = "ProviderUnavailableError";
  }
}

export class TimeoutError extends MarketError {
  constructor(message = "Market data request timed out") {
    super(message, "REQUEST_TIMEOUT", 504);
    this.name = "TimeoutError";
  }
}

export class RateLimitError extends MarketError {
  constructor(message = "Rate limit reached, please back off") {
    super(message, "RATE_LIMITED", 429);
    this.name = "RateLimitError";
  }
}
