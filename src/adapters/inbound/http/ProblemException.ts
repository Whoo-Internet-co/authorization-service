/**
 * Exceção HTTP orientada a RFC 7807 (Problem Details). Carrega todos os
 * campos do corpo `application/problem+json` para serialização determinística
 * pelo filtro global. Mantém a borda HTTP explícita sem vazar para o domínio.
 */
export interface ProblemFieldError {
  campo: string;
  motivo: string;
}

export interface ProblemExceptionInput {
  status: number;
  type: string;
  title: string;
  detail: string;
  instance?: string;
  errors?: ProblemFieldError[];
  retryAfterSeconds?: number;
}

export class ProblemException extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail: string;
  readonly instance?: string;
  readonly errors?: ProblemFieldError[];
  readonly retryAfterSeconds?: number;

  constructor(input: ProblemExceptionInput) {
    super(input.detail);
    this.name = 'ProblemException';
    this.status = input.status;
    this.type = input.type;
    this.title = input.title;
    this.detail = input.detail;
    if (input.instance !== undefined) {
      this.instance = input.instance;
    }
    if (input.errors !== undefined) {
      this.errors = input.errors;
    }
    if (input.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = input.retryAfterSeconds;
    }
  }

  /** Corpo RFC 7807 (+ extensão `correlation_id`). */
  toBody(correlationId: string): Record<string, unknown> {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      ...(this.instance !== undefined ? { instance: this.instance } : {}),
      correlation_id: correlationId,
      ...(this.errors !== undefined ? { errors: this.errors } : {}),
    };
  }
}
