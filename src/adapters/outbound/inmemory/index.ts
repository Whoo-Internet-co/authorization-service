import type { Contrato } from '../../../domain/entities/Contrato';
import { Contrato as ContratoEntity } from '../../../domain/entities/Contrato';
import type { Autorizacao } from '../../../domain/entities/Autorizacao';
import type { TransacaoAutorizada } from '../../../domain/events/TransacaoAutorizada';
import {
  ConflitoConcorrenciaError,
  IdempotencyConflictError,
  LimiteInsuficienteError,
} from '../../../domain/errors/DomainError';
import type {
  ApplyAuthorizationInput,
  LimitRepository,
} from '../../../application/ports/LimitRepository';
import type {
  AcquireIdempotencyResult,
  IdempotencyRepository,
  IdempotencyResponse,
} from '../../../application/ports/IdempotencyRepository';
import type { OutboxRepository } from '../../../application/ports/OutboxRepository';
import type { DomainEventPublisher } from '../../../application/ports/DomainEventPublisher';

interface StoredContrato {
  contrato: Contrato;
}

/**
 * LimitRepository em memória para testes de unidade do use case.
 * `applyAuthorization` reproduz as invariantes do adapter DynamoDB
 * (condicional `available_limit >= valor` + append de outbox "atômico"
 * no mesmo passo), permitindo testar o fluxo sem infraestrutura.
 */
export class InMemoryLimitRepository implements LimitRepository {
  private readonly contratos = new Map<string, StoredContrato>();
  readonly autorizacoes: Autorizacao[] = [];
  /** Falha a N-ésima chamada de applyAuthorization (testes de circuit breaker). */
  failNextApply = false;

  seed(contrato: Contrato): void {
    this.contratos.set(contrato.idContrato, { contrato });
  }

  seedRaw(props: {
    idContrato: string;
    availableLimit: number;
    totalLimit: number;
    moeda: string;
    ativo: boolean;
  }): void {
    this.seed(ContratoEntity.create(props));
  }

  async findById(idContrato: string): Promise<Contrato | null> {
    return this.contratos.get(idContrato)?.contrato ?? null;
  }

  async applyAuthorization(input: ApplyAuthorizationInput): Promise<void> {
    if (this.failNextApply) {
      this.failNextApply = false;
      throw new ConflitoConcorrenciaError('Falha simulada em applyAuthorization.');
    }
    const stored = this.contratos.get(input.idContrato);
    if (stored === undefined) {
      throw new ConflitoConcorrenciaError('Contrato ausente no apply.');
    }
    const contrato = stored.contrato;
    const consome = input.tipoOperacao.consomeLimite;
    if (consome && !contrato.podeReservar(input.autorizacao.valor)) {
      throw new LimiteInsuficienteError(input.idContrato, input.autorizacao.valor);
    }
    // Aplica delta + persiste autorização + conclusão de idempotência + outbox.
    contrato.aplicarDelta(input.delta);
    contrato.atualizarTimestamp(input.idempotencia.now);
    this.autorizacoes.push(input.autorizacao);
    if (this.idempotency !== undefined) {
      this.idempotency.completeInTransaction(
        input.idempotencia.chave,
        input.idempotencia.requestHash,
        input.idempotencia.response,
      );
    }
    if (this.outbox !== undefined) {
      this.outbox.appendLocal(input.outboxEvent);
    }
  }

  /** Vínculo opcional para simular a transação única (idempotência + outbox). */
  private idempotency: InMemoryIdempotencyRepository | undefined;
  private outbox: InMemoryOutboxRepository | undefined;

  link(idempotency: InMemoryIdempotencyRepository, outbox: InMemoryOutboxRepository): void {
    this.idempotency = idempotency;
    this.outbox = outbox;
  }
}

interface StoredIdempotency {
  requestHash: string;
  response?: IdempotencyResponse;
}

/**
 * IdempotencyRepository em memória. `acquire` reproduz o conditional put:
 * primeira chamada ADQUIRIDA; chave existente com mesmo hash + response →
 * REPLAY; chave existente com hash diferente → CONFLITO.
 */
export class InMemoryIdempotencyRepository implements IdempotencyRepository {
  private readonly store = new Map<string, StoredIdempotency>();

  async acquire(
    chave: string,
    requestHash: string,
    _ttlSeconds: number,
    _now: Date,
  ): Promise<AcquireIdempotencyResult> {
    const existing = this.store.get(chave);
    if (existing === undefined) {
      this.store.set(chave, { requestHash });
      return { kind: 'ADQUIRIDA' };
    }
    if (existing.requestHash === requestHash && existing.response !== undefined) {
      return { kind: 'REPLAY', response: existing.response };
    }
    return { kind: 'CONFLITO' };
  }

  async completeFailure(
    chave: string,
    requestHash: string,
    response: IdempotencyResponse,
    _ttlSeconds: number,
    _now: Date,
  ): Promise<void> {
    this.completeInTransaction(chave, requestHash, response);
  }

  /** Usado pelo applyAuthorization transacional. */
  completeInTransaction(chave: string, requestHash: string, response: IdempotencyResponse): void {
    const existing = this.store.get(chave);
    if (existing === undefined) {
      throw new IdempotencyConflictError(chave);
    }
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError(chave);
    }
    this.store.set(chave, { requestHash, response });
  }

  has(chave: string): boolean {
    return this.store.has(chave);
  }
}

/** OutboxRepository em memória — coleta eventos para asserções. */
export class InMemoryOutboxRepository implements OutboxRepository {
  readonly events: TransacaoAutorizada[] = [];

  async append(event: TransacaoAutorizada): Promise<void> {
    this.appendLocal(event);
  }

  appendLocal(event: TransacaoAutorizada): void {
    this.events.push(event);
  }
}

/** DomainEventPublisher em memória — captura eventos publicados (relay/testes). */
export class InMemoryDomainEventPublisher implements DomainEventPublisher {
  readonly published: TransacaoAutorizada[] = [];
  failNext = false;

  async publish(event: TransacaoAutorizada): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Falha simulada de publicação.');
    }
    this.published.push(event);
  }
}
