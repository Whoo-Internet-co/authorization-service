import { Body, Controller, Headers, Inject, Param, Post, Req, Res } from '@nestjs/common';
import type { Response, Request } from 'express';
import type {
  AutorizarTransacaoCommand,
  AutorizarTransacaoUseCase,
} from '../../../application/use-cases/AutorizarTransacaoUseCase';
import type { AutorizacaoResponse } from '../../../domain/entities/Autorizacao';
import { ProblemException } from './ProblemException';
import { PROBLEM_TITLE, PROBLEM_TYPE } from './problemMapping';
// Valor (não `import type`): emitDecoratorMetadata referencia a classe em
// runtime para o ValidationPipe transformar o body.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { CriarAutorizacaoDto } from './dto/CriarAutorizacaoDto';
import { USE_CASE } from './providers';

/**
 * Controller fino (ADR-001): traduz HTTP ⇄ comando/resultado do use case.
 * Nenhuma regra de negócio aqui — decisões vivem em `AutorizarTransacaoUseCase`.
 *
 * Mapeamento de outcomes → HTTP:
 * - `APROVADA` (criada) → 201 + `Location`;
 * - `REPLAY`            → 200 + eco do `Idempotency-Key` (resultado original);
 * - `LIMITE_INSUFICIENTE` → 402 (problem+json);
 * - `CONFLITO`          → 409 (problem+json);
 * - `CIRCUITO_ABERTO`   → 503 (problem+json + Retry-After).
 */
@Controller()
export class AutorizacoesController {
  constructor(@Inject(USE_CASE) private readonly useCase: AutorizarTransacaoUseCase) {}

  @Post('/v1/contratos/:id_contrato/autorizacoes')
  async criar(
    @Param('id_contrato') idContrato: string,
    @Body() dto: CriarAutorizacaoDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AutorizacaoResponse> {
    const instance = `/v1/contratos/${idContrato}/autorizacoes`;
    if (idempotencyKey === undefined || idempotencyKey.trim() === '') {
      throw new ProblemException({
        status: 422,
        type: PROBLEM_TYPE.validacao,
        title: PROBLEM_TITLE[PROBLEM_TYPE.validacao],
        detail: "O header 'Idempotency-Key' é obrigatório.",
        instance,
        errors: [{ campo: 'Idempotency-Key', motivo: 'header obrigatório ausente' }],
      });
    }

    const command: AutorizarTransacaoCommand = {
      idContrato,
      idConta: dto.id_conta,
      valor: dto.valor,
      moeda: dto.moeda,
      tipoOperacao: dto.tipo_operacao,
      ...(dto.id_estabelecimento !== undefined
        ? { idEstabelecimento: dto.id_estabelecimento }
        : {}),
      ...(dto.metadata !== undefined ? { metadata: dto.metadata } : {}),
      idempotencyKey: idempotencyKey.trim(),
      correlationId: req.correlationId,
      traceId: req.traceId,
    };

    const outcome = await this.useCase.execute(command);

    switch (outcome.kind) {
      case 'APROVADA':
        res.status(201);
        res.setHeader(
          'Location',
          `${instance}/${outcome.autorizacao.id_autorizacao}`,
        );
        return outcome.autorizacao;

      case 'REPLAY':
        res.status(200);
        res.setHeader('Idempotency-Key', command.idempotencyKey);
        return outcome.autorizacao;

      case 'LIMITE_INSUFICIENTE':
        throw new ProblemException({
          status: 402,
          type: PROBLEM_TYPE.limiteInsuficiente,
          title: PROBLEM_TITLE[PROBLEM_TYPE.limiteInsuficiente],
          detail: outcome.detail,
          instance,
        });

      case 'CONFLITO':
        throw new ProblemException({
          status: 409,
          type: PROBLEM_TYPE.conflitoEstado,
          title: PROBLEM_TITLE[PROBLEM_TYPE.conflitoEstado],
          detail: outcome.detail,
          instance,
        });

      case 'CIRCUITO_ABERTO':
        throw new ProblemException({
          status: 503,
          type: PROBLEM_TYPE.indisponivel,
          title: PROBLEM_TITLE[PROBLEM_TYPE.indisponivel],
          detail: 'Serviço temporariamente indisponível (circuit breaker aberto). Tente novamente.',
          instance,
          retryAfterSeconds: 60,
        });
    }
  }
}
