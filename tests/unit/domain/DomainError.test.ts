import {
  ConflitoConcorrenciaError,
  ContratoInexistenteError,
  IdempotencyConflictError,
  InvalidCommandError,
  LimiteInsuficienteError,
  ValorInvalidoError,
} from '../../../src/domain/errors/DomainError';

describe('DomainError hierarchy', () => {
  it('expõe códigos e mensagens', () => {
    expect(new InvalidCommandError('x').code).toBe('COMANDO_INVALIDO');
    expect(new ValorInvalidoError(-1).code).toBe('VALOR_INVALIDO');
    expect(new LimiteInsuficienteError('C', 10).code).toBe('LIMITE_INSUFICIENTE');
    expect(new ConflitoConcorrenciaError().code).toBe('CONFLITO_CONCORRENCIA');
    expect(new IdempotencyConflictError('k').code).toBe('CONFLITO_IDEMPOTENCIA');
    expect(new ContratoInexistenteError('C').code).toBe('CONTRATO_INEXISTENTE');
  });
});
