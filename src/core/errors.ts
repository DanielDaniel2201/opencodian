
/**
 * Base error class for Opencodian
 */
export class OpencodianError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpencodianError";
  }
}

/**
 * Thrown when the user manually cancels an operation
 */
export class UserCancellationError extends OpencodianError {
  constructor(message = "Operation cancelled by user") {
    super(message);
    this.name = "UserCancellationError";
  }
}

/**
 * Thrown when an operation times out
 */
export class TimeoutError extends OpencodianError {
  constructor(durationMs: number, context?: string) {
    super(`Operation timed out after ${durationMs}ms${context ? ` (${context})` : ""}`);
    this.name = "TimeoutError";
  }
}

/**
 * Thrown when the OpenCode server returns an error
 */
export class ServerError extends OpencodianError {
  constructor(public statusCode: number, message: string) {
    super(`Server error ${statusCode}: ${message}`);
    this.name = "ServerError";
  }
}

/**
 * Thrown when network connectivity fails
 */
export class NetworkError extends OpencodianError {
  constructor(originalError: Error) {
    super(`Network error: ${originalError.message}`);
    this.name = "NetworkError";
    this.stack = originalError.stack;
  }
}
