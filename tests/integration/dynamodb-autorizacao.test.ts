import { CreateTableCommand, DeleteTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { PutCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBStreamsClient } from '@aws-sdk/client-dynamodb-streams';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createDynamoDbClient } from '../../src/adapters/outbound/dynamodb/DynamoDbClientFactory';
import { DynamoDbLimitRepository } from '../../src/adapters/outbound/dynamodb/DynamoDbLimitRepository';
import { DynamoDbIdempotencyRepository } from '../../src/adapters/outbound/dynamodb/DynamoDbIdempotencyRepository';
import {
  buildContractItem,
  ENTITY_OUTBOX,
  ENTITY_ATTRIBUTE,
  contractKey,
} from '../../src/adapters/outbound/dynamodb/DynamoDbTable';
import { Contrato } from '../../src/domain/entities/Contrato';
import { AutorizarTransacaoUseCase } from '../../src/application/use-cases/AutorizarTransacaoUseCase';
import type { AutorizarTransacaoCommand } from '../../src/application/use-cases/AutorizarTransacaoUseCase';
import { InMemoryCircuitBreaker } from '../../src/adapters/outbound/circuit-breaker/InMemoryCircuitBreaker';
import { JsonSchemaEventValidator } from '../../src/adapters/outbound/validation/JsonSchemaEventValidator';
import { SystemClock } from '../../src/adapters/outbound/clock/SystemClock';
import { UuidIdGenerator } from '../../src/adapters/outbound/id/UuidIdGenerator';
import { OutboxRelay } from '../../src/relay/OutboxRelay';
import { InMemoryCheckpointStore } from '../../src/relay/CheckpointStore';
import { InMemoryDomainEventPublisher } from '../../src/adapters/outbound/inmemory';
import type { Logger } from '../../src/application/ports/Logger';
import { IdempotencyConflictError } from '../../src/domain/errors/DomainError';

const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
const region = process.env.AWS_REGION ?? 'us-east-1';
const TABLE = `auth-it-${Date.now()}`;
const CHECKPOINT_TABLE = `${TABLE}-checkpoint`;

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const raw = new DynamoDBClient({
  region,
  endpoint,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});
const doc = createDynamoDbClient({
  region,
  endpoint,
  accessKeyId: 'local',
  secretAccessKey: 'local',
});
const streams = new DynamoDBStreamsClient({
  region,
  endpoint,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

async function waitActive(name: string): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    const d = await raw.send(new DescribeTableCommand({ TableName: name }));
    if (d.Table?.TableStatus === 'ACTIVE') return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Tabela ${name} não ficou ACTIVE`);
}

async function ensureTables(): Promise<void> {
  await raw.send(
    new CreateTableCommand({
      TableName: TABLE,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'gsi1_pk', AttributeType: 'S' },
        { AttributeName: 'gsi1_sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'gsi-auth',
          KeySchema: [
            { AttributeName: 'gsi1_pk', KeyType: 'HASH' },
            { AttributeName: 'gsi1_sk', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
      StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_IMAGE' },
    }),
  );
  await raw.send(
    new CreateTableCommand({
      TableName: CHECKPOINT_TABLE,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    }),
  );
  await waitActive(TABLE);
  await waitActive(CHECKPOINT_TABLE);
}

async function dropTables(): Promise<void> {
  for (const name of [TABLE, CHECKPOINT_TABLE]) {
    try {
      await raw.send(new DeleteTableCommand({ TableName: name }));
    } catch {
      // ignore
    }
  }
}

async function seedContrato(id: string, available: number): Promise<void> {
  const contrato = Contrato.create({
    idContrato: id,
    availableLimit: available,
    totalLimit: available,
    moeda: 'BRL',
    ativo: true,
  });
  await doc.send(
    new PutCommand({
      TableName: TABLE,
      Item: buildContractItem(contrato),
    }),
  );
}

function buildUseCase(): AutorizarTransacaoUseCase {
  return new AutorizarTransacaoUseCase(
    new DynamoDbLimitRepository(doc, TABLE, silentLogger),
    new DynamoDbIdempotencyRepository(doc, TABLE),
    new JsonSchemaEventValidator(),
    silentLogger,
    new SystemClock(),
    new UuidIdGenerator(),
    new InMemoryCircuitBreaker({ forceOpen: false, failureThreshold: 5, cooldownMs: 30_000 }),
    { idempotencyTtlSeconds: 86400 },
  );
}

function cmd(partial: Partial<AutorizarTransacaoCommand> & { idContrato: string }): AutorizarTransacaoCommand {
  return {
    idConta: 'ACC-IT',
    valor: 100,
    moeda: 'BRL',
    tipoOperacao: 'DEBITO',
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}`,
    correlationId: 'corr-it',
    traceId: null,
    ...partial,
  };
}

