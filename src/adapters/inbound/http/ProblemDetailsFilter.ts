import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { Response, Request } from 'express';
import { ProblemException } from './ProblemException';
import {
  mapErrorToProblem,
  PROBLEM_TITLE,
  PROBLEM_TYPE,
} from './problemMapping';

/**
 * Filtro global de exceções — serializa TODA resposta de erro como
 * `application/problem+json` (RFC 7807) com `correlation_id`.
 *
 * - `ProblemException` → corpo direto;
 * - `HttpException` do Nest (JSON malformado, rota desconhecida) → problem
 *   equivalente (400 validação / 404 não encontrado);
 * - demais erros → `mapErrorToProblem` (domínio/aplicação/500).
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = (request.correlationId ?? '') as string;
    const instance = request.originalUrl;

    const problem = this.toProblem(exception, instance);
    const body = problem.toBody(correlationId);

    if (problem.retryAfterSeconds !== undefined) {
      response.setHeader('Retry-After', String(problem.retryAfterSeconds));
    }
    response
      .status(problem.status)
      .type('application/problem+json')
      .send(JSON.stringify(body));
  }

  private toProblem(exception: unknown, instance: string): ProblemException {
    if (exception instanceof ProblemException) {
      return exception;
    }
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception, instance);
    }
    return mapErrorToProblem(exception, instance);
  }

  private fromHttpException(exception: HttpException, instance: string): ProblemException {
    const status = exception.getStatus();
    if (status === HttpStatus.NOT_FOUND) {
      return new ProblemException({
        status: 404,
        type: PROBLEM_TYPE.validacao,
        title: 'Recurso não encontrado',
        detail: 'O recurso solicitado não existe.',
        instance,
      });
    }
    // BadRequest (JSON malformado, body ausente, etc.) → 422 validação.
    return new ProblemException({
      status: status === HttpStatus.BAD_REQUEST ? 422 : status,
      type: status === HttpStatus.BAD_REQUEST ? PROBLEM_TYPE.validacao : PROBLEM_TYPE.interno,
      title:
        status === HttpStatus.BAD_REQUEST
          ? PROBLEM_TITLE[PROBLEM_TYPE.validacao]
          : PROBLEM_TITLE[PROBLEM_TYPE.interno],
      detail: this.extractDetail(exception),
      instance,
    });
  }

  private extractDetail(exception: HttpException): string {
    const res = exception.getResponse();
    if (typeof res === 'string') {
      return res;
    }
    if (typeof res === 'object' && res !== null) {
      const message = (res as { message?: unknown }).message;
      if (Array.isArray(message)) {
        return message.join('; ');
      }
      if (typeof message === 'string') {
        return message;
      }
    }
    return exception.message;
  }
}
