import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let reason = 'An unexpected error occurred';

    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === 'object' && response !== null) {
        const resp = response as Record<string, unknown>;
        code = (typeof resp.code === 'string' ? resp.code : null) || this.statusToCode(status);
        if (typeof resp.reason === 'string') {
          reason = resp.reason;
        } else if (typeof resp.message === 'string') {
          reason = resp.message;
        } else if (Array.isArray(resp.message)) {
          reason = (resp.message as string[]).join(', ');
        }
        const STRIP_KEYS = new Set(['statusCode', 'code', 'message', 'reason', 'error']);
        for (const [k, v] of Object.entries(resp)) {
          if (!STRIP_KEYS.has(k)) extra[k] = v;
        }
      } else if (typeof response === 'string') {
        reason = response;
        code = this.statusToCode(status);
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    reply.status(status).send({
      errors: [
        {
          code,
          reason,
          ...extra,
          datetime: new Date().toISOString(),
          path: request.url,
        },
      ],
    });
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
    };
    return map[status] || 'UNKNOWN_ERROR';
  }
}
