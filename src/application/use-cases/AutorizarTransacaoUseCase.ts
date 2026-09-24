import type { AutorizacaoResponse } from '../../domain/entities/Autorizacao';
import { Autorizacao } from '../../domain/entities/Autorizacao';
import { TransacaoAutorizada } from '../../domain/events/TransacaoAutorizada';
import { TipoOperacao } from '../../domain/value-objects/TipoOperacao';
import { ValorMonetario } from '../../domain/value-objects/ValorMonetario';
import {
  ConflitoConcorrenciaError,
  ContratoInexistenteError,
  IdempotencyConflictError,
  InvalidCommandError,
  LimiteInsuficienteError,
} from '../../domain/errors/DomainError';
import type { CircuitBreaker } from '../ports/CircuitBreaker';
import type { Clock } from '../ports/Clock';
import type { EventSchemaValidator } from '../ports/EventSchemaValidator';
import type { IdGenerator } from '../ports/IdGenerator';
import type { IdempotencyRepository, IdempotencyResponse } from '../ports/IdempotencyRepository';
import type { LimitRepository } from '../ports/LimitRepository';
import type { Logger } from '../ports/Logger';
import { computeRequestHash } from '../services/RequestHash';

export interface AutorizarTransacaoCommand {
  idContrato: string;
  idConta: string;
  valor: number;
  moeda: string;
  tipoOperacao: string;
  idEstabelecimento?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
  correlationId: string;
  traceId: string | null;
}

export type AutorizacaoOutcome =
  | { kind: 'APROVADA'; criada: boolean; autorizacao: AutorizacaoResponse }
  | { kind: 'REPLAY'; autorizacao: IdempotencyResponse }
  | { kind: 'LIMITE_INSUFICIENTE'; detail: string }
  | { kind: 'CONFLITO'; detail: string }
  | { kind: 'CIRCUITO_ABERTO' };

export interface AutorizarTransacaoUseCaseConfig {
  idempotencyTtlSeconds: number;
}

/**
 * Use case AutorizarTransacao (ADR-003, ADR-004, ADR-006).
 *
 * Fluxo:
 * 1. valida o comando (invariantes de domínio);
 * 2. computa o request_hash canônico (ADR-004);
 * 3. adquire a chave de idempotência atomicamente (conditional put);
 *    - replay com o MESMO hash → retorna o resultado original (200);
 *    - mesma chave com hash diferente → 409 (conflito);
 * 4. lê o contrato e calcula o delta + novo saldo no domínio;
 * 5. cria Authorization e evento TransacaoAutorizada;
 * 6. valida o evento contra o contrato oficial (ADR-008);
 * 7. persiste TUDO em uma única TransactWriteItems (ADR-006).
 *
 * O domínio/application não dependem de AWS ou framework.
 */
export class AutorizarTransacaoUseCase {
  constructor(
    private readonly limitRepository: LimitRepository,
    private readonly idempotencyRepository: IdempotencyRepository,
    private readonly validator: EventSchemaValidator,
    private readonly logger: Logger,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly circuitBreaker: CircuitBreaker,
    private readonly config: AutorizarTransacaoUseCaseConfig,
  ) {}

