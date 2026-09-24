import { PutEventsCommand } from '@aws-sdk/client-eventbridge';
import type { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import type { TransacaoAutorizada } from '../../../domain/events/TransacaoAutorizada';
import { TRANSACAO_AUTORIZADA_EVENT_TYPE } from '../../../domain/events/TransacaoAutorizada';
import type { DomainEventPublisher } from '../../../application/ports/DomainEventPublisher';
import type { Logger } from '../../../application/ports/Logger';

/**
 * Source padrão do envelope CloudEvents (docs/cloudevents-mapping.md).
 * Sobrescrevível via EVENT_SOURCE (o meta-repo injeta
 * `co.whoo-internet.finance.authorization` — ver README/divergências).
 */
export const DEFAULT_EVENT_SOURCE = '/finance/authorization-service';

export interface EventBridgePublisherOptions {
  client: EventBridgeClient;
  eventBusName: string;
  source?: string;
  logger: Logger;
}

/**
 * Publisher de produção (ADR-006): aplica o mapeamento CloudEvents→EventBridge
 * (docs/cloudevents-mapping.md do package de contratos):
 *
 * | EventBridge    | origem                          |
 * | -------------- | ------------------------------- |
 * | `Source`       | constante do serviço            |
 * | `DetailType`   | `event_type` (TransacaoAutorizada) |
 * | `Time`         | `occurred_at`                   |
 * | `Detail`       | payload de negócio (schema.json) |
 *
 * O `event_id` viaja dentro do `Detail` (payload flat v1) e é preservado em
 * retries — chave de deduplicação dos consumidores (ADR-007).
 */
export class EventBridgePublisher implements DomainEventPublisher {
  private readonly client: EventBridgeClient;
  private readonly eventBusName: string;
  private readonly source: string;
  private readonly logger: Logger;

  constructor(options: EventBridgePublisherOptions) {
    this.client = options.client;
    this.eventBusName = options.eventBusName;
    this.source = options.source ?? DEFAULT_EVENT_SOURCE;
    this.logger = options.logger;
  }

  async publish(event: TransacaoAutorizada): Promise<void> {
    const detail = event.toJson();
    const result = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.eventBusName,
            Source: this.source,
            DetailType: TRANSACAO_AUTORIZADA_EVENT_TYPE,
            Time: event.occurredAt,
            Detail: JSON.stringify(detail),
          },
        ],
      }),
    );
    if (result.FailedEntryCount !== undefined && result.FailedEntryCount > 0) {
      const entry = result.Entries?.[0];
      throw new Error(
        `EventBridge PutEvents falhou (FailedEntryCount=${result.FailedEntryCount}): ${
          entry?.ErrorMessage ?? 'unknown'
        }`,
      );
    }
    this.logger.info('Evento publicado no EventBridge', {
      event_id: event.eventId,
      detail_type: TRANSACAO_AUTORIZADA_EVENT_TYPE,
      source: this.source,
    });
  }
}
