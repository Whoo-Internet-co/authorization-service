import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadConfig } from './config/env';
import { JsonLogger } from './adapters/outbound/logging/JsonLogger';

/**
 * Bootstrap da API HTTP (NestJS). Porta via `PORT` (padrão 3000).
 * `enableShutdownHooks` garante liberação de clientes AWS no SIGTERM
 * (encerramento gracioso em ECS/Fargate — ADR-002).
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new JsonLogger({ serviceName: config.serviceName });
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn'],
  });
  app.disable('x-powered-by');
  app.enableShutdownHooks();
  await app.listen(config.port);
  logger.info('Authorization Service HTTP iniciada', {
    port: config.port,
    adapter_mode: config.adapterMode,
    relay_publisher: config.relayPublisher,
    health: '/health',
  });
}

bootstrap().catch((error) => {
  process.stderr.write(`Fatal no bootstrap: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
