import type { Autorizacao } from '../../domain/entities/Autorizacao';
import type { Contrato } from '../../domain/entities/Contrato';
import type { TransacaoAutorizada } from '../../domain/events/TransacaoAutorizada';
import type { TipoOperacao } from '../../domain/value-objects/TipoOperacao';
import type { IdempotencyResponse } from './IdempotencyRepository';

export interface ApplyAuthorizationInput {
  idContrato: string;
  /** Delta com sinal aplicado ao available_limit (negativo consome, positivo devolve). */
  delta: number;
  tipoOperacao: TipoOperacao;
  autorizacao: Autorizacao;
  idempotencia: {
    chave: string;
    requestHash: string;
    response: IdempotencyResponse;
    ttlSeconds: number;
    now: Date;
  };
  outboxEvent: TransacaoAutorizada;
}

/**
 * Porta de persistência do aggregate Contract/Limit (ADR-003).
 *
 * `applyAuthorization` é o ponto único de escrita atômica: em uma
 * `TransactWriteItems` o adapter persistirá (a) o update condicional do
 * limite, (b) a Authorization, (c) a conclusão da idempotência e
 * (d) o evento de Outbox (ADR-006).
 */
export interface LimitRepository {
  findById(idContrato: string): Promise<Contrato | null>;
  applyAuthorization(input: ApplyAuthorizationInput): Promise<void>;
}