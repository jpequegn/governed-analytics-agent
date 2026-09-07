import { expect, test } from 'vitest';
import raw from '../fixtures/catalog.json' with { type: 'json' };
import { loadCatalog } from '../src/contracts.js';
import { compile, validatePlan } from '../src/planner.js';
const c = loadCatalog(raw);
const plan = compile(c, { metric: 'revenue', filters: [] });
test('required filters are parameterized and AST validates', () => {
  expect(plan.params).toEqual(['paid']);
  expect(validatePlan(c, plan)).toEqual(plan);
});
test('filter injection is data, never SQL', () => {
  const p = compile(c, { metric: 'revenue', filters: [{ column: 'city', value: "' OR 1=1 --" }] });
  expect(p.sql).not.toContain('1=1');
  expect(p.params[1]).toContain('1=1');
  expect(validatePlan(c, p)).toEqual(p);
});
test.each([
  'DROP TABLE orders', 'SELECT * FROM orders',
  'SELECT * FROM read_csv_auto(\'/etc/passwd\')',
  plan.sql + '; DELETE FROM orders',
  plan.sql.replace('SUM("amount")', 'AVG("amount")'),
  plan.sql.replace('WHERE "status" = $1', 'WHERE 1=1'),
  plan.sql.replace('FROM "orders"', 'FROM "orders" JOIN secrets ON true'),
])('rejects non-contract SQL: %s', sql => {
  expect(() => validatePlan(c, { ...plan, sql })).toThrow();
});
test('changed parameters and catalog version require a new plan', () => {
  expect(() => validatePlan(c, { ...plan, params: ['cancelled'] })).toThrow();
  expect(() => validatePlan({ ...c, version: 2 }, plan)).toThrow();
});
test('unit price is ratio of sums with zero denominator guard', () => {
  const p = compile(c, { metric: 'unit_price', filters: [] });
  expect(p.sql).toContain('SUM("amount") / NULLIF(SUM("units"), 0)');
  expect(validatePlan(c, p)).toEqual(p);
});

