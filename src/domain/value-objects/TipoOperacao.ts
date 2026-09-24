export const TIPOS_OPERACAO = ['DEBITO', 'CREDITO', 'RESERVA', 'ESTORNO'] as const;
export type TipoOperacaoValor = (typeof TIPOS_OPERACAO)[number];

/**
 * Value Object do tipo de operação de uma autorização.
 *
 * Regra de negócio central (modelada no domínio):
 * - `RESERVA` e `DEBITO` **consomem** o limite disponível;
 * - `CREDITO` e `ESTORNO` **devolvem** limite ao contrato.
 */
export class TipoOperacao {
  private constructor(readonly valor: TipoOperacaoValor) {}

  static readonly DEBITO = new TipoOperacao('DEBITO');
  static readonly CREDITO = new TipoOperacao('CREDITO');
  static readonly RESERVA = new TipoOperacao('RESERVA');
  static readonly ESTORNO = new TipoOperacao('ESTORNO');

  static fromString(valor: string): TipoOperacao | null {
    switch (valor) {
      case 'DEBITO':
        return TipoOperacao.DEBITO;
      case 'CREDITO':
        return TipoOperacao.CREDITO;
      case 'RESERVA':
        return TipoOperacao.RESERVA;
      case 'ESTORNO':
        return TipoOperacao.ESTORNO;
      default:
        return null;
    }
  }

  /** Operações que consomem limite disponível. */
  get consomeLimite(): boolean {
    return this.valor === 'DEBITO' || this.valor === 'RESERVA';
  }

  /**
   * Sinal aplicado ao `available_limit`: `-1` consome (RESERVA/DEBITO),
   * `+1` devolve (CREDITO/ESTORNO).
   */
  get sinal(): -1 | 1 {
    return this.consomeLimite ? -1 : 1;
  }
}