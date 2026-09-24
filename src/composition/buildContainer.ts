import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SQSClient } from '@aws-sdk/client-sqs';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { AppConfig } from '../config/env';
import type { Logger } from '../application/ports/Logger';
import type { Clock } from '../application/ports/Clock';
import type { IdGenerator } from '../application/ports/IdGenerator';
import type { CircuitBreaker } from '../application/ports/CircuitBreaker';
import type { EventSchemaValidator } from '../application/ports/EventSchemaValidator';
import type { LimitRepository } from '../application/ports/LimitRepository';
import type { IdempotencyRepository } from '../application/ports/IdempotencyRepository';
import type { OutboxRepository } from '../application/ports/OutboxRepository';
import type { DomainEventPublisher } from '../application/ports/DomainEventPublisher';
import {
  AutorizarTransacaoUseCase,
} from '../application/use-cases/AutorizarTransacaoUseCase';
import { JsonLogger } from '../adapters/outbound/logging/JsonLogger';
import { SystemClock } from '../adapters/outbound/clock/SystemClock';
import { UuidIdGenerator } from '../adapters/outbound/id/UuidIdGenerator';
import { InMemoryCircuitBreaker } from '../adapters/outbound/circuit-breaker/InMemoryCircuitBreaker';
import { JsonSchemaEventValidator } from '../adapters/outbound/validation/JsonSchemaEventValidator';
import {
  createDynamoDbClient,
} from '../adapters/outbound/dynamodb/DynamoDbClientFactory';
import { DynamoDbLimitRepository } from '../adapters/outbound/dynamodb/DynamoDbLimitRepository';
import { DynamoDbIdempotencyRepository } from '../adapters/outbound/dynamodb/DynamoDbIdempotencyRepository';
import { DynamoDbOutboxRepository } from '../adapters/outbound/dynamodb/DynamoDbOutboxRepository';
import {
  InMemoryIdempotencyRepository,
  InMemoryLimitRepository,
  InMemoryOutboxRepository,
} from '../adapters/outbound/inmemory';
import { EventBridgePublisher } from '../adapters/outbound/events/EventBridgePublisher';
import { LocalSqsFanoutPublisher } from '../adapters/outbound/events/LocalSqsFanoutPublisher';

export interface ServiceContainer {
  config: AppConfig;
  logger: Logger;
  clock: Clock;
  idGenerator: IdGenerator;
  circuitBreaker: CircuitBreaker;
  validator: EventSchemaValidator;
  limitRepository: LimitRepository;
  idempotencyRepository: IdempotencyRepository;
  outboxRepository: OutboxRepository;
  publisher: DomainEventPublisher;
  useCase: AutorizarTransacaoUseCase;
  /** Presente apenas em modo dynamodb (usado pelo relay). */
  dynamoDoc?: DynamoDBDocumentClient;
  /** Libera clientes AWS (shutdown gracioso). */
  destroy(): Promise<void>;
}

/**
 * Composition root (ADR-001): instancia adapters concretos e injeta no
 * use case. Único ponto que conhece AWS SDK + frameworks de persistência.
 * Nem o domínio nem a aplicação referenciam esta camada.
 */
export function buildContainer(config: AppConfig, loggerOverride?: Logger): ServiceContainer {
  const logger = loggerOverride ?? new JsonLogger({ serviceName: config.serviceName });
  const clock = new SystemClock();
  const idGenerator = new UuidIdGenerator();
  const circuitBreaker = new InMemoryCircuitBreaker(config.circuitBreaker, clock);
  const validator = new JsonSchemaEventValidator(
    config.contractsSchemaPath !== undefined ? { schemaPath: config.contractsSchemaPath } : {},
  );

  const clients: Array<() => void> = [];

  let limitRepository: LimitRepository;
  let idempotencyRepository: IdempotencyRepository;
  let outboxRepository: OutboxRepository;
  let dynamoDoc: DynamoDBDocumentClient | undefined;

  if (config.adapterMode === 'in-memory') {
    const memLimit = new InMemoryLimitRepository();
    const memIdem = new InMemoryIdempotencyRepository();
    const memOutbox = new InMemoryOutboxRepository();
    memLimit.link(memIdem, memOutbox);
    limitRepository = memLimit;
    idempotencyRepository = memIdem;
    outboxRepository = memOutbox;
  } else {
    dynamoDoc = createDynamoDbClient({
      region: config.awsRegion,
      ...(config.dynamodbEndpoint !== undefined ? { endpoint: config.dynamodbEndpoint } : {}),
      ...(config.awsAccessKeyId !== undefined ? { accessKeyId: config.awsAccessKeyId } : {}),
      ...(config.awsSecretAccessKey !== undefined ? { secretAccessKey: config.awsSecretAccessKey } : {}),
    });
    limitRepository = new DynamoDbLimitRepository(dynamoDoc, config.dynamodbTable, logger);
    idempotencyRepository = new DynamoDbIdempotencyRepository(dynamoDoc, config.dynamodbTable);
    outboxRepository = new DynamoDbOutboxRepository(dynamoDoc, config.dynamodbTable);
  }

  const publisher = buildPublisher(config, logger, clients);

  const useCase = new AutorizarTransacaoUseCase(
    limitRepository,
    idempotencyRepository,
    validator,
    logger,
    clock,
    idGenerator,
    circuitBreaker,
    { idempotencyTtlSeconds: config.idempotencyTtlSeconds },
  );

  return {
    config,
    logger,
    clock,
    idGenerator,
    circuitBreaker,
    validator,
    limitRepository,
    idempotencyRepository,
    outboxRepository,
    publisher,
    useCase,
    ...(dynamoDoc !== undefined ? { dynamoDoc } : {}),
    destroy() {
      for (const dispose of clients) {
        dispose();
      }
      return Promise.resolve();
    },
  };
}

function buildPublisher(
  config: AppConfig,
  logger: Logger,
  clients: Array<() => void>,
): DomainEventPublisher {
  if (config.relayPublisher === 'local-sqs') {
    const sqs = new SQSClient({
      region: config.awsRegion,
      ...(config.sqsEndpoint !== undefined ? { endpoint: config.sqsEndpoint } : {}),
      ...(config.awsAccessKeyId !== undefined && config.awsSecretAccessKey !== undefined
        ? {
            credentials: {
              accessKeyId: config.awsAccessKeyId,
              secretAccessKey: config.awsSecretAccessKey,
            },
          }
        : {}),
    });
    clients.push(() => sqs.destroy());
    return new LocalSqsFanoutPublisher({
      client: sqs,
      queueUrls: config.fanoutQueueUrls,
      source: config.eventSource,
      logger,
    });
  }
  const eb = new EventBridgeClient({
    region: config.awsRegion,
    ...(config.awsAccessKeyId !== undefined && config.awsSecretAccessKey !== undefined
      ? {
          credentials: {
            accessKeyId: config.awsAccessKeyId,
            secretAccessKey: config.awsSecretAccessKey,
          },
        }
      : {}),
  });
  clients.push(() => eb.destroy());
  return new EventBridgePublisher({
    client: eb,
    eventBusName: config.eventBusName,
    source: config.eventSource,
    logger,
  });
}