describe('Integração DynamoDB Local', () => {
  beforeAll(async () => {
    await ensureTables();
  }, 60_000);

  afterAll(async () => {
    await dropTables();
  }, 30_000);

  it('aprova, grava outbox na mesma transação e relay preserva event_id', async () => {
    const idContrato = 'CTR-OUTBOX';
    await seedContrato(idContrato, 1000);
    const useCase = buildUseCase();
    const result = await useCase.execute(
      cmd({ idContrato, valor: 150, idempotencyKey: 'outbox-key-1' }),
    );
    expect(result.kind).toBe('APROVADA');

    const outboxScan = await doc.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: '#e = :outbox',
        ExpressionAttributeNames: { '#e': ENTITY_ATTRIBUTE },
        ExpressionAttributeValues: { ':outbox': ENTITY_OUTBOX },
      }),
    );
    const outboxItems = (outboxScan.Items ?? []).filter(
      (i) => i.id_contrato === idContrato,
    );
    expect(outboxItems).toHaveLength(1);
    const eventId = String(outboxItems[0]!.event_id);

    const publisher = new InMemoryDomainEventPublisher();
    const relay = new OutboxRelay({
      streams,
      dynamo: raw,
      tableName: TABLE,
      publisher,
      checkpoint: new InMemoryCheckpointStore(),
      logger: silentLogger,
      pollIntervalMs: 50,
      batchSize: 100,
      sleep: async () => undefined,
    });

    // DynamoDB Local streams podem precisar de alguns polls
    let published = 0;
    for (let i = 0; i < 30 && published === 0; i += 1) {
      published += await relay.pollOnce();
      if (published === 0) await new Promise((r) => setTimeout(r, 200));
    }
    expect(published).toBeGreaterThanOrEqual(1);
    const match = publisher.published.find((e) => e.eventId === eventId);
    expect(match).toBeDefined();
    expect(match!.eventId).toBe(eventId);
  }, 90_000);

  it('replay idempotente → REPLAY sem nova reserva', async () => {
    const idContrato = 'CTR-REPLAY';
    await seedContrato(idContrato, 1000);
    const useCase = buildUseCase();
    const key = 'replay-key-1';
    const first = await useCase.execute(cmd({ idContrato, valor: 100, idempotencyKey: key }));
    expect(first.kind).toBe('APROVADA');
    const second = await useCase.execute(cmd({ idContrato, valor: 100, idempotencyKey: key }));
    expect(second.kind).toBe('REPLAY');
    const got = await doc.send(
      new GetCommand({ TableName: TABLE, Key: contractKey(idContrato), ConsistentRead: true }),
    );
    expect(got.Item!.available_limit).toBe(900);
  }, 60_000);

  it('mesma chave / payload diferente → 409', async () => {
    const idContrato = 'CTR-CONFLICT';
    await seedContrato(idContrato, 1000);
    const useCase = buildUseCase();
    const key = 'conflict-key-1';
    await useCase.execute(cmd({ idContrato, valor: 100, idempotencyKey: key }));
    await expect(
      useCase.execute(cmd({ idContrato, valor: 200, idempotencyKey: key })),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  }, 60_000);

  it('concorrência: available=1000 + 2×700 → exatamente 1 aprovada (loop 10×)', async () => {
    for (let round = 0; round < 10; round += 1) {
      const idContrato = `CTR-CONC-${round}`;
      await seedContrato(idContrato, 1000);
      const useCase = buildUseCase();

      const [a, b] = await Promise.all([
        useCase.execute(
          cmd({ idContrato, valor: 700, idempotencyKey: `conc-${round}-a` }),
        ),
        useCase.execute(
          cmd({ idContrato, valor: 700, idempotencyKey: `conc-${round}-b` }),
        ),
      ]);

      const kinds = [a.kind, b.kind].sort();
      const aprovadas = [a, b].filter((r) => r.kind === 'APROVADA');
      const recusas = [a, b].filter(
        (r) => r.kind === 'LIMITE_INSUFICIENTE' || r.kind === 'CONFLITO',
      );

      expect(aprovadas).toHaveLength(1);
      expect(recusas).toHaveLength(1);
      expect(kinds.filter((k) => k === 'APROVADA')).toHaveLength(1);

      const got = await doc.send(
        new GetCommand({ TableName: TABLE, Key: contractKey(idContrato), ConsistentRead: true }),
      );
      expect(got.Item!.available_limit).toBe(300);
    }
  }, 180_000);
});
