/**
 * Erro base do domínio. Todos os erros de domínio estendem esta classe,
 * permitindo mapeamento determinístico para Problem Details (RFC 7807)
 * sem acoplar o domínio ao framework HTTP.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Valor de comando inválido (payload que viola invariantes de domínio). */
export class InvalidCommandError extends DomainError {
  readonly code = 'COMANDO_INVALIDO';
}

/** Valor monetário inválido (não finito, zero ou negativo). */
export class ValorInvalidoError extends DomainError {
  readonly code = 'VALOR_INVALIDO';

  constructor(valor: unknown) {
    super(`Valor monetário inválido: ${String(valor)}`);
  }
}

/** O contrato não possui limite disponível suficiente para a operação. */
export class LimiteInsuficienteError extends DomainError {
  readonly code = 'LIMITE_INSUFICIENTE';

  constructor(idContrato: string, valor: number) {
    super(`Contrato ${idContrato} não possui limite disponível para ${valor}.`);
  }
}

/** Conflito de concorrência ao aplicar a autorização (reserva concorrente). */
export class ConflitoConcorrenciaError extends DomainError {
  readonly code = 'CONFLITO_CONCORRENCIA';

  constructor(message = 'Conflito de concorrência ao aplicar a autorização.') {
    super(message);
  }
}

/** Conflito de idempotência: mesma chave com request_hash diferente. */
export class IdempotencyConflictError extends DomainError {
  readonly code = 'CONFLITO_IDEMPOTENCIA';

  constructor(chave: string) {
    super(`A chave de idempotência ${chave} foi reutilizada com payload diferente.`);
  }
}

/** Contrato não encontrado. */
export class ContratoInexistenteError extends DomainError {
  readonly code = 'CONTRATO_INEXISTENTE';

  constructor(idContrato: string) {
    super(`Contrato ${idContrato} não encontrado.`);
  }
}