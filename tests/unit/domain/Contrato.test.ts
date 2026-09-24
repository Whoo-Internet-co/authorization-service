import { Contrato } from '../../../src/domain/entities/Contrato';
import { LimiteInsuficienteError } from '../../../src/domain/errors/DomainError';

describe('Contrato', () => {
  const base = {
    idContrato: 'CTR-1',
    availableLimit: 1000,
    totalLimit: 1000,
    moeda: 'BRL',
    ativo: true,
  };

  it('podeReservar quando ativo e com saldo', () => {
    const c = Contrato.create(base);
    expect(c.podeReservar(700)).toBe(true);
    expect(c.podeReservar(1001)).toBe(false);
  });

  it('não reserva em contrato inativo', () => {
    const c = Contrato.create({ ...base, ativo: false });
    expect(c.podeReservar(100)).toBe(false);
  });

  it('aplica delta e protege saldo negativo', () => {
    const c = Contrato.create(base);
    c.aplicarDelta(-300);
    expect(c.availableLimit).toBe(700);
    expect(c.saldoAposAplicacao(-200)).toBe(500);
    expect(() => c.aplicarDelta(-1000)).toThrow(LimiteInsuficienteError);
  });

  it('expõe getters e rejeita props inválidas', () => {
    const c = Contrato.create({ ...base, updatedAt: new Date('2026-01-01T00:00:00Z') });
    expect(c.totalLimit).toBe(1000);
    expect(c.moeda).toBe('BRL');
    expect(c.updatedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(() => Contrato.create({ ...base, idContrato: '' })).toThrow();
    expect(() => Contrato.create({ ...base, availableLimit: -1 })).toThrow();
    expect(() => Contrato.create({ ...base, totalLimit: -1 })).toThrow();
    expect(() => Contrato.create({ ...base, moeda: 'BR' })).toThrow();
  });
});
