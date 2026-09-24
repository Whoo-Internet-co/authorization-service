export interface EventSchemaValidationResult {
  valid: boolean;
  errors: string[];
}

/** Erro lançado quando um evento viola o contrato oficial. */
export class InvalidEventError extends Error {
  constructor(readonly errors: string[]) {
    super(`Evento inválido contra o contrato: ${errors.join('; ')}`);
    this.name = 'InvalidEventError';
  }
}

/**
 * Porta de validação de eventos contra o contrato oficial
 * (producer contract testing, ADR-008).
 */
export interface EventSchemaValidator {
  validate(payload: unknown): EventSchemaValidationResult;
  /** Lança `InvalidEventError` quando o payload viola o contrato. */
  assertValid(payload: unknown): void;
}