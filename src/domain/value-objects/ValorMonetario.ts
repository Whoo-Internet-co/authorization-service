import { ValorInvalidoError } from '../errors/DomainError';

/**
 * Valor Monetário com invariantes de domínio: finito e estritamente positivo.
 *
 * A representação canônica é usada para gerar o `request_hash` da
 * idempotência (ADR-004) de forma determinística entre representações
 * equivalentes (ex.: `100`, `100.0`, `100.00`).
 */
export class ValorMonetario {
  private constructor(readonly amount: number) {}

  static create(valor: number): ValorMonetario {
    if (!Number.isFinite(valor) || valor <= 0) {
      throw new ValorInvalidoError(valor);
    }
    return new ValorMonetario(valor);
  }

  /** Representação decimal normalizada do valor (ex.: `100`, `100.5`, `0.25`). */
  toCanonicalString(): string {
    return canonicalNumberString(this.amount);
  }
}

/**
 * Normaliza um número para uma string decimal determinística, tratando
 * `100`, `100.0`, `100.00` como equivalentes.
 */
export function canonicalNumberString(value: number): string {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  let repr = rounded.toFixed(6);
  repr = repr.replace(/0+$/, '').replace(/\.$/, '');
  return repr === '-0' ? '0' : repr;
}