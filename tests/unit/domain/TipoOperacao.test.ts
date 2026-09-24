import { TipoOperacao } from '../../../src/domain/value-objects/TipoOperacao';

describe('TipoOperacao', () => {
  it.each([
    ['DEBITO', true, -1],
    ['RESERVA', true, -1],
    ['CREDITO', false, 1],
    ['ESTORNO', false, 1],
  ] as const)('%s: consomeLimite=%s sinal=%s', (valor, consome, sinal) => {
    const tipo = TipoOperacao.fromString(valor);
    expect(tipo).not.toBeNull();
    expect(tipo!.consomeLimite).toBe(consome);
    expect(tipo!.sinal).toBe(sinal);
  });

  it('retorna null para tipo desconhecido', () => {
    expect(TipoOperacao.fromString('PIX')).toBeNull();
  });
});
