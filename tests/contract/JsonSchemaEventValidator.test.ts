import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonSchemaEventValidator } from '../../src/adapters/outbound/validation/JsonSchemaEventValidator';

const fixturesDir = join(__dirname, '../fixtures/contract');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(fixturesDir, name), 'utf8'));
}

describe('JsonSchemaEventValidator (producer contract, ADR-008)', () => {
  const validator = new JsonSchemaEventValidator();

  it('example oficial PASS', () => {
    const result = validator.validate(loadFixture('official-example.json'));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it.each([
    'invalid-event-type.json',
    'invalid-version.json',
    'missing-event-id.json',
  ])('%s FAIL', (name) => {
    const result = validator.validate(loadFixture(name));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(() => validator.assertValid(loadFixture(name))).toThrow();
  });
});
