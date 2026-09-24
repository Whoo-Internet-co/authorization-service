import {
  DescribeStreamCommand,
  GetRecordsCommand,
  GetShardIteratorCommand,
  type Shard,
  type _Record as StreamRecord,
  type DynamoDBStreamsClient,
} from '@aws-sdk/client-dynamodb-streams';
import { DescribeTableCommand, type DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { DomainEventPublisher } from '../application/ports/DomainEventPublisher';
import type { Logger } from '../application/ports/Logger';
import { parseOutboxEventItem, ENTITY_ATTRIBUTE, ENTITY_OUTBOX } from '../adapters/outbound/dynamodb/DynamoDbTable';
import type { CheckpointStore } from './CheckpointStore';

export interface OutboxRelayDeps {
  streams: DynamoDBStreamsClient;
  /** Cliente DynamoDB (não-streams) usado para resolver o StreamArn via DescribeTable. */
  dynamo: DynamoDBClient;
  tableName: string;
  publisher: DomainEventPublisher;
  checkpoint: CheckpointStore;
  logger: Logger;
  pollIntervalMs: number;
  batchSize: number;
  /** Injetável para testes. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Outbox Relay (ADR-006): lê o DynamoDB Stream da tabela single-table,
 * filtra INSERTs de itens `entity=OUTBOX` e publica via DomainEventPublisher
 * preservando o `event_id` original (retries → mesmo evento → deduplicação
 * nos consumers, ADR-007).
 *
 * Checkpoint por shard (último SequenceNumber) em tabela dedicada:
 * - restart retoma de onde parou (sem replay completo do stream);
 * - falha de publicação NÃO avança o checkpoint → retry no próximo poll
 *   (at-least-once).
 */
export class OutboxRelay {
  private readonly deps: Required<Pick<OutboxRelayDeps, 'sleep'>> & OutboxRelayDeps;
  private readonly iterators = new Map<string, string>();
  private readonly closedShards = new Set<string>();
  private streamArn: string | undefined;
  private stopping = false;

  constructor(deps: OutboxRelayDeps) {
    this.deps = { ...deps, sleep: deps.sleep ?? defaultSleep };
  }

  async start(): Promise<void> {
    this.deps.logger.info('Outbox relay iniciado', {
      table: this.deps.tableName,
      poll_interval_ms: this.deps.pollIntervalMs,
    });
    while (!this.stopping) {
      try {
        await this.pollOnce();
      } catch (error) {
        this.deps.logger.error('Falha no ciclo do outbox relay (retry no próximo poll)', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (!this.stopping) {
        await this.deps.sleep(this.deps.pollIntervalMs);
      }
    }
    this.deps.logger.info('Outbox relay parado');
  }

  stop(): void {
    this.stopping = true;
  }

  /** Um ciclo completo de leitura/publicação. Retorna eventos publicados. */
  async pollOnce(): Promise<number> {
    const shards = await this.listShards();
    const leaves = this.computeLeafShards(shards);
    let published = 0;

    for (const shard of shards) {
      const shardId = shard.ShardId;
      if (shardId === undefined || this.closedShards.has(shardId)) {
        continue;
      }
      const isLeaf = leaves.has(shardId);
      const checkpoint = await this.deps.checkpoint.load(shardId);
      // Shard não-folha sem checkpoint já processado: filhos cobrem o fluxo.
      if (!isLeaf && checkpoint === null) {
        continue;
      }

      let iterator = this.iterators.get(shardId);
      if (iterator === undefined) {
        iterator = await this.openIterator(shardId, checkpoint);
        if (iterator === undefined) {
          this.closedShards.add(shardId);
          continue;
        }
      }

      try {
        const result = await this.deps.streams.send(
          new GetRecordsCommand({ ShardIterator: iterator, Limit: this.deps.batchSize }),
        );
        const records = result.Records ?? [];
        let lastSequence: string | undefined;
        for (const record of records) {
          lastSequence = record.dynamodb?.SequenceNumber ?? lastSequence;
          if (await this.handleRecord(record)) {
            published += 1;
          }
        }
        if (lastSequence !== undefined) {
          await this.deps.checkpoint.save(shardId, lastSequence);
        }
        if (result.NextShardIterator === undefined) {
          this.iterators.delete(shardId);
          this.closedShards.add(shardId);
        } else {
          this.iterators.set(shardId, result.NextShardIterator);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'ExpiredIteratorException') {
          this.iterators.delete(shardId); // reabre a partir do checkpoint no próximo ciclo
          continue;
        }
        throw error;
      }
    }
    return published;
  }

  private async handleRecord(record: StreamRecord): Promise<boolean> {
    if (record.eventName !== 'INSERT' || record.dynamodb?.NewImage === undefined) {
      return false;
    }
    const item = unmarshall(record.dynamodb.NewImage) as Record<string, unknown>;
    if (item[ENTITY_ATTRIBUTE] !== ENTITY_OUTBOX) {
      return false;
    }
    const event = parseOutboxEventItem(item);
    if (event === null) {
      this.deps.logger.warn('Item OUTBOX ilegível ignorado pelo relay', {
        event_id: String(item.event_id ?? ''),
      });
      return false;
    }
    await this.deps.publisher.publish(event);
    this.deps.logger.info('Evento da outbox publicado pelo relay', {
      event_id: event.eventId,
      id_autorizacao: event.idAutorizacao,
    });
    return true;
  }

  private async listShards(): Promise<Shard[]> {
    if (this.streamArn === undefined) {
      const table = await this.deps.dynamo.send(
        new DescribeTableCommand({ TableName: this.deps.tableName }),
      );
      const arn = table.Table?.LatestStreamArn;
      if (arn === undefined) {
        throw new Error(
          `Tabela ${this.deps.tableName} não possui DynamoDB Stream habilitado (LatestStreamArn ausente).`,
        );
      }
      this.streamArn = arn;
    }
    const shards: Shard[] = [];
    let startShardId: string | undefined;
    for (;;) {
      const described = await this.deps.streams.send(
        new DescribeStreamCommand({
          StreamArn: this.streamArn,
          Limit: 100,
          ...(startShardId !== undefined ? { ExclusiveStartShardId: startShardId } : {}),
        }),
      );
      shards.push(...(described.StreamDescription?.Shards ?? []));
      const next = described.StreamDescription?.LastEvaluatedShardId;
      if (next === undefined) {
        return shards;
      }
      startShardId = next;
    }
  }

  private computeLeafShards(shards: Shard[]): Set<string> {
    const parents = new Set(
      shards.map((s) => s.ParentShardId).filter((p): p is string => p !== undefined),
    );
    return new Set(
      shards
        .map((s) => s.ShardId)
        .filter((id): id is string => id !== undefined && !parents.has(id)),
    );
  }

  private async openIterator(
    shardId: string,
    checkpoint: string | null,
  ): Promise<string | undefined> {
    const result = await this.deps.streams.send(
      new GetShardIteratorCommand({
        StreamArn: this.streamArn,
        ShardId: shardId,
        ShardIteratorType: checkpoint === null ? 'TRIM_HORIZON' : 'AFTER_SEQUENCE_NUMBER',
        ...(checkpoint !== null ? { SequenceNumber: checkpoint } : {}),
      }),
    );
    return result.ShardIterator;
  }
}
