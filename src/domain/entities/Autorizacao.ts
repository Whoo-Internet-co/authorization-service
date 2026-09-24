import type { TipoOperacao } from '../value-objects/TipoOperacao';

export type StatusAutorizacao = 'APROVADA' | 'RECUSADA';

export interface AutorizacaoProps {
  idAutorizacao: string;
  idContrato: string;
  idConta: string;
  valor: number;
  moeda: string;
  tipoOperacao: TipoOperacao;
  status: StatusAutorizacao;
  saldoReservado: number;
  occurredAt: Date;
  idEstabelecimento?: string;
  metadata?: Record<string, unknown>;
  correlationId?: string;
}

/** Contrato de resposta da API (AutorizacaoResponse — OpenAPI). */
export interface AutorizacaoResponse {
  id_autorizacao: string;
  id_contrato: string;
  status: StatusAutorizacao;
  valor: number;
  saldo_reservado: number;
  occurred_at: string;
}

/**
 * Entity Autorização: resultado de uma autorização em um contrato.
 * Não possui comportamento mutável após a criação — é um registro imutável.
 */
export class Autorizacao {
  private constructor(readonly props: AutorizacaoProps) {}

  static aprovar(props: Omit<AutorizacaoProps, 'status'>): Autorizacao {
    if (!props.idAutorizacao || props.idAutorizacao.trim().length === 0) {
      throw new Error('idAutorizacao é obrigatório');
    }
    if (!props.idContrato || props.idContrato.trim().length === 0) {
      throw new Error('idContrato é obrigatório');
    }
    if (!props.idConta || props.idConta.trim().length === 0) {
      throw new Error('idConta é obrigatório');
    }
    if (!Number.isFinite(props.valor) || props.valor <= 0) {
      throw new Error('valor deve ser estritamente positivo');
    }
    if (!props.moeda || props.moeda.length !== 3) {
      throw new Error('moeda deve ter 3 caracteres (ISO 4217)');
    }
    return new Autorizacao({ ...props, status: 'APROVADA' });
  }

  static recusar(props: Omit<AutorizacaoProps, 'status' | 'saldoReservado'>): Autorizacao {
    return new Autorizacao({ ...props, status: 'RECUSADA', saldoReservado: 0 });
  }

  get idAutorizacao(): string {
    return this.props.idAutorizacao;
  }

  get idContrato(): string {
    return this.props.idContrato;
  }

  get idConta(): string {
    return this.props.idConta;
  }

  get valor(): number {
    return this.props.valor;
  }

  get moeda(): string {
    return this.props.moeda;
  }

  get tipoOperacao(): TipoOperacao {
    return this.props.tipoOperacao;
  }

  get status(): StatusAutorizacao {
    return this.props.status;
  }

  get saldoReservado(): number {
    return this.props.saldoReservado;
  }

  get occurredAt(): Date {
    return this.props.occurredAt;
  }

  get idEstabelecimento(): string | undefined {
    return this.props.idEstabelecimento;
  }

  get metadata(): Record<string, unknown> | undefined {
    return this.props.metadata;
  }

  get correlationId(): string | undefined {
    return this.props.correlationId;
  }

  /** Serialização pública compatível com o schema AutorizacaoResponse. */
  toResponse(): AutorizacaoResponse {
    return {
      id_autorizacao: this.props.idAutorizacao,
      id_contrato: this.props.idContrato,
      status: this.props.status,
      valor: this.props.valor,
      saldo_reservado: this.props.saldoReservado,
      occurred_at: this.props.occurredAt.toISOString(),
    };
  }
}