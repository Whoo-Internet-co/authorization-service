import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { loadConfig } from '../config/env';
import { buildContainer } from '../composition/buildContainer';
import { JsonLogger } from '../adapters/outbound/logging/JsonLogger';
import { DynamoDbCheckpointStore, InMemoryCheckpointStore } from './CheckpointStore';
import type { CheckpointStore } from './CheckpointStore';
import { OutboxRelay } from './OutboxRelay';

/**
 * Entry point do Outbox Relay (ADR-006) — processo separado da API
 * (`npm run relay` / `dist/relay/outbox-relay.js`).
 *
 * Lê o DynamoDB Stream da tabela single-table, filtra INSERTs da Outbox e
 * publica via DomainEventPublisher (EventBridge em produção; fan-out SQS
 * local via RELAY_PUBLISHER=local-sqs). Checkpoint de shards em
 * `DYNAMODB_CHECKPOINT_TABLE`.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = new JsonLogger({ serviceName: `${config.serviceName}-relay` });

  if (config.adapterMode !== 'dynamodb') {
    logger.warn(
      'Relay requer ADAPTER_MODE=dynamodb (DynamoDB Streams). Nada a fazer — encerrando.',
      { adapter_mode: config.adapterMode },
    );
    return;
  }

  const container = buildContainer(config, logger);
  const awsClientConfig = {
    region: config.awsRegion,
    ...(config.dynamodbEndpoint !== undefined ? { endpoint: config.dynamodbEndpoint } : {}),
    ...(config.awsAccessKeyId !== undefined && config.awsSecretAccessKey !== undefined
      ? {
          credentials: {
            accessKeyId: config.awsAccessKeyId,
            secretAccessKey: config.awsSecretAccessKey,
          },
        }
      : {}),
  };
  const streams = new DynamoDBStreamsClient(awsClientConfig);
  const dynamo = new DynamoDBClient(awsClientConfig);

  const checkpoint: CheckpointStore =
    container.dynamoDoc !== undefined
      ? new DynamoDbCheckpointStore(container.dynamoDoc, config.checkpointTable)
      : new InMemoryCheckpointStore();

  const relay = new OutboxRelay({
    streams,
    dynamo,
    tableName: config.dynamodbTable,
    publisher: container.publisher,
    checkpoint,
    logger,
    pollIntervalMs: config.relayPollIntervalMs,
    batchSize: config.relayBatchSize,
  });

  const shutdown = (signal: string): void => {
    logger.info('Sinal recebido — encerrando relay graciosamente', { signal });
    relay.stop();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await relay.start();
  streams.destroy();
  dynamo.destroy();
  await container.destroy();
  logger.info('Relay encerrado');
}

main().catch((error) => {
  process.stderr.write(`Fatal no outbox relay: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
