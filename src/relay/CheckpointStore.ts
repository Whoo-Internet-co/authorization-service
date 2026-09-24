import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

/**
 * Porta de checkpoint do relay (posição de leitura por shard do DynamoDB
 * Streams). Persistir o último `SequenceNumber` processado permite retomar
 * após restart sem reprocessar o stream inteiro (at-least-once preservado —
 * duplicatas são toleradas pelos consumers via `event_id`, ADR-007).
 */
export interface CheckpointStore {
  load(shardId: string): Promise<string | null>;
  save(shardId: string, sequenceNumber: string): Promise<void>;
}

/** Checkpoint em memória (testes / execução efêmera). */
export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly store = new Map<string, string>();

  async load(shardId: string): Promise<string | null> {
    return this.store.get(shardId) ?? null;
  }

  async save(shardId: string, sequenceNumber: string): Promise<void> {
    this.store.set(shardId, sequenceNumber);
  }
}

/**
 * Checkpoint persistido em DynamoDB (tabela `authorization-service-checkpoint`,
 * PK=`SHARD#<shardId>` SK=`CHECKPOINT`). Escrita idempotente por shard.
 */
export class DynamoDbCheckpointStore implements CheckpointStore {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  private key(shardId: string): Record<string, string> {
    return { PK: `SHARD#${shardId}`, SK: 'CHECKPOINT' };
  }

  async load(shardId: string): Promise<string | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: this.key(shardId),
        ConsistentRead: true,
      }),
    );
    const seq = result.Item?.last_sequence_number;
    return typeof seq === 'string' && seq !== '' ? seq : null;
  }

  async save(shardId: string, sequenceNumber: string): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          ...this.key(shardId),
          shard_id: shardId,
          last_sequence_number: sequenceNumber,
          updated_at: new Date().toISOString(),
        },
      }),
    );
  }
}
