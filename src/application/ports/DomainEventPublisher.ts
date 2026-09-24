import type { TransacaoAutorizada } from '../../domain/events/TransacaoAutorizada';

/**
 * Porta de publicação de eventos de domínio. Usada pelo Outbox Relay
 * (ADR-006) e implementada por EventBridge (produção) ou fan-out local
 * para N filas SQS (ambiente local — LocalStack community não possui
 * EventBridge).
 *
 * `event_id` é preservado: retries republicam o MESMO evento.
 */
export interface DomainEventPublisher {
  publish(event: TransacaoAutorizada): Promise<void>;
}