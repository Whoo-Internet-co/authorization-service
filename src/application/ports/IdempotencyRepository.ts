import type { AutorizacaoResponse } from '../../domain/entities/Autorizacao';

/** Resposta persistida da idempotência (replay retorna o resultado original). */
export type IdempotencyResponse = AutorizacaoResponse & { motivo?: string };

export type AcquireIdempotencyResult =
  | { kind: 'ADQUIRIDA' }
  | { kind: 'REPLAY'; response: IdempotencyResponse }
  | { kind: 'CONFLITO' };

/**
 * Porta de idempotência (ADR-004).
 *
 * `acquire` deve ser atômico (conditional write): garante que duas requisições
 * simultâneas com a mesma chave não executem o caso de uso duas vezes.
 */
export interface IdempotencyRepository {
  acquire(
    chave: string,
    requestHash: string,
    ttlSeconds: number,
    now: Date,
  ): Promise<AcquireIdempotencyResult>;
  /** Persiste a conclusão de uma recusa determinística (ex.: 402 limite insuficiente). */
  completeFailure(
    chave: string,
    requestHash: string,
    response: IdempotencyResponse,
    ttlSeconds: number,
    now: Date,
  ): Promise<void>;
}