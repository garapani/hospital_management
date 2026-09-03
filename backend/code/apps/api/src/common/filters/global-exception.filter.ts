import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';

/**
 * Postgres SQLSTATE codes worth a specific client-facing status instead of a bare 500 that leaks
 * driver internals. This is a last-resort safety net, not the primary error-handling path: most
 * domain services already catch `QueryFailedError` at the point of use and translate a known
 * constraint violation into a meaningful `ConflictException` (see e.g. `role-management.service.ts`,
 * `appointments.service.ts`) — those pass through this filter unchanged via the `HttpException`
 * branch below. Only a `QueryFailedError` that reaches here uncaught gets this generic mapping.
 */
const PG_ERROR_MAP: Record<string, { status: number; message: string }> = {
  '57014': { status: 504, message: 'The request took too long to process and was cancelled.' },
  '23505': { status: 409, message: 'A record with this value already exists.' },
};

/**
 * Registered via `app.useGlobalFilters()` in main.ts — `@Catch()` with no argument makes this the
 * only exception handler for every route, replacing Nest's built-in default filter, so it must
 * keep doing what that filter did for the already-well-formed case (log + a consistent JSON
 * error body for both `HttpException`s and truly unexpected ones).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    if (exception instanceof QueryFailedError) {
      const code = (exception as QueryFailedError & { code?: string }).code;
      const mapped = code ? PG_ERROR_MAP[code] : undefined;
      if (mapped) {
        response.status(mapped.status).json({ statusCode: mapped.status, message: mapped.message });
        return;
      }
    }

    this.logger.error(
      `Unhandled exception: ${exception instanceof Error ? exception.stack : String(exception)}`,
    );
    response.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}
