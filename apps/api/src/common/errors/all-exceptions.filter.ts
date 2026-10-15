import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Prisma } from "@sqms/db";
import { ThrottlerException } from "@nestjs/throttler";
import type { Response } from "express";
import { RequestContext } from "../context/request-context";
import { AppError } from "./app-errors";

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; correlationId: string | null };
}

/**
 * Converts every error into a consistent JSON shape. Internal details (stack traces, SQL, driver messages) are logged
 * server-side with the correlation id and never returned to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Exceptions");

  constructor(private readonly exposeInternalMessages: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const correlationId = RequestContext.correlationId();
    const { status, body } = this.map(exception, correlationId);
    if (status >= 500) {
      this.logger.error(`[${correlationId}] ${exception instanceof Error ? exception.stack ?? exception.message : String(exception)}`);
    }
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(status).json(body);
  }

  private map(exception: unknown, correlationId: string | null): { status: number; body: ErrorBody } {
    const make = (status: number, code: string, message: string, details?: unknown) => ({
      status,
      body: { error: { code, message, ...(details === undefined ? {} : { details }), correlationId } },
    });

    if (exception instanceof AppError) return make(exception.status, exception.code, exception.message, exception.details);

    if (exception instanceof ThrottlerException) return make(429, "RATE_LIMITED", "Too many requests. Please try again later.");

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (status === HttpStatus.BAD_REQUEST && typeof response === "object" && response !== null && Array.isArray((response as { message?: unknown }).message)) {
        return make(400, "VALIDATION_FAILED", "Request validation failed", { fields: (response as { message: string[] }).message });
      }
      const message = typeof response === "string" ? response : ((response as { message?: string }).message ?? exception.message);
      const code = status === 404 ? "NOT_FOUND" : status === 413 ? "PAYLOAD_TOO_LARGE" : status === 401 ? "UNAUTHORIZED" : status === 403 ? "FORBIDDEN" : `HTTP_${status}`;
      return make(status, code, String(message));
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case "P2002":
          return make(409, "DUPLICATE", "A record with the same unique values already exists", { target: (exception.meta as { target?: unknown } | undefined)?.target });
        case "P2025":
          return make(404, "NOT_FOUND", "Record not found");
        case "P2003":
          return make(422, "INVALID_REFERENCE", "A referenced record does not exist");
        case "P2034":
          return make(409, "TRANSACTION_CONFLICT", "The operation conflicted with a concurrent change. Please retry.");
        default:
          break;
      }
    }

    if (exception instanceof Prisma.PrismaClientValidationError) {
      return make(400, "VALIDATION_FAILED", "Request validation failed");
    }

    const message = this.exposeInternalMessages && exception instanceof Error ? exception.message : "An unexpected error occurred";
    return make(500, "INTERNAL_ERROR", message);
  }
}
