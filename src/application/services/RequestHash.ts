import { createHash } from 'node:crypto';
import { canonicalNumberString } from '../../domain/value-objects/ValorMonetario';

/**
 * Campos semanticamente relevantes do comando para o request_hash (ADR-004).
 * Metadados não semânticos (correlation_id, trace_id, timestamps) ficam fora.
 */
export interface RequisicaoSemantica {
  idContrato: string;
  idConta: string;
  valor: number;
  moeda: string;
  tipoOperacao: string;
  idEstabelecimento?: string;
  metadata?: Record<string, unknown>;
}

/** Normaliza recursivamente valores para uma representação JSON canônica. */
function canonicalize(valor: unknown): unknown {
  if (typeof valor === 'number') {
    return canonicalNumberString(valor);
  }
  if (Array.isArray(valor)) {
    return valor.map(canonicalize);
  }
  if (valor !== null && typeof valor === 'object') {
    const obj: Record<string, unknown> = {};
    for (const chave of Object.keys(valor as Record<string, unknown>).sort()) {
      obj[chave] = canonicalize((valor as Record<string, unknown>)[chave]);
    }
    return obj;
  }
  return valor;
}

/**
 * Hash determinístico da representação canônica dos campos semânticos.
 *
 * Propriedades:
 * - números equivalentes (100 / 100.0 / 100.00) produzem o mesmo hash;
 * - chaves de objetos (metadata) são ordenadas;
 * - ausência e presença de campos opcionais alteram o hash.
 */
export function computeRequestHash(req: RequisicaoSemantica): string {
  const canonic: Record<string, unknown> = {
    idContrato: req.idContrato,
    idConta: req.idConta,
    valor: req.valor,
    moeda: req.moeda,
    tipoOperacao: req.tipoOperacao,
  };
  if (req.idEstabelecimento !== undefined) {
    canonic.idEstabelecimento = req.idEstabelecimento;
  }
  if (req.metadata !== undefined) {
    canonic.metadata = req.metadata;
  }

  const json = JSON.stringify(canonicalize(canonic));
  return createHash('sha256').update(json).digest('hex');
}