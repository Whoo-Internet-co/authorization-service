import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type {
  DynamoDBDocumentClient,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { Contrato } from '../../../domain/entities/Contrato';
import {
  ConflitoConcorrenciaError,
  IdempotencyConflictError,
  LimiteInsuficienteError,
} from '../../../domain/errors/DomainError';
import { ServicoIndisponivelError } from '../../../application/errors/InfraErrors';
import type { LimitRepository } from '../../../application/ports/LimitRepository';
import type { ApplyAuthorizationInput } from '../../../application/ports/LimitRepository';
import type { Logger } from '../../../application/ports/Logger';
import {
  buildAuthorizationItem,
  buildOutboxItem,
  contractKey,
  idempotencyKey,
  parseContractItem,
  TTL_ATTRIBUTE,
} from './DynamoDbTable';

type TransactWriteItem = NonNullable<TransactWriteCommandInput['TransactItems']>[number];

const CONDITIONAL_CHECK_FAILED = 'ConditionalCheckFailed';
const TRANSACTION_CONFLICT = 'TransactionConflictException';
const THROTTLING = ['ThrottlingException', 'ProvisionedThroughputExceededException'];

/**
 * Adapter DynamoDB do aggregate Contrato/Limite (ADR-003).
 *
 * `applyAuthorization` executa UMA `TransactWriteItems` contendo:
 *   1. update condicional do limite (`available_limit >= valor` p/ consumo);
 *   2. create da Authorization;
 *   3. conclusão da idempotência (status + response);
 *   4. create do evento de Outbox (ADR-006).
 *
 * A atomicidade garante que nunca existirá autorização sem reserva,
 * idempotência sem resultado, ou evento sem estado persistido.
 */
export class DynamoDbLimitRepository implements LimitRepository {
  constructor(
    private readonly doc: DynamoDBDocumentClient,
    private readonly tableName: string,
    private readonly logger: Logger,
  ) {}

  async findById(idContrato: string): Promise<Contrato | null> {
    const result = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: contractKey(idContrato),
        ConsistentRead: true,
      }),
    );
    return parseContractItem(result.Item);
  }

  async applyAuthorization(input: ApplyAuthorizationInput): Promise<void> {
    const nowIso = input.idempotencia.now.toISOString();
    const valor = input.autorizacao.valor;
    const consome = input.tipoOperacao.consomeLimite;

    const contractUpdate: TransactWriteItem = {
      Update: {
        TableName: this.tableName,
        Key: contractKey(input.idContrato),
        UpdateExpression: 'SET available_limit = available_limit + :delta, updated_at = :ts',
        ConditionExpression: consome
          ? 'attribute_exists(PK) AND available_limit >= :valor'
          : 'attribute_exists(PK)',
        ExpressionAttributeValues: {
          ':delta': input.delta,
          ':valor': valor,
          ':ts': nowIso,
        },
      },
    };

    const authorizationPut: TransactWriteItem = {
      Put: {
        TableName: this.tableName,
        Item: buildAuthorizationItem(input.autorizacao, input.idempotencia.requestHash),
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    };

    const ttlEpoch = Math.floor(input.idempotencia.now.getTime() / 1000) + input.idempotencia.ttlSeconds;
    const idempotencyComplete: TransactWriteItem = {
      Update: {
        TableName: this.tableName,
        Key: idempotencyKey(input.idempotencia.chave),
        UpdateExpression:
          'SET #st = :concluida, response = :response, completed_at = :ts, #ttl = :ttl',
        ConditionExpression:
          'attribute_exists(PK) AND request_hash = :hash AND attribute_not_exists(response)',
        ExpressionAttributeNames: { '#st': 'status', '#ttl': TTL_ATTRIBUTE },
        ExpressionAttributeValues: {
          ':concluida': 'CONCLUIDA',
          ':response': JSON.stringify(input.idempotencia.response),
          ':hash': input.idempotencia.requestHash,
          ':ttl': ttlEpoch,
          ':ts': nowIso,
        },
      },
    };

    const outboxPut: TransactWriteItem = {
      Put: {
        TableName: this.tableName,
        Item: buildOutboxItem(input.outboxEvent),
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    };

    try {
      await this.doc.send(
        new TransactWriteCommand({
          TransactItems: [
            contractUpdate,
            authorizationPut,
            idempotencyComplete,
            outboxPut,
          ],
        }),
      );
    } catch (error) {
      this.mapTransactionError(error, input);
    }
  }

  private mapTransactionError(error: unknown, input: ApplyAuthorizationInput): never {
    if (error instanceof Error) {
      const reasons = (error as { CancellationReasons?: Array<{ Code?: string }> }).CancellationReasons;
      if (reasons !== undefined) {
        const contractReason = reasons[0]?.Code;
        const idempotencyReason = reasons[2]?.Code;
        if (contractReason === CONDITIONAL_CHECK_FAILED) {
          throw new LimiteInsuficienteError(input.idContrato, input.autorizacao.valor);
        }
        if (idempotencyReason === CONDITIONAL_CHECK_FAILED) {
          throw new IdempotencyConflictError(input.idempotencia.chave);
        }
        throw new ConflitoConcorrenciaError(
          `Transação cancelada (reasons: ${reasons.map((r) => r.Code ?? '?').join(',')})`,
        );
      }
      if (error.name === TRANSACTION_CONFLICT) {
        throw new ConflitoConcorrenciaError('Conflito de transação ao reservar limite.');
      }
      if (THROTTLING.includes(error.name)) {
        throw new ServicoIndisponivelError(`DynamoDB throttling: ${error.message}`);
      }
    }
    this.logger.error('Falha desconhecida no TransactWriteItems', {
      error: error instanceof Error ? error.message : String(error),
      id_contrato: input.idContrato,
      id_autorizacao: input.autorizacao.idAutorizacao,
    });
    throw error;
  }
}