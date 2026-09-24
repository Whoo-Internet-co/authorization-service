import { PutItemCommand } from '@aws-sdk/lib-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { TransacaoAutorizada } from '../../../domain/events/TransacaoAutorizada';
import type { OutboxRepository } from '../../../application/ports/OutboxRepository';
import { buildOutboxItem, outboxKey } from './DynamoDbTable';

/**
 * Append standalone de evento na Outbox (ADR-006).
 *
 * **Importante:** no caminho crítico de autorização o evento é persistido
 * DENTRO da `TransactWriteItems` (via `DynamoDbLimitRepository
 * .applyAuthorization`) — este adapter existe para cenários fora do caminho
 * crítico (demo local, testes, ferramentas).
 */
export class DynamoDbOutboxRepository implements OutboxRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async append(event: TransacaoAutorizada): Promise<void> {
    await this.doc.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: buildOutboxItem(event),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }
}

export { outboxKey };