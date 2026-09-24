import { AutorizarTransacaoUseCase } from '../../../src/application/use-cases/AutorizarTransacaoUseCase';
import type { AutorizarTransacaoCommand } from '../../../src/application/use-cases/AutorizarTransacaoUseCase';
import {
  InMemoryIdempotencyRepository,
  InMemoryLimitRepository,
  InMemoryOutboxRepository,
} from '../../../src/adapters/outbound/inmemory';
import { InMemoryCircuitBreaker } from '../../../src/adapters/outbound/circuit-breaker/InMemoryCircuitBreaker';
import type { Clock } from '../../../src/application/ports/Clock';
import type { IdGenerator } from '../../../src/application/ports/IdGenerator';
import type { Logger } from '../../../src/application/ports/Logger';
import type { EventSchemaValidator } from '../../../src/application/ports/EventSchemaValidator';
import {
  ContratoInexistenteError,
  IdempotencyConflictError,
  InvalidCommandError,
  LimiteInsuficienteError,
} from '../../../src/domain/errors/DomainError';

class FixedClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return this.fixed;
  }
}

class SeqIdGenerator implements IdGenerator {
  private n = 0;
  newId(): string {
    this.n += 1;
    return `id-${this.n}`;
  }
}

const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const acceptingValidator: EventSchemaValidator = {
  validate: () => ({ valid: true, errors: [] }),
  assertValid: () => undefined,
};

function buildUseCase(overrides?: {
  circuit?: InMemoryCircuitBreaker;
  validator?: EventSchemaValidator;
}) {
  const limits = new InMemoryLimitRepository();
  const idempotency = new InMemoryIdempotencyRepository();
  const outbox = new InMemoryOutboxRepository();
  limits.link(idempotency, outbox);
  limits.seedRaw({
    idContrato: 'CTR-1',
    availableLimit: 1000,
    totalLimit: 1000,
    moeda: 'BRL',
    ativo: true,
  });

  const useCase = new AutorizarTransacaoUseCase(
    limits,
    idempotency,
    overrides?.validator ?? acceptingValidator,
    silentLogger,
    new FixedClock(new Date('2026-09-24T12:00:00.000Z')),
    new SeqIdGenerator(),
    overrides?.circuit ??
      new InMemoryCircuitBreaker({ forceOpen: false, failureThreshold: 5, cooldownMs: 30_000 }),
    { idempotencyTtlSeconds: 86400 },
  );

  return { useCase, limits, idempotency, outbox };
}

function cmd(partial: Partial<AutorizarTransacaoCommand> = {}): AutorizarTransacaoCommand {
  return {
    idContrato: 'CTR-1',
    idConta: 'ACC-1',
    valor: 100,
    moeda: 'BRL',
    tipoOperacao: 'DEBITO',
    idempotencyKey: 'key-1',
    correlationId: 'corr-1',
    traceId: null,
    ...partial,
  };
}