  async execute(command: AutorizarTransacaoCommand): Promise<AutorizacaoOutcome> {
    this.validateCommand(command);

    if (await this.circuitBreaker.isOpen()) {
      this.logger.warn('Autorização recusada: circuit breaker aberto', {
        id_contrato: command.idContrato,
        idempotency_key: command.idempotencyKey,
      });
      return { kind: 'CIRCUITO_ABERTO' };
    }

    const requestHash = computeRequestHash(command);
    const agora = this.clock.now();

    const adquirida = await this.idempotencyRepository.acquire(
      command.idempotencyKey,
      requestHash,
      this.config.idempotencyTtlSeconds,
      agora,
    );

    if (adquirida.kind === 'REPLAY') {
      this.logger.info('Replay idempotente — resultado original retornado', {
        id_contrato: command.idContrato,
        idempotency_key: command.idempotencyKey,
        id_autorizacao: adquirida.response.id_autorizacao,
      });
      return { kind: 'REPLAY', autorizacao: adquirida.response };
    }

    if (adquirida.kind === 'CONFLITO') {
      throw new IdempotencyConflictError(command.idempotencyKey);
    }

    const tipoOperacao = TipoOperacao.fromString(command.tipoOperacao);
    if (tipoOperacao === null) {
      throw new InvalidCommandError(`tipo_operacao inválido: ${command.tipoOperacao}`);
    }
    const valor = ValorMonetario.create(command.valor);

    try {
      const contrato = await this.limitRepository.findById(command.idContrato);
      if (contrato === null) {
        throw new ContratoInexistenteError(command.idContrato);
      }

      if (!contrato.ativo) {
        this.logger.warn('Autorização recusada: contrato inativo', {
          id_contrato: command.idContrato,
          idempotency_key: command.idempotencyKey,
        });
        return {
          kind: 'CONFLITO',
          detail: 'O contrato está em um estado que não permite autorização.',
        };
      }

      const delta = tipoOperacao.sinal * valor.amount;
      const saldoReservado = contrato.saldoAposAplicacao(delta);

      if (tipoOperacao.consomeLimite && !contrato.podeReservar(valor.amount)) {
        await this.registrarRecusa(command, requestHash, agora, 'LIMITE_INSUFICIENTE');
        return {
          kind: 'LIMITE_INSUFICIENTE',
          detail: 'O contrato não possui limite disponível para o valor solicitado.',
        };
      }

      const autorizacao = this.criarAutorizacao(command, valor.amount, saldoReservado, agora);
      const evento = this.criarEvento(command, autorizacao, saldoReservado, agora);

      this.validator.assertValid(evento.toJson());

      await this.limitRepository.applyAuthorization({
        idContrato: command.idContrato,
        delta,
        tipoOperacao,
        autorizacao,
        idempotencia: {
          chave: command.idempotencyKey,
          requestHash,
          response: autorizacao.toResponse(),
          ttlSeconds: this.config.idempotencyTtlSeconds,
          now: agora,
        },
        outboxEvent: evento,
      });

      await this.circuitBreaker.recordSuccess();
      this.logger.info('Autorização aprovada', {
        id_autorizacao: autorizacao.idAutorizacao,
        id_contrato: command.idContrato,
        idempotency_key: command.idempotencyKey,
        saldo_reservado: saldoReservado,
        tipo_operacao: command.tipoOperacao,
      });

      return { kind: 'APROVADA', criada: true, autorizacao: autorizacao.toResponse() };
    } catch (error) {
      if (error instanceof LimiteInsuficienteError) {
        await this.registrarRecusa(command, requestHash, agora, 'LIMITE_INSUFICIENTE');
        return {
          kind: 'LIMITE_INSUFICIENTE',
          detail: 'O contrato não possui limite disponível para o valor solicitado.',
        };
      }
      if (error instanceof ConflitoConcorrenciaError) {
        return {
          kind: 'CONFLITO',
          detail: 'Conflito de concorrência na reserva de limite. Tente novamente.',
        };
      }
      await this.circuitBreaker.recordFailure();
      throw error;
    }
  }

  private criarAutorizacao(
    command: AutorizarTransacaoCommand,
    valor: number,
    saldoReservado: number,
    agora: Date,
  ): Autorizacao {
    return Autorizacao.aprovar({
      idAutorizacao: this.idGenerator.newId(),
      idContrato: command.idContrato,
      idConta: command.idConta,
      valor,
      moeda: command.moeda,
      tipoOperacao: TipoOperacao.fromString(command.tipoOperacao) as TipoOperacao,
      saldoReservado,
      occurredAt: agora,
      ...(command.idEstabelecimento !== undefined ? { idEstabelecimento: command.idEstabelecimento } : {}),
      ...(command.metadata !== undefined ? { metadata: command.metadata } : {}),
      ...(command.correlationId !== undefined ? { correlationId: command.correlationId } : {}),
    });
  }

  private criarEvento(
    command: AutorizarTransacaoCommand,
    autorizacao: Autorizacao,
    saldoReservado: number,
    agora: Date,
  ): TransacaoAutorizada {
    return new TransacaoAutorizada({
      eventId: this.idGenerator.newId(),
      occurredAt: agora,
      idAutorizacao: autorizacao.idAutorizacao,
      idContrato: command.idContrato,
      valor: autorizacao.valor,
      saldoReservado,
      correlationId: command.correlationId,
      traceId: command.traceId,
    });
  }

  private async registrarRecusa(
    command: AutorizarTransacaoCommand,
    requestHash: string,
    agora: Date,
    motivo: string,
  ): Promise<void> {
    const response: IdempotencyResponse = {
      id_autorizacao: '',
      id_contrato: command.idContrato,
      status: 'RECUSADA',
      valor: command.valor,
      saldo_reservado: 0,
      occurred_at: agora.toISOString(),
      motivo,
    };
    try {
      await this.idempotencyRepository.completeFailure(
        command.idempotencyKey,
        requestHash,
        response,
        this.config.idempotencyTtlSeconds,
        agora,
      );
    } catch (error) {
      this.logger.warn('Falha ao persistir recusa na idempotência (ignorada)', {
        idempotency_key: command.idempotencyKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private validateCommand(command: AutorizarTransacaoCommand): void {
    if (!command.idContrato || command.idContrato.trim().length === 0) {
      throw new InvalidCommandError('id_contrato é obrigatório');
    }
    if (!command.idConta || command.idConta.trim().length === 0) {
      throw new InvalidCommandError('id_conta é obrigatório');
    }
    if (!command.moeda || command.moeda.length !== 3) {
      throw new InvalidCommandError('moeda deve ter 3 caracteres (ISO 4217)');
    }
    if (!Number.isFinite(command.valor) || command.valor <= 0) {
      throw new InvalidCommandError('valor deve ser estritamente positivo');
    }
    if (TipoOperacao.fromString(command.tipoOperacao) === null) {
      throw new InvalidCommandError(`tipo_operacao inválido: ${command.tipoOperacao}`);
    }
    if (!command.idempotencyKey || command.idempotencyKey.trim().length === 0) {
      throw new InvalidCommandError('Idempotency-Key é obrigatória');
    }
  }
}