// scripts/init-local-tables.mjs
//
// Cria a infraestrutura local idempotente:
//   - tabela single-table `authorization-service` (PK/SK + GSI gsi-auth +
//     Stream NEW_IMAGE + TTL em `ttl`);
//   - tabela de checkpoint do relay `authorization-service-checkpoint`;
//   - filas SQS (quando SQS_ENDPOINT definido) para o fan-out local do relay.
//
// Uso (compose ou manual):
//   DYNAMODB_ENDPOINT=http://localhost:8000 node scripts/init-local-tables.mjs
//
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';
import { SQSClient, CreateQueueCommand } from '@aws-sdk/client-sqs';

const region = process.env.AWS_REGION ?? 'us-east-1';
const credentials =
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined;

const dynamodbEndpoint = process.env.DYNAMODB_ENDPOINT; // ex.: http://localhost:8000
const tableName = process.env.DYNAMODB_TABLE ?? 'authorization-service';
const checkpointTable = process.env.DYNAMODB_CHECKPOINT_TABLE ?? 'authorization-service-checkpoint';
const sqsEndpoint = process.env.SQS_ENDPOINT; // ex.: http://localhost:9324 (ElasticMQ)
const queueNames = (process.env.LOCAL_QUEUE_NAMES ?? 'fraud-queue,accounting-queue,notification-queue')
  .split(',')
  .map((q) => q.trim())
  .filter(Boolean);

const log = (msg) => process.stdout.write(`[init-local] ${msg}\n`);

/** Erros transitórios de conexão (serviço local ainda subindo). */
function isConnectionError(err) {
  const msg = String(err?.message ?? err);
  const name = String(err?.name ?? '');
  return (
    err?.name === 'ECONNREFUSED' ||
    err?.code === 'ECONNREFUSED' ||
    name === 'TimeoutError' ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('connect ECONNREFUSED') ||
    msg.includes('getaddrinfo') ||
    msg.includes('ECONNRESET') ||
    msg.includes('socket hang up') ||
    msg.includes('TimeoutError')
  );
}

async function retry(fn, { retries = 20, delayMs = 1000, label = 'operação' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (isConnectionError(err) && attempt < retries) {
        log(`${label}: conexão indisponível (tentativa ${attempt}/${retries}), aguardando...`);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function ensureTable(client, params, name) {
  await retry(
    async () => {
      try {
        await client.send(new CreateTableCommand(params));
        log(`tabela criada: ${name}`);
      } catch (err) {
        if (err instanceof ResourceInUseException || err.name === 'ResourceInUseException') {
          log(`tabela já existe: ${name}`);
        } else {
          throw err;
        }
      }
    },
    { label: `CreateTable(${name})` },
  );
  // Aguarda ACTIVE.
  for (let i = 0; i < 30; i += 1) {
    const desc = await client.send(new DescribeTableCommand({ TableName: name }));
    if (desc.Table?.TableStatus === 'ACTIVE') {
      log(`tabela ACTIVE: ${name}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  log(`aviso: tabela ${name} não ficou ACTIVE a tempo`);
}

async function main() {
  const ddb = new DynamoDBClient({
    region,
    ...(dynamodbEndpoint ? { endpoint: dynamodbEndpoint } : {}),
    ...(credentials ? { credentials } : {}),
  });

  await ensureTable(
    ddb,
    {
      TableName: tableName,
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
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
    },
    tableName,
  );

  await ensureTable(
    ddb,
    {
      TableName: checkpointTable,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
    },
    checkpointTable,
  );

  if (sqsEndpoint) {
    const sqs = new SQSClient({ region, endpoint: sqsEndpoint, ...(credentials ? { credentials } : {}) });
    for (const queue of queueNames) {
      try {
        const res = await retry(() => sqs.send(new CreateQueueCommand({ QueueName: queue })), {
          label: `CreateQueue(${queue})`,
        });
        log(`fila criada: ${queue} -> ${res.QueueUrl}`);
      } catch (err) {
        log(`aviso: falha ao criar fila ${queue}: ${err.message}`);
      }
    }
    sqs.destroy();
  } else {
    log('SQS_ENDPOINT não definido — pulando criação de filas SQS.');
  }

  ddb.destroy();
  log('done.');
}

main().catch((err) => {
  process.stderr.write(`[init-local] FATAL: ${err.stack ?? err}\n`);
  process.exit(1);
});
