import { Autorizacao } from '../../../src/domain/entities/Autorizacao';
import { TipoOperacao } from '../../../src/domain/value-objects/TipoOperacao';

describe('Autorizacao', () => {
  const agora = new Date('2026-09-24T12:00:00.000Z');

  it('aprova e serializa response OpenAPI', () => {
    const auth = Autorizacao.aprovar({
      idAutorizacao: 'AUT-1',
      idContrato: 'CTR-1',
      idConta: 'ACC-1',
      valor: 100,
      moeda: 'BRL',
      tipoOperacao: TipoOperacao.DEBITO,
      saldoReservado: 900,
      occurredAt: agora,
    });
    expect(auth.status).toBe('APROVADA');
    expect(auth.toResponse()).toEqual({
      id_autorizacao: 'AUT-1',
      id_contrato: 'CTR-1',
      status: 'APROVADA',
      valor: 100,
      saldo_reservado: 900,
      occurred_at: agora.toISOString(),
    });
  });

  it('recusa com saldo_reservado 0', () => {
    const auth = Autorizacao.recusar({
      idAutorizacao: 'AUT-2',
      idContrato: 'CTR-1',
      idConta: 'ACC-1',
      valor: 100,
      moeda: 'BRL',
      tipoOperacao: TipoOperacao.DEBITO,
      occurredAt: agora,
    });
    expect(auth.status).toBe('RECUSADA');
    expect(auth.saldoReservado).toBe(0);
  });

  it('expõe getters e rejeita props inválidas', () => {
    const auth = Autorizacao.aprovar({
      idAutorizacao: 'AUT-3',
      idContrato: 'CTR-1',
      idConta: 'ACC-1',
      valor: 50,
      moeda: 'BRL',
      tipoOperacao: TipoOperacao.RESERVA,
      saldoReservado: 950,
      occurredAt: agora,
      idEstabelecimento: 'EST-1',
      metadata: { canal: 'app' },
      correlationId: 'corr',
    });
    expect(auth.idConta).toBe('ACC-1');
    expect(auth.moeda).toBe('BRL');
    expect(auth.tipoOperacao).toBe(TipoOperacao.RESERVA);
    expect(auth.occurredAt).toEqual(agora);
    expect(auth.idEstabelecimento).toBe('EST-1');
    expect(auth.metadata).toEqual({ canal: 'app' });
    expect(auth.correlationId).toBe('corr');
    expect(() =>
      Autorizacao.aprovar({
        idAutorizacao: '',
        idContrato: 'CTR-1',
        idConta: 'ACC-1',
        valor: 1,
        moeda: 'BRL',
        tipoOperacao: TipoOperacao.DEBITO,
        saldoReservado: 0,
        occurredAt: agora,
      }),
    ).toThrow();
    expect(() =>
      Autorizacao.aprovar({
        idAutorizacao: 'A',
        idContrato: '',
        idConta: 'ACC-1',
        valor: 1,
        moeda: 'BRL',
        tipoOperacao: TipoOperacao.DEBITO,
        saldoReservado: 0,
        occurredAt: agora,
      }),
    ).toThrow();
    expect(() =>
      Autorizacao.aprovar({
        idAutorizacao: 'A',
        idContrato: 'C',
        idConta: '',
        valor: 1,
        moeda: 'BRL',
        tipoOperacao: TipoOperacao.DEBITO,
        saldoReservado: 0,
        occurredAt: agora,
      }),
    ).toThrow();
    expect(() =>
      Autorizacao.aprovar({
        idAutorizacao: 'A',
        idContrato: 'C',
        idConta: 'ACC',
        valor: 0,
        moeda: 'BRL',
        tipoOperacao: TipoOperacao.DEBITO,
        saldoReservado: 0,
        occurredAt: agora,
      }),
    ).toThrow();
    expect(() =>
      Autorizacao.aprovar({
        idAutorizacao: 'A',
        idContrato: 'C',
        idConta: 'ACC',
        valor: 1,
        moeda: 'BR',
        tipoOperacao: TipoOperacao.DEBITO,
        saldoReservado: 0,
        occurredAt: agora,
      }),
    ).toThrow();
  });
});