describe('AutorizarTransacaoUseCase', () => {
  it('aprova e grava outbox na mesma transação lógica', async () => {
    const { useCase, limits, outbox } = buildUseCase();
    const result = await useCase.execute(cmd());
    expect(result.kind).toBe('APROVADA');
    if (result.kind === 'APROVADA') {
      expect(result.criada).toBe(true);
      expect(result.autorizacao.status).toBe('APROVADA');
      expect(result.autorizacao.saldo_reservado).toBe(900);
    }
    expect(limits.autorizacoes).toHaveLength(1);
    expect(outbox.events).toHaveLength(1);
    expect(outbox.events[0]!.eventId).toBe('id-2');
  });

  it('replay idempotente retorna REPLAY sem nova reserva', async () => {
    const { useCase, limits } = buildUseCase();
    const first = await useCase.execute(cmd());
    expect(first.kind).toBe('APROVADA');
    const second = await useCase.execute(cmd());
    expect(second.kind).toBe('REPLAY');
    expect(limits.autorizacoes).toHaveLength(1);
    expect((await limits.findById('CTR-1'))!.availableLimit).toBe(900);
  });

  it('mesma chave com payload diferente → IdempotencyConflictError', async () => {
    const { useCase } = buildUseCase();
    await useCase.execute(cmd({ valor: 100 }));
    await expect(useCase.execute(cmd({ valor: 200 }))).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
  });

  it('limite insuficiente → LIMITE_INSUFICIENTE (402)', async () => {
    const { useCase } = buildUseCase();
    const result = await useCase.execute(cmd({ valor: 1500, idempotencyKey: 'key-limite' }));
    expect(result.kind).toBe('LIMITE_INSUFICIENTE');
  });

  it('circuit breaker aberto → CIRCUITO_ABERTO (503)', async () => {
    const circuit = new InMemoryCircuitBreaker({
      forceOpen: true,
      failureThreshold: 5,
      cooldownMs: 30_000,
    });
    const { useCase } = buildUseCase({ circuit });
    const result = await useCase.execute(cmd());
    expect(result.kind).toBe('CIRCUITO_ABERTO');
  });

  it('contrato inativo → CONFLITO', async () => {
    const { useCase, limits } = buildUseCase();
    limits.seedRaw({
      idContrato: 'CTR-1',
      availableLimit: 1000,
      totalLimit: 1000,
      moeda: 'BRL',
      ativo: false,
    });
    const result = await useCase.execute(cmd({ idempotencyKey: 'key-inativo' }));
    expect(result.kind).toBe('CONFLITO');
  });

  it('valida comando inválido', async () => {
    const { useCase } = buildUseCase();
    await expect(useCase.execute(cmd({ moeda: 'BR' }))).rejects.toBeInstanceOf(InvalidCommandError);
    await expect(useCase.execute(cmd({ valor: 0 }))).rejects.toBeInstanceOf(InvalidCommandError);
    await expect(useCase.execute(cmd({ tipoOperacao: 'PIX' }))).rejects.toBeInstanceOf(
      InvalidCommandError,
    );
  });

  it('CREDITO devolve limite', async () => {
    const { useCase, limits } = buildUseCase();
    await useCase.execute(cmd({ valor: 200, tipoOperacao: 'DEBITO', idempotencyKey: 'd1' }));
    expect((await limits.findById('CTR-1'))!.availableLimit).toBe(800);
    await useCase.execute(cmd({ valor: 50, tipoOperacao: 'CREDITO', idempotencyKey: 'c1' }));
    expect((await limits.findById('CTR-1'))!.availableLimit).toBe(850);
  });

  it('contrato inexistente → ContratoInexistenteError', async () => {
    const { useCase } = buildUseCase();
    await expect(
      useCase.execute(cmd({ idContrato: 'CTR-MISSING', idempotencyKey: 'missing' })),
    ).rejects.toBeInstanceOf(ContratoInexistenteError);
  });

  it('conflito de concorrência no apply → CONFLITO', async () => {
    const { useCase, limits } = buildUseCase();
    limits.failNextApply = true;
    const result = await useCase.execute(cmd({ idempotencyKey: 'key-conflict-apply' }));
    expect(result.kind).toBe('CONFLITO');
  });

  it('LimiteInsuficienteError no apply → LIMITE_INSUFICIENTE', async () => {
    const { useCase, limits } = buildUseCase();
    const original = limits.applyAuthorization.bind(limits);
    limits.applyAuthorization = async (input) => {
      // Força o caminho do catch LimiteInsuficienteError após pré-check passar.
      limits.seedRaw({
        idContrato: 'CTR-1',
        availableLimit: 0,
        totalLimit: 1000,
        moeda: 'BRL',
        ativo: true,
      });
      return original(input);
    };
    // Pré-check: seed com 1000 para passar podeReservar; apply vê 0 e lança.
    limits.seedRaw({
      idContrato: 'CTR-1',
      availableLimit: 1000,
      totalLimit: 1000,
      moeda: 'BRL',
      ativo: true,
    });
    // Override findById path: use race — seed 1000, then in applyAuthorization throw
    limits.applyAuthorization = async () => {
      throw new LimiteInsuficienteError('CTR-1', 100);
    };
    const result = await useCase.execute(cmd({ idempotencyKey: 'key-limite-apply' }));
    expect(result.kind).toBe('LIMITE_INSUFICIENTE');
  });

  it('valida campos obrigatórios do comando', async () => {
    const { useCase } = buildUseCase();
    await expect(useCase.execute(cmd({ idContrato: '  ' }))).rejects.toBeInstanceOf(
      InvalidCommandError,
    );
    await expect(useCase.execute(cmd({ idConta: '' }))).rejects.toBeInstanceOf(InvalidCommandError);
    await expect(useCase.execute(cmd({ idempotencyKey: '' }))).rejects.toBeInstanceOf(
      InvalidCommandError,
    );
  });
});
