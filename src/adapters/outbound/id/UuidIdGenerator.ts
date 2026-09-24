import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../../../application/ports/IdGenerator';

/**
 * Gerador de IDs baseado em UUIDv4 (crypto.randomUUID). Usado para
 * `id_autorizacao` e `event_id` (este último é a chave de idempotência dos
 * consumidores — ADR-006/007).
 */
export class UuidIdGenerator implements IdGenerator {
  newId(): string {
    return randomUUID();
  }
}
