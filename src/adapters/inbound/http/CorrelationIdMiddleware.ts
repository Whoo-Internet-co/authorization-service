import type { NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
      traceId: string | null;
    }
  }
}

function firstHeader(req: Request, names: string[]): string | undefined {
  for (const name of names) {
    const value = req.headers[name];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Middleware de correlação: garante um `correlation_id` por requisição
 * (header `x-correlation-id` ou gerado) e propaga `trace_id` (W3C
 * `traceparent` ou `x-trace-id`). Expõe ambos no response header e no
 * `Request` para uso pelo controller e pelo filtro RFC 7807.
 */
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId = firstHeader(req, ['x-correlation-id', 'correlation-id']) ?? randomUUID();
    const traceparent = firstHeader(req, ['traceparent']);
    const traceId = traceparent ?? firstHeader(req, ['x-trace-id']) ?? null;

    req.correlationId = correlationId;
    req.traceId = traceId;
    res.setHeader('X-Correlation-Id', correlationId);
    next();
  }
}
