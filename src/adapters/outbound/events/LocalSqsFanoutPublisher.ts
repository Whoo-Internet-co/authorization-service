import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type { TransacaoAutorizada } from '../../../domain/events/TransacaoAutorizada';
import { TRANSACAO_AUTORIZADA_EVENT_TYPE } from '../../../domain/events/TransacaoAutorizada';
import type { DomainEventPublisher } from '../../../application/ports/DomainEventPublisher';
import type { Logger } from '../../../application/ports/Logger';
import { DEFAULT_EVENT_SOURCE } from './EventBridgePublisher';

export interface LocalSqsFanoutPublisherOptions {
  client: SQSClient;
  /** URLs das filas (fan-out). Uma mensagem por fila. */
  queueUrls: string[];
  source?: string;
  logger: Logger;
}

/**
 * Publisher local equivalente (ADR-006 autoriza adapter equivalente sem a
 * infra AWS completa). Faz fan-out do evento para N filas SQS locais
 * (LOCAL_FANOUT_QUEUE_URLS), reproduzindo o envelope EventBridge→SQS:
 *
 * ```json
 * { "id", "detail-type", "source", "time", "detail": {payload} }
 * ```
 *
 * Os consumers (Fraud/Accounting/Notification) usam o mesmo parser de
 * `detail`, então o contrato local é idêntico ao de produção. O `event_id`
 * dentro de `detail` é preservado para deduplicação (ADR-007).
 */
export class LocalSqsFanoutPublisher implements DomainEventPublisher {
  private readonly client: SQSClient;
  private readonly queueUrls: string[];
  private readonly source: string;
  private readonly logger: Logger;

  constructor(options: LocalSqsFanoutPublisherOptions) {
    this.client = options.client;
    this.queueUrls = options.queueUrls;
    this.source = options.source ?? DEFAULT_EVENT_SOURCE;
    this.logger = options.logger;
  }

  async publish(event: TransacaoAutorizada): Promise<void> {
    const envelope = {
      version: '0',
      id: event.eventId,
      'detail-type': TRANSACAO_AUTORIZADA_EVENT_TYPE,
      source: this.source,
      time: event.occurredAt.toISOString(),
      detail: event.toJson(),
    };
    const body = JSON.stringify(envelope);

    for (const queueUrl of this.queueUrls) {
      await this.client.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }));
      this.logger.info('Evento publicado em fila SQS local', {
        event_id: event.eventId,
        queue_url: queueUrl,
      });
    }
  }
}

/** Interpreta LOCAL_FANOUT_QUEUE_URLS / LOCAL_SQS_QUEUE_URLS (vírgula-separado). */
export function parseFanoutQueueUrls(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  return raw
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}
