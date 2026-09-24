import { DomainError } from '../../../domain/errors/DomainError';
import { ServicoIndisponivelError } from '../../../application/errors/InfraErrors';
import { InvalidEventError } from '../../../application/ports/EventSchemaValidator';
import { ProblemException } from './ProblemException';
import type { ProblemFieldError } from './ProblemException';

/** URIs canônicos dos tipos de problema (OpenAPI ProblemDetails). */
export const PROBLEM_BASE = 'https://api.whoo-internet.co/problems';
export const PROBLEM_TYPE = {
  limiteInsuficiente: `${PROBLEM_BASE}/limite-insuficiente`,
  conflitoEstado: `${PROBLEM_BASE}/conflito-estado`,
  validacao: `${PROBLEM_BASE}/validacao`,
  regraDominio: `${PROBLEM_BASE}/regra-dominio`,
  throttling: `${PROBLEM_BASE}/throttling`,
  indisponivel: `${PROBLEM_BASE}/indisponivel`,
  interno: `${PROBLEM_BASE}/erro-interno`,
} as const;

export type ProblemType = (typeof PROBLEM_TYPE)[keyof typeof PROBLEM_TYPE];

export const PROBLEM_TITLE: Record<ProblemType, string> = {
  [PROBLEM_TYPE.limiteInsuficiente]: 'Limite insuficiente',
  [PROBLEM_TYPE.conflitoEstado]: 'Conflito de estado',
  [PROBLEM_TYPE.validacao]: 'Requisição inválida',
  [PROBLEM_TYPE.regraDominio]: 'Regra de domínio violada',
  [PROBLEM_TYPE.throttling]: 'Limite de requisições excedido',
  [PROBLEM_TYPE.indisponivel]: 'Serviço indisponível',
  [PROBLEM_TYPE.interno]: 'Erro interno',
};

/**
 * Converte erros do domínio/aplicação em `ProblemException` (RFC 7807).
 *
 * Mapeamento de códigos de domínio → HTTP (alinha com OpenAPI):
 * - `LIMITE_INSUFICIENTE` → 402;
 * - `CONFLITO_CONCORRENCIA` / `CONFLITO_IDEMPOTENCIA` → 409;
 * - `CONTRATO_INEXISTENTE` → 409 (conflito-estado; OpenAPI não declara 404 —
 *   ver README/divergências);
 * - `COMANDO_INVALIDO` / `VALOR_INVALIDO` → 422 (validação);
 * - `ServicoIndisponivelError` → 503;
 * - `InvalidEventError` (violação de contrato do producer) → 500.
 */
export function mapErrorToProblem(error: unknown, instance?: string): ProblemException {
  if (error instanceof ProblemException) {
    return error;
  }
  if (error instanceof DomainError) {
    return mapDomainError(error, instance);
  }
  if (error instanceof ServicoIndisponivelError) {
    return new ProblemException({
      status: 503,
      type: PROBLEM_TYPE.indisponivel,
      title: PROBLEM_TITLE[PROBLEM_TYPE.indisponivel],
      detail: 'O serviço está temporariamente indisponível ou degradado. Tente novamente.',
      ...(instance !== undefined ? { instance } : {}),
      retryAfterSeconds: 60,
    });
  }
  if (error instanceof InvalidEventError) {
    return new ProblemException({
      status: 500,
      type: PROBLEM_TYPE.interno,
      title: PROBLEM_TITLE[PROBLEM_TYPE.interno],
      detail: 'O evento produzido viola o contrato oficial (falha interna de producer).',
      ...(instance !== undefined ? { instance } : {}),
    });
  }
  return new ProblemException({
    status: 500,
    type: PROBLEM_TYPE.interno,
    title: PROBLEM_TITLE[PROBLEM_TYPE.interno],
    detail: 'Erro interno inesperado.',
    ...(instance !== undefined ? { instance } : {}),
  });
}

function mapDomainError(error: DomainError, instance?: string): ProblemException {
  const withInstance = instance !== undefined ? { instance } : {};
  switch (error.code) {
    case 'LIMITE_INSUFICIENTE':
      return new ProblemException({
        status: 402,
        type: PROBLEM_TYPE.limiteInsuficiente,
        title: PROBLEM_TITLE[PROBLEM_TYPE.limiteInsuficiente],
        detail: 'O contrato não possui limite disponível para o valor solicitado.',
        ...withInstance,
      });
    case 'CONFLITO_CONCORRENCIA':
      return new ProblemException({
        status: 409,
        type: PROBLEM_TYPE.conflitoEstado,
        title: 'Conflito de concorrência',
        detail:
          'A operação conflitou com outra requisição em andamento para o mesmo contrato. Reenvie a requisição.',
        ...withInstance,
      });
    case 'CONFLITO_IDEMPOTENCIA':
      return new ProblemException({
        status: 409,
        type: PROBLEM_TYPE.conflitoEstado,
        title: PROBLEM_TITLE[PROBLEM_TYPE.conflitoEstado],
        detail: 'A chave de idempotência foi reutilizada com um payload diferente.',
        ...withInstance,
      });
    case 'CONTRATO_INEXISTENTE':
      return new ProblemException({
        status: 409,
        type: PROBLEM_TYPE.conflitoEstado,
        title: PROBLEM_TITLE[PROBLEM_TYPE.conflitoEstado],
        detail: 'O contrato informado não existe ou não permite autorização.',
        ...withInstance,
      });
    case 'COMANDO_INVALIDO':
    case 'VALOR_INVALIDO':
      return new ProblemException({
        status: 422,
        type: PROBLEM_TYPE.validacao,
        title: PROBLEM_TITLE[PROBLEM_TYPE.validacao],
        detail: error.message,
        ...withInstance,
      });
    default:
      return new ProblemException({
        status: 422,
        type: PROBLEM_TYPE.regraDominio,
        title: PROBLEM_TITLE[PROBLEM_TYPE.regraDominio],
        detail: error.message,
        ...withInstance,
      });
  }
}

/** Converte ValidationError[] (class-validator) em `errors[]` do Problem. */
export function flattenValidationErrors(
  errors: Array<{ property: string; constraints?: Record<string, string>; children?: unknown[] }>,
): ProblemFieldError[] {
  const flat: ProblemFieldError[] = [];
  for (const err of errors) {
    const constraints = err.constraints ?? {};
    const motivos = Object.values(constraints);
    if (motivos.length === 0) {
      flat.push({ campo: err.property, motivo: 'valor inválido' });
    }
    for (const motivo of motivos) {
      flat.push({ campo: err.property, motivo });
    }
  }
  return flat;
}
