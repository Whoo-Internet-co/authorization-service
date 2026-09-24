import type { CircuitBreaker } from '../../../application/ports/CircuitBreaker';
import type { Clock } from '../../../application/ports/Clock';
import { SystemClock } from '../clock/SystemClock';

export interface InMemoryCircuitBreakerConfig {
  /** Abertura forçada por configuração/feature flag → 503 imediato. */
  forceOpen: boolean;
  /** Falhas consecutivas para abrir o circuito. */
  failureThreshold: number;
  /** Cooldown (ms) antes de half-open (permite 1 tentativa). */
  cooldownMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: InMemoryCircuitBreakerConfig = {
  forceOpen: false,
  failureThreshold: 5,
  cooldownMs: 30_000,
};

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * Circuit breaker em memória (ADR-001: infraestrutura mínima, sem dependências).
 *
 * - `forceOpen` permite degradação deliberada via config/feature flag (→ 503);
 * - abre após `failureThreshold` falhas consecutivas no caminho de persistência;
 * - após `cooldownMs` entra em HALF_OPEN: uma sucesso fecha, uma falha reabre.
 *
 * Estado por processo (instância local) — suficiente para proteção de
 * dependência e kill-switch operacional; não é coordenação distribuída.
 */
export class InMemoryCircuitBreaker implements CircuitBreaker {
  private state: State = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt = 0;

  constructor(
    private readonly config: InMemoryCircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  async isOpen(): Promise<boolean> {
    if (this.config.forceOpen) {
      return true;
    }
    if (this.state === 'OPEN') {
      const elapsed = this.clock.now().getTime() - this.openedAt;
      if (elapsed >= this.config.cooldownMs) {
        this.state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  async recordSuccess(): Promise<void> {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
  }

  async recordFailure(): Promise<void> {
    this.consecutiveFailures += 1;
    if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.config.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = this.clock.now().getTime();
      this.consecutiveFailures = 0;
    }
  }

  /** Visibilidade para testes/observabilidade. */
  getState(): State {
    return this.state;
  }
}

/** Constrói a config a partir de variáveis de ambiente (CIRCUIT_BREAKER_*). */
export function circuitBreakerConfigFromEnv(
  env: Record<string, string | undefined>,
): InMemoryCircuitBreakerConfig {
  return {
    forceOpen: env.CIRCUIT_BREAKER_FORCE_OPEN === 'true',
    failureThreshold: Number(env.CIRCUIT_BREAKER_FAILURE_THRESHOLD ?? 5) || 5,
    cooldownMs: Number(env.CIRCUIT_BREAKER_COOLDOWN_MS ?? 30_000) || 30_000,
  };
}
