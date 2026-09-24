import type { TransacaoAutorizada } from '../../domain/events/TransacaoAutorizada';

/**
 * Porta de registro de eventos na Outbox (ADR-006).
 *
 * Em produção o append acontece DENTRO da mesma `TransactWriteItems` da
 * autorização (sem dual write). O adapter `DynamoDbOutboxRepository` expõe
 * `append` para cenários fora do caminho crítico (demo local/testes);
 * o adapter transacional (`DynamoDbLimitRepository.applyAuthorization`)
 * reutiliza o mesmo item mapper.
 */
export interface OutboxRepository {
  append(event: TransacaoAutorizada): Promise<void>;
}