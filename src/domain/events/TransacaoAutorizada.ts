export const TRANSACAO_AUTORIZADA_EVENT_TYPE = 'TransacaoAutorizada';
export const TRANSACAO_AUTORIZADA_EVENT_VERSION = '1.0';

export interface TransacaoAutorizadaProps {
  eventId: string;
  occurredAt: Date;
  idAutorizacao: string;
  idContrato: string;
  valor: number;
  saldoReservado: number;
  correlationId: string;
  traceId?: string | null;
}

/**
 * Evento de domínio `TransacaoAutorizada` (contrato
 * `events/transacao-autorizada/v1/schema.json`).
 *
 * O payload flat já carrega os metadados equivalentes aos atributos
 * CloudEvents (ver README do contrato) — sem breaking change silencioso.
 */
export class TransacaoAutorizada {
  constructor(readonly props: TransacaoAutorizadaProps) {}

  get eventId(): string {
    return this.props.eventId;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }

  get idAutorizacao(): string {
    return this.props.idAutorizacao;
  }

  get idContrato(): string {
    return this.props.idContrato;
  }

  get saldoReservado(): number {
    return this.props.saldoReservado;
  }

  /** Serialização pública que deve validar contra o schema oficial. */
  toJson(): Record<string, unknown> {
    return {
      event_id: this.props.eventId,
      event_type: TRANSACAO_AUTORIZADA_EVENT_TYPE,
      event_version: TRANSACAO_AUTORIZADA_EVENT_VERSION,
      occurred_at: this.props.occurredAt.toISOString(),
      id_autorizacao: this.props.idAutorizacao,
      id_contrato: this.props.idContrato,
      valor: this.props.valor,
      saldo_reservado: this.props.saldoReservado,
      correlation_id: this.props.correlationId,
      trace_id: this.props.traceId ?? null,
    };
  }

  /** Reconstrói o evento a partir de um item da Outbox (DynamoDB Streams). */
  static fromOutboxItem(item: Record<string, unknown>): TransacaoAutorizada {
    return new TransacaoAutorizada({
      eventId: String(item.event_id ?? ''),
      occurredAt: new Date(String(item.occurred_at ?? '')),
      idAutorizacao: String(item.id_autorizacao ?? ''),
      idContrato: String(item.id_contrato ?? ''),
      valor: Number(item.valor ?? 0),
      saldoReservado: Number(item.saldo_reservado ?? 0),
      correlationId: String(item.correlation_id ?? ''),
      traceId: item.trace_id === null || item.trace_id === undefined ? null : String(item.trace_id),
    });
  }
}