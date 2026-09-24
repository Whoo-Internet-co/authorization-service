/**
 * Circuit breaker (simplificado — config/feature flag, ver README):
 * abre após N falhas consecutivas no caminho de persistência e reabre
 * após cooldown (half-open). Também permite abertura forçada por configuração.
 */
export interface CircuitBreaker {
  isOpen(): Promise<boolean>;
  recordSuccess(): Promise<void>;
  recordFailure(): Promise<void>;
}