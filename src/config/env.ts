import type { InMemoryCircuitBreakerConfig } from '../adapters/outbound/circuit-breaker/InMemoryCircuitBreaker';
import { circuitBreakerConfigFromEnv } from '../adapters/outbound/circuit-breaker/InMemoryCircuitBreaker';
import { DEFAULT_EVENT_SOURCE } from '../adapters/outbound/events/EventBridgePublisher';
import { parseFanoutQueueUrls } from '../adapters/outbound/events/LocalSqsFanoutPublisher';

export type AdapterMode = 'dynamodb' | 'in-memory';
export type RelayPublisher = 'eventbridge' | 'local-sqs';

export interface AppConfig {
  serviceName: string;
  port: number;
  adapterMode: AdapterMode;
  awsRegion: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  dynamodbEndpoint?: string;
  dynamodbTable: string;
  checkpointTable: string;
  idempotencyTtlSeconds: number;
  circuitBreaker: InMemoryCircuitBreakerConfig;
  contractsSchemaPath?: string;
  eventBusName: string;
  eventSource: string;
  relayPublisher: RelayPublisher;
  fanoutQueueUrls: string[];
  sqsEndpoint?: string;
  relayPollIntervalMs: number;
  relayBatchSize: number;
}

function str(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const v = env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const v = env[key];
  if (v === undefined || v === '') {
    return fallback;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function optional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  return v === undefined || v === '' ? undefined : v;
}

/**
 * Composition-root de configuração (12-factor). Lê `process.env` e produz um
 * `AppConfig` tipado e imutável. Nenhum adapter é construído aqui — apenas
 * valores. Mantém framework/AWS fora da configuração.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const relayPublisher = str(env, 'RELAY_PUBLISHER', 'eventbridge') as RelayPublisher;
  const fanoutRaw = optional(env, 'LOCAL_FANOUT_QUEUE_URLS') ?? optional(env, 'LOCAL_SQS_QUEUE_URLS');
  const base: AppConfig = {
    serviceName: str(env, 'SERVICE_NAME', 'authorization-service'),
    port: num(env, 'PORT', 3000),
    adapterMode: str(env, 'ADAPTER_MODE', 'dynamodb') as AdapterMode,
    awsRegion: str(env, 'AWS_REGION', 'us-east-1'),
    dynamodbTable: str(env, 'DYNAMODB_TABLE', 'authorization-service'),
    checkpointTable: str(env, 'DYNAMODB_CHECKPOINT_TABLE', 'authorization-service-checkpoint'),
    idempotencyTtlSeconds: num(env, 'IDEMPOTENCY_TTL_SECONDS', 86_400),
    circuitBreaker: circuitBreakerConfigFromEnv(env),
    eventBusName: str(env, 'EVENT_BUS_NAME', 'default'),
    eventSource: str(env, 'EVENT_SOURCE', DEFAULT_EVENT_SOURCE),
    relayPublisher: relayPublisher === 'local-sqs' ? 'local-sqs' : 'eventbridge',
    fanoutQueueUrls: parseFanoutQueueUrls(fanoutRaw),
    relayPollIntervalMs: num(env, 'RELAY_POLL_INTERVAL_MS', 1000),
    relayBatchSize: num(env, 'RELAY_BATCH_SIZE', 100),
  };

  const awsAccessKeyId = optional(env, 'AWS_ACCESS_KEY_ID');
  const awsSecretAccessKey = optional(env, 'AWS_SECRET_ACCESS_KEY');
  const dynamodbEndpoint = optional(env, 'DYNAMODB_ENDPOINT');
  const sqsEndpoint = optional(env, 'SQS_ENDPOINT');
  const contractsSchemaPath = optional(env, 'CONTRACTS_SCHEMA_PATH');

  return {
    ...base,
    ...(awsAccessKeyId !== undefined ? { awsAccessKeyId } : {}),
    ...(awsSecretAccessKey !== undefined ? { awsSecretAccessKey } : {}),
    ...(dynamodbEndpoint !== undefined ? { dynamodbEndpoint } : {}),
    ...(sqsEndpoint !== undefined ? { sqsEndpoint } : {}),
    ...(contractsSchemaPath !== undefined ? { contractsSchemaPath } : {}),
  };
}
