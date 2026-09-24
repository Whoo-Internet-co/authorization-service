import { ValorMonetario, canonicalNumberString } from '../../../src/domain/value-objects/ValorMonetario';
import { ValorInvalidoError } from '../../../src/domain/errors/DomainError';

describe('ValorMonetario', () => {
  it('cria valor estritamente positivo', () => {
    expect(ValorMonetario.create(100).amount).toBe(100);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejeita valor inválido %p',
    (valor) => {
      expect(() => ValorMonetario.create(valor)).toThrow(ValorInvalidoError);
    },
  );

  it('normaliza representações equivalentes no canônico', () => {
    expect(canonicalNumberString(100)).toBe('100');
    expect(canonicalNumberString(100.0)).toBe('100');
    expect(canonicalNumberString(100.5)).toBe('100.5');
    expect(ValorMonetario.create(10.25).toCanonicalString()).toBe('10.25');
  });
});
