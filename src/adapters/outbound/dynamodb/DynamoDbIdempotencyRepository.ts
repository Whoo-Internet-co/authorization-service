import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type {
  AcquireIdempotencyResult,
  IdempotencyRepository,
  IdempotencyResponse,
} from '../../../application/ports/IdempotencyRepository';
import {
  buildIdempotencyItem,
  idempotencyKey,
  TTL_ATTRIBUTE,
  ENTITY_IDEMPOTENCIA,
} from './DynamoDbTable';

interface StoredIdempotency {
  requestHash: string;
  status: string;
  response?: string;
}

function parseIdempotencyItem(item: Record<string, unknown> | undefined): StoredIdempotency | null {
  if (item === undefined || item[ENTITY_IDEMPOTENCIA] !== ENTITY_IDEMPOTENCIA) {
    return null;
  }
  return {
    requestHash: String(item.request_hash ?? ''),
    status: String(item.status ?? 'EM_ANDAMENTO'),
    ...(item.response !== undefined ? { response: String(item.response) } : {}),
  };
}

/**
 * Adapter DynamoDB de idempotência (ADR-004).
 *
 * `acquire` é um **conditional put** (`attribute_not_exists(PK)`): garante
 * exclusividade atômica da chave mesmo sob concorrência. O vencedor obtém
 * `ADQUIRIDA`; o perdedor lê o registro e decide entre `REPLAY`
 * (mesmo request_hash + resultado persistido) ou `CONFLITO`.
 *
 * TTL expira a chave após o período configurado.
 */
export class DynamoDbIdempotencyRepository implements IdempotencyRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async acquire(
    chave: string,
    requestHash: string,
    ttlSeconds: number,
    now: Date,
  ): Promise<AcquireIdempotencyResult> {
    const ttlEpoch = Math.floor(now.getTime() / 1000) + ttlSeconds;
    try {
      await this.doc.send(
        new PutCommand({
          TableName: this.tableName,
          Item: buildIdempotencyItem({ chave, requestHash, status: 'EM_ANDAMENTO', ttl: ttlEpoch, now }),
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return { kind: 'ADQUIRIDA' };
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        const existing = await this.read(chave);
        if (existing === null) {
          return { kind: 'CONFLITO' };
        }
        if (existing.requestHash === requestHash && existing.response !== undefined) {
          return { kind: 'REPLAY', response: this.parseResponse(existing.response) };
        }
        return { kind: 'CONFLITO' };
      }
      throw error;
    }
  }

  async completeFailure(
    chave: string,
    requestHash: string,
    response: IdempotencyResponse,
    ttlSeconds: number,
    now: Date,
  ): Promise<void> {
    const ttlEpoch = Math.floor(now.getTime() / 1000) + ttlSeconds;
    try {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: idempotencyKey(chave),
          UpdateExpression:
            'SET #st = :concluida, response = :response, completed_at = :ts, #ttl = :ttl',
          ConditionExpression:
            'attribute_exists(PK) AND request_hash = :hash AND attribute_not_exists(response)',
          ExpressionAttributeNames: { '#st': 'status', '#ttl': TTL_ATTRIBUTE },
          ExpressionAttributeValues: {
            ':concluida': 'CONCLUIDA',
            ':response': JSON.stringify(response),
            ':hash': requestHash,
            ':ttl': ttlEpoch,
            ':ts': now.toISOString(),
          },
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        // Chave já concluída (escrita concorrente venceu) — nada a fazer.
        return;
      }
      throw error;
    }
  }

  private async read(chave: string): Promise<StoredIdempotency | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: idempotencyKey(chave),
        ConsistentRead: true,
      }),
    );
    return parseIdempotencyItem(result.Item);
  }

  private parseResponse(raw: string): IdempotencyResponse {
    try {
      return JSON.parse(raw) as IdempotencyResponse;
    } catch {
      return {
        id_autorizacao: '',
        id_contrato: '',
        status: 'RECUSADA',
        valor: 0,
        saldo_reservado: 0,
        occurred_at: '',
        motivo: 'resultado_idempotencia_invalido',
      };
    }
  }
}