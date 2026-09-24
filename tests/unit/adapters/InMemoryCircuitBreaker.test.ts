import {
  InMemoryCircuitBreaker,
  circuitBreakerConfigFromEnv,
} from '../../../src/adapters/outbound/circuit-breaker/InMemoryCircuitBreaker';
import type { Clock } from '../../../src/application/ports/Clock';

class FakeClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

describe('InMemoryCircuitBreaker', () => {
  it('forceOpen → isOpen true (→ 503)', async () => {
    const cb = new InMemoryCircuitBreaker({
      forceOpen: true,
      failureThreshold: 5,
      cooldownMs: 30_000,
    });
    expect(await cb.isOpen()).toBe(true);
  });

  it('abre após limiar de falhas e entra em half-open após cooldown', async () => {
    const clock = new FakeClock(new Date('2026-09-24T12:00:00.000Z'));
    const cb = new InMemoryCircuitBreaker(
      { forceOpen: false, failureThreshold: 2, cooldownMs: 1000 },
      clock,
    );
    await cb.recordFailure();
    expect(await cb.isOpen()).toBe(false);
    await cb.recordFailure();
    expect(await cb.isOpen()).toBe(true);
    expect(cb.getState()).toBe('OPEN');

    clock.advance(1000);
    expect(await cb.isOpen()).toBe(false);
    expect(cb.getState()).toBe('HALF_OPEN');

    await cb.recordSuccess();
    expect(cb.getState()).toBe('CLOSED');
  });

  it('lê config de env', () => {
    expect(
      circuitBreakerConfigFromEnv({
        CIRCUIT_BREAKER_FORCE_OPEN: 'true',
        CIRCUIT_BREAKER_FAILURE_THRESHOLD: '3',
        CIRCUIT_BREAKER_COOLDOWN_MS: '5000',
      }),
    ).toEqual({ forceOpen: true, failureThreshold: 3, cooldownMs: 5000 });
  });
});
