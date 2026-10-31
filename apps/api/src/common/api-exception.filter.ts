import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import { type ApiError, ErrorCodes } from "@personalos/contracts";
import type { Response } from "express";
import { AppError } from "./errors.js";

/** Renders every error as the shared ApiError shape. Internal details never reach the client. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("ApiExceptionFilter");

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) {
      // e.g. an SSE stream that already started; nothing sensible to render.
      res.end();
      return;
    }
    const { status, body } = this.toBody(exception);
    res.status(status).json(body);
  }

  private toBody(exception: unknown): { status: number; body: ApiError } {
    if (exception instanceof AppError) {
      const { retryable, details } = exception.options;
      return {
        status: exception.status,
        body: { error: { code: exception.code, message: exception.message, retryable, details } },
      };
    }
    if (exception instanceof ThrottlerException) {
      return {
        status: HttpStatus.TOO_MANY_REQUESTS,
        body: { error: { code: ErrorCodes.RATE_LIMITED, message: "Too many attempts. Wait a minute.", retryable: true } },
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === 404 ? ErrorCodes.NOT_FOUND : status === 401 ? ErrorCodes.UNAUTHENTICATED : ErrorCodes.INTERNAL;
      return { status, body: { error: { code, message: exception.message } } };
    }
    this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { error: { code: ErrorCodes.INTERNAL, message: "Something went wrong." } },
    };
  }
}
