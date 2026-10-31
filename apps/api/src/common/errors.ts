import { HttpStatus } from "@nestjs/common";
import { ErrorCodes } from "@personalos/contracts";

type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Domain error carrying a stable API error code. Rendered by ApiExceptionFilter. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: HttpStatus,
    message: string,
    readonly options: { retryable?: boolean; details?: unknown } = {},
  ) {
    super(message);
  }

  static notFound(what = "Resource") {
    return new AppError(ErrorCodes.NOT_FOUND, HttpStatus.NOT_FOUND, `${what} not found`);
  }
  static unauthenticated() {
    return new AppError(ErrorCodes.UNAUTHENTICATED, HttpStatus.UNAUTHORIZED, "Sign in required");
  }
  static gatewayUnavailable(details?: unknown) {
    return new AppError(
      ErrorCodes.GATEWAY_UNAVAILABLE,
      HttpStatus.SERVICE_UNAVAILABLE,
      "The assistant runtime is unavailable. Try again shortly.",
      { retryable: true, details },
    );
  }
}
