import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { AutorizacoesController } from './adapters/inbound/http/AutorizacoesController';
import { HealthController } from './adapters/inbound/http/HealthController';
import { ProblemDetailsFilter } from './adapters/inbound/http/ProblemDetailsFilter';
import { CorrelationIdMiddleware } from './adapters/inbound/http/CorrelationIdMiddleware';
import { ProblemException } from './adapters/inbound/http/ProblemException';
import {
  containerProviders,
  lifecycleProviders,
} from './adapters/inbound/http/providers';
import { flattenValidationErrors, PROBLEM_TITLE, PROBLEM_TYPE } from './adapters/inbound/http/problemMapping';

/**
 * Módulo raiz (composition root do NestJS). Registra:
 * - providers do container (config → adapters → use case) e lifecycle;
 * - `ValidationPipe` global (class-validator) que falha com 422 problem+json;
 * - `ProblemDetailsFilter` global (RFC 7807);
 * - `CorrelationIdMiddleware` em todas as rotas.
 */
@Module({
  controllers: [AutorizacoesController, HealthController],
  providers: [
    ...containerProviders,
    ...lifecycleProviders,
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
        exceptionFactory: (errors: ValidationError[]) =>
          new ProblemException({
            status: 422,
            type: PROBLEM_TYPE.validacao,
            title: PROBLEM_TITLE[PROBLEM_TYPE.validacao],
            detail: 'Um ou mais campos da requisição são inválidos.',
            errors: flattenValidationErrors(errors),
          }),
      }),
    },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
