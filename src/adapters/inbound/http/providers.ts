import type { Provider, OnApplicationShutdown } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { loadConfig } from '../../../config/env';
import type { AppConfig } from '../../../config/env';
import { buildContainer } from '../../../composition/buildContainer';
import type { ServiceContainer } from '../../../composition/buildContainer';
import type { AutorizarTransacaoUseCase } from '../../../application/use-cases/AutorizarTransacaoUseCase';
import type { Logger } from '../../../application/ports/Logger';

/** Tokens de injeção (composition root exposto ao NestJS sem acoplar domínio). */
export const CONFIG = Symbol('CONFIG');
export const CONTAINER = Symbol('CONTAINER');
export const LOGGER = Symbol('LOGGER');
export const USE_CASE = Symbol('USE_CASE');

export interface UseCaseToken {
  useCase: AutorizarTransacaoUseCase;
}

export const containerProviders: Provider[] = [
  { provide: CONFIG, useFactory: (): AppConfig => loadConfig() },
  {
    provide: CONTAINER,
    useFactory: (config: AppConfig): ServiceContainer => buildContainer(config),
    inject: [CONFIG],
  },
  {
    provide: LOGGER,
    useFactory: (container: ServiceContainer): Logger => container.logger,
    inject: [CONTAINER],
  },
  {
    provide: USE_CASE,
    useFactory: (container: ServiceContainer): AutorizarTransacaoUseCase => container.useCase,
    inject: [CONTAINER],
  },
];

/** Libera clientes AWS no shutdown gracioso do Nest. */
@Injectable()
export class ContainerLifecycle implements OnApplicationShutdown {
  constructor(private readonly container: ServiceContainer) {}

  async onApplicationShutdown(): Promise<void> {
    await this.container.destroy();
  }
}

export const lifecycleProviders: Provider[] = [
  {
    provide: ContainerLifecycle,
    useFactory: (container: ServiceContainer): ContainerLifecycle =>
      new ContainerLifecycle(container),
    inject: [CONTAINER],
  },
];
