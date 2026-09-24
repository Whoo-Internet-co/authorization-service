import type { Contrato } from '../../domain/entities/Contrato';
import { Contrato } from '../../domain/entities/Contrato';
import type { Autorizacao } from '../../domain/entities/Autorizacao';
import { TransacaoAutorizada } from '../../domain/events/TransacaoAutorizada';

/**
 * Modelagem DynamoDB — decisão documentada (ver README).
 *
 * **Single-table** (`authorization-service`) orientada a access patterns:
 *
 * | Access pattern                          | Query                                   |
 * | --------------------------------------- | --------------------------------------- |
 * | Contrato por id (leitura/consistente)   | PK=`CONTRACT#id` SK=`PROFILE#id`        |
 * | Reservar/creditar limite (transacional) | Update condicional no item do contrato  |
 * | Autorização por id                      | GSI `gsi-auth` (gsi1_pk = id_autorizacao) |
 * | Idempotência por chave                  | PK=`IDEMPOTENCY#chave` SK=igual         |
 * | Outbox (relay via DynamoDB Streams)     | PK=`OUTBOX#event_id` SK=igual           |
 *
 * Partition keys distribuem por entidade de negócio (`id_contrato`,
 * `idempotency_key`, `event_id`), evitando hot partitions — o trade-off de um
 * contrato individual extremamente ativo é documentado no README.
 *
 * TTL: atributo `ttl` (epoch seconds) nos itens de idempotência (ADR-004).
 * Streams: StreamViewType=NEW_IMAGE na tabela principal (ADR-006).
 */
export const TTL_ATTRIBUTE = 'ttl';
export const ENTITY_ATTRIBUTE = 'entity';
export const ENTITY_CONTRATO = 'CONTRATO';
export const ENTITY_AUTORIZACAO = 'AUTORIZACAO';
export const ENTITY_IDEMPOTENCIA = 'IDEMPOTENCIA';
export const ENTITY_OUTBOX = 'OUTBOX';

export const contractKey = (idContrato: string): Record<string, string> => ({
  PK: `CONTRACT#${idContrato}`,
  SK: `PROFILE#${idContrato}`,
});

export const authorizationKey = (idContrato: string, idAutorizacao: string): Record<string, string> => ({
  PK: `CONTRACT#${idContrato}`,
  SK: `AUTH#${idAutorizacao}`,
});

export const idempotencyKey = (chave: string): Record<string, string> => ({
  PK: `IDEMPOTENCY#${chave}`,
  SK: `IDEMPOTENCY#${chave}`,
});

export const outboxKey = (eventId: string): Record<string, string> => ({
  PK: `OUTBOX#${eventId}`,
  SK: `OUTBOX#${eventId}`,
});

// ---------- Builders (escrevem/leem via lib-dynamodb, valores já JS) ----------

export function buildContractItem(contrato: Contrato): Record<string, unknown> {
  return {
    ...contractKey(contrato.idContrato),
    [ENTITY_ATTRIBUTE]: ENTITY_CONTRATO,
    id_contrato: contrato.idContrato,
    available_limit: contrato.availableLimit,
    total_limit: contrato.totalLimit,
    moeda: contrato.moeda,
    ativo: contrato.ativo,
    updated_at: contrato.updatedAt?.toISOString(),
  };
}

export function buildAuthorizationItem(autorizacao: Autorizacao, requestHash: string): Record<string, unknown> {
  return {
    ...authorizationKey(autorizacao.idContrato, autorizacao.idAutorizacao),
    [ENTITY_ATTRIBUTE]: ENTITY_AUTORIZACAO,
    gsi1_pk: autorizacao.idAutorizacao,
    gsi1_sk: autorizacao.idAutorizacao,
    id_autorizacao: autorizacao.idAutorizacao,
    id_contrato: autorizacao.idContrato,
    id_conta: autorizacao.idConta,
    valor: autorizacao.valor,
    moeda: autorizacao.moeda,
    tipo_operacao: autorizacao.tipoOperacao.valor,
    status: autorizacao.status,
    saldo_reservado: autorizacao.saldoReservado,
    occurred_at: autorizacao.occurredAt.toISOString(),
    request_hash: requestHash,
    ...(autorizacao.idEstabelecimento !== undefined
      ? { id_estabelecimento: autorizacao.idEstabelecimento }
      : {}),
    ...(autorizacao.metadata !== undefined ? { metadata: autorizacao.metadata } : {}),
    ...(autorizacao.correlationId !== undefined ? { correlation_id: autorizacao.correlationId } : {}),
  };
}

export interface IdempotencyItem {
  chave: string;
  requestHash: string;
  status: 'EM_ANDAMENTO' | 'CONCLUIDA';
  response?: string;
  ttl: number;
  now: Date;
}

export function buildIdempotencyItem(input: IdempotencyItem): Record<string, unknown> {
  return {
    ...idempotencyKey(input.chave),
    [ENTITY_ATTRIBUTE]: ENTITY_IDEMPOTENCIA,
    idempotency_key: input.chave,
    request_hash: input.requestHash,
    status: input.status,
    created_at: input.now.toISOString(),
    ttl: input.ttl,
    ...(input.response !== undefined ? { response: input.response } : {}),
  };
}

export function buildOutboxItem(evento: TransacaoAutorizada): Record<string, unknown> {
  const json = evento.toJson();
  return {
    ...outboxKey(evento.eventId),
    [ENTITY_ATTRIBUTE]: ENTITY_OUTBOX,
    event_id: json.event_id,
    event_type: json.event_type,
    event_version: json.event_version,
    occurred_at: json.occurred_at,
    id_autorizacao: json.id_autorizacao,
    id_contrato: json.id_contrato,
    valor: json.valor,
    saldo_reservado: json.saldo_reservado,
    correlation_id: json.correlation_id,
    trace_id: json.trace_id,
  };
}

// ---------- Parsers (itens já deserializados pelo lib-dynamodb) ----------

export function parseContractItem(item: Record<string, unknown> | undefined): Contrato | null {
  if (item === undefined || item[ENTITY_ATTRIBUTE] !== ENTITY_CONTRATO) {
    return null;
  }
  return Contrato.create({
    idContrato: String(item.id_contrato),
    availableLimit: Number(item.available_limit ?? 0),
    totalLimit: Number(item.total_limit ?? 0),
    moeda: String(item.moeda),
    ativo: item.ativo === true,
    ...(item.updated_at !== undefined ? { updatedAt: new Date(String(item.updated_at)) } : {}),
  });
}

export function parseOutboxEventItem(item: Record<string, unknown>): TransacaoAutorizada | null {
  if (item === undefined || item[ENTITY_ATTRIBUTE] !== ENTITY_OUTBOX) {
    return null;
  }
  return TransacaoAutorizada.fromOutboxItem(item);
}