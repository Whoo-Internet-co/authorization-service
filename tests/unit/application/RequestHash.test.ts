import { computeRequestHash } from '../../../src/application/services/RequestHash';

describe('computeRequestHash', () => {
  const base = {
    idContrato: 'CTR-1',
    idConta: 'ACC-1',
    valor: 100,
    moeda: 'BRL',
    tipoOperacao: 'DEBITO',
  };

  it('é determinístico para o mesmo payload semântico', () => {
    expect(computeRequestHash(base)).toBe(computeRequestHash(base));
  });

  it('trata 100 / 100.0 / 100.00 como equivalentes', () => {
    const a = computeRequestHash({ ...base, valor: 100 });
    const b = computeRequestHash({ ...base, valor: 100.0 });
    const c = computeRequestHash({ ...base, valor: 100.00 });
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('ordena chaves de metadata', () => {
    const a = computeRequestHash({ ...base, metadata: { z: 1, a: 2 } });
    const b = computeRequestHash({ ...base, metadata: { a: 2, z: 1 } });
    expect(a).toBe(b);
  });

  it('muda quando campo semântico muda', () => {
    expect(computeRequestHash({ ...base, valor: 101 })).not.toBe(computeRequestHash(base));
    expect(computeRequestHash({ ...base, idEstabelecimento: 'X' })).not.toBe(
      computeRequestHash(base),
    );
  });
});
