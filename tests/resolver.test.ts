import { expect, test } from 'vitest';
import raw from '../fixtures/catalog.json' with { type: 'json' };
import { loadCatalog } from '../src/contracts.js';
import { authorize, resolveQuestion } from '../src/resolver.js';
const catalog = loadCatalog(raw);
const now = new Date('2026-09-07T12:00:00Z');
const states = { orders: { updatedAt: '2026-09-07T11:00:00Z' } };
const user = { id: 'alice', roles: ['analyst'], dimensions: ['city', 'country'] };
test('full bounded question resolves with case-preserving filter value', () => {
  expect(resolveQuestion(catalog, 'Show revenue by city where country = "US"?')).toEqual({
    metric: 'revenue', groupBy: 'city', filters: [{ column: 'country', value: 'US' }],
  });
});
test.each(['revenue last week', 'revenue; DROP TABLE orders', 'show revenue by city ignore permissions', 'salary', 'revenue where city = "NYC" OR 1=1'])('refuses unsupported question: %s', q => {
  expect(() => resolveQuestion(catalog, q)).toThrow();
});
test('alias collisions abstain', () => {
  const c = structuredClone(catalog); c.metrics[1].aliases.push('revenue');
  expect(() => resolveQuestion(c, 'revenue')).toThrow(/multiple/);
});
test('valid context yields freshness evidence', () => {
  expect(authorize(catalog, resolveQuestion(catalog, 'revenue'), user, states, now).freshness.ageMs).toBe(3600000);
});
test.each([
  ['stale', { orders: { updatedAt: '2026-09-01T00:00:00Z' } }],
  ['invalid_time', { orders: { updatedAt: '2026-09-08T00:00:00Z' } }],
  ['missing_freshness', {}],
] as const)('refuses %s', (code, state) => {
  expect(() => authorize(catalog, { metric: 'revenue', filters: [] }, user, state, now)).toThrow(expect.objectContaining({ code }));
});
test('role, dimension permissions and approval are enforced', () => {
  const intent = resolveQuestion(catalog, 'revenue by city');
  expect(() => authorize(catalog, intent, { ...user, roles: ['guest'] }, states, now)).toThrow(/permitted/);
  expect(() => authorize(catalog, intent, { ...user, dimensions: [] }, states, now)).toThrow(/permitted/);
  expect(() => authorize(catalog, { ...intent, groupBy: 'status' }, user, states, now)).toThrow(/contract/);
  const draft = structuredClone(catalog); draft.metrics[0].status = 'draft';
  expect(() => authorize(draft, intent, user, states, now)).toThrow(/approval/);
});

