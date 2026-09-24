import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { ValidateFunction } from 'ajv/dist/2020';
import type {
  EventSchemaValidationResult,
  EventSchemaValidator,
} from '../../../application/ports/EventSchemaValidator';
import { InvalidEventError } from '../../../application/ports/EventSchemaValidator';

const SCHEMA_EXPORT =
  '@whoo-internet-co/finance-platform-contracts/events/transacao-autorizada/v1/schema';

/**
 * Resolve o caminho do schema oficial distribuído pelo package
 * `@whoo-internet-co/finance-platform-contracts` (ADR-008 — source of truth).
 * Usa `require.resolve` para respeitar o mapa de `exports` do package.
 */
export function resolveOfficialSchemaPath(): string {
  const req = createRequire(module.filename);
  return req.resolve(SCHEMA_EXPORT);
}

export interface JsonSchemaEventValidatorOptions {
  /** Override do caminho do schema (ex.: CONTRACTS_SCHEMA_PATH). Vazio → package oficial. */
  schemaPath?: string;
  /** Conteúdo do schema já carregado (testes). */
  schema?: Record<string, unknown>;
}

/**
 * Carrega o schema: usa `schemaPath` quando informado E existente
 * (override compatível com deploys legados); caso contrário resolve o
 * schema oficial do package de contratos (ADR-008 — source of truth).
 */
function loadSchema(schemaPath?: string): Record<string, unknown> {
  const path =
    schemaPath !== undefined && schemaPath !== '' && existsSync(schemaPath)
      ? schemaPath
      : resolveOfficialSchemaPath();
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/**
 * Adapter de validação de eventos contra o contrato oficial usando
 * Ajv (JSON Schema draft 2020-12) + ajv-formats (`uuid`, `date-time`).
 *
 * Producer contract testing (ADR-008): o payload produzido pelo serviço
 * DEVE validar contra o `schema.json` do package de contratos — o mesmo
 * artefato consumido por Accounting/Fraud/Notification.
 */
export class JsonSchemaEventValidator implements EventSchemaValidator {
  private readonly validateFn: ValidateFunction;

  constructor(options: JsonSchemaEventValidatorOptions = {}) {
    const schema = options.schema ?? loadSchema(options.schemaPath);
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    this.validateFn = ajv.compile(schema);
  }

  validate(payload: unknown): EventSchemaValidationResult {
    const valid = this.validateFn(payload);
    if (valid === true) {
      return { valid: true, errors: [] };
    }
    const errors = (this.validateFn.errors ?? []).map(
      (e) => `${e.instancePath === '' ? '/' : e.instancePath} ${e.message ?? 'inválido'}`,
    );
    return { valid: false, errors };
  }

  assertValid(payload: unknown): void {
    const result = this.validate(payload);
    if (!result.valid) {
      throw new InvalidEventError(result.errors);
    }
  }
}
