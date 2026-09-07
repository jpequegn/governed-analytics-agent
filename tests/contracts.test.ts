import { expect, test } from 'vitest';
import raw from '../fixtures/catalog.json' with { type: 'json' };
import { loadCatalog, hash } from '../src/contracts.js';
test('catalog is validated and hashed deterministically', () => {
  expect(loadCatalog(raw).metrics).toHaveLength(3);
  expect(hash({ a: 1, b: 2 })).toBe(hash({ b: 2, a: 1 }));
});
test.each(['owner', 'grain', 'source'])('missing %s is rejected', key => {
  const c = structuredClone(raw); delete (c.metrics[0] as Record<string, unknown>)[key];
  expect(() => loadCatalog(c)).toThrow();
});
test('unknown columns and duplicate IDs fail', () => {
  const c = structuredClone(raw);
  c.metrics[0].dimensions = ['password'];
  expect(() => loadCatalog(c)).toThrow();
  c.metrics = [c.metrics[1], c.metrics[1]];
  expect(() => loadCatalog(c)).toThrow();
});
test('SQL-shaped operation and unknown catalog fields fail', () => {
  expect(() => loadCatalog({ ...raw, sql: 'DROP TABLE orders' })).toThrow();
  const c = structuredClone(raw); c.metrics[0].operation = { kind: 'sum', column: 'amount);--' };
  expect(() => loadCatalog(c)).toThrow();
});

