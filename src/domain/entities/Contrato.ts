import { LimiteInsuficienteError } from '../errors/DomainError';

export interface ContratoProps {
  idContrato: string;
  availableLimit: number;
  totalLimit: number;
  moeda: string;
  ativo: boolean;
  updatedAt?: Date;
}

/**
 * Aggregate Contract/Limit (ADR-003).
 *
 * Invariantes:
 * - `availableLimit` nunca é negativo;
 * - apenas contratos ativos podem consumir limite;
 * - `podeReservar` reflete a regra `available_limit >= requested_amount`.
 */
export class Contrato {
  private props: ContratoProps;

  private constructor(props: ContratoProps) {
    this.props = props;
  }

  static create(props: ContratoProps): Contrato {
    if (!props.idContrato || props.idContrato.trim().length === 0) {
      throw new Error('idContrato é obrigatório');
    }
    if (!Number.isFinite(props.availableLimit) || props.availableLimit < 0) {
      throw new Error('availableLimit deve ser um número não-negativo');
    }
    if (!Number.isFinite(props.totalLimit) || props.totalLimit < 0) {
      throw new Error('totalLimit deve ser um número não-negativo');
    }
    if (!props.moeda || props.moeda.length !== 3) {
      throw new Error('moeda deve ter 3 caracteres (ISO 4217)');
    }
    return new Contrato(props);
  }

  get idContrato(): string {
    return this.props.idContrato;
  }

  get availableLimit(): number {
    return this.props.availableLimit;
  }

  get totalLimit(): number {
    return this.props.totalLimit;
  }

  get moeda(): string {
    return this.props.moeda;
  }

  get ativo(): boolean {
    return this.props.ativo;
  }

  get updatedAt(): Date | undefined {
    return this.props.updatedAt;
  }

  /** Regra `available_limit >= valor` aplicável apenas a contratos ativos. */
  podeReservar(valor: number): boolean {
    return this.ativo && this.availableLimit >= valor;
  }

  /** Novo saldo disponível após aplicar `delta` (negativo consome, positivo devolve). */
  saldoAposAplicacao(delta: number): number {
    return this.availableLimit + delta;
  }

  /** Aplica `delta` ao limite, garantindo que nunca fique negativo. */
  aplicarDelta(delta: number): void {
    const novo = this.availableLimit + delta;
    if (novo < 0) {
      throw new LimiteInsuficienteError(this.idContrato, -delta);
    }
    this.props.availableLimit = novo;
    this.props.updatedAt = new Date();
  }

  /** Marcador de tempo (usado em mappers/seed). */
  atualizarTimestamp(data: Date): void {
    this.props.updatedAt = data;
  }
}