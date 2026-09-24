import type { Clock } from '../../../application/ports/Clock';

/**
 * Clock de produção: delega para o relógio do sistema. Injetável para que
 * testes controlem o tempo (determinismo em idempotência/TTL).
 */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
