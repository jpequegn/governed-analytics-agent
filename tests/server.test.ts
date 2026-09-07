import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import raw from '../fixtures/catalog.json' with { type: 'json' };
import { loadCatalog } from '../src/contracts.js';
import { buildSnapshot, Snapshot } from '../src/snapshot.js';
import { Gateway } from '../src/gateway.js';
import { Reviews } from '../src/reviews.js';
import { createServer } from '../src/server.js';
const analyst = { id: 'alice', roles: ['analyst'], dimensions: ['city', 'country'] };
const owner = { id: 'analytics', roles: ['reviewer'], dimensions: [] };
const auth = [{ token: 'a'.repeat(32), principal: analyst }, { token: 'b'.repeat(32), principal: owner }];
const headers = { authorization: 'Bearer ' + auth[0].token };
const ownerHeaders = { authorization: 'Bearer ' + auth[1].token };
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'ga-server-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await buildSnapshot('fixtures/orders.csv', join(root, 'db'), new Date().toISOString());
  const g = new Gateway(loadCatalog(raw), await Snapshot.open(join(root, 'db')));
  const reviews = await Reviews.open(join(root, 'reviews.json'));
  const app = createServer(g, reviews, auth); cleanups.push(() => app.close());
  return { app, reviews, root };
}
test('API authenticates and prevents caller-chosen roles', async () => {
  const { app } = await setup();
  expect((await app.inject({ method: 'POST', url: '/plans', payload: { question: 'revenue' } })).statusCode).toBe(401);
  expect((await app.inject({ method: 'POST', url: '/plans', headers, payload: { question: 'revenue', roles: ['admin'] } })).statusCode).toBe(400);
  const plan = await app.inject({ method: 'POST', url: '/plans', headers, payload: { question: 'revenue' } });
  expect(plan.statusCode).toBe(200); const p = plan.json();
  const result = await app.inject({ method: 'POST', url: '/execute', headers, payload: { id: p.id, approvalHash: p.approvalHash } });
  expect(result.json().rows).toEqual([{ value: 720, source_rows: 5 }]);
});
test('abstentions enter a private, owner-reviewed queue', async () => {
  const { app } = await setup();
  const refused = await app.inject({ method: 'POST', url: '/plans', headers, payload: { question: 'profit last month' } });
  expect(refused.statusCode).toBe(422);
  const id = refused.json().reviewId;
  const payload = { status: 'rejected', note: 'No approved profit definition', effortMinutes: 2 };
  expect((await app.inject({ method: 'POST', url: '/reviews/' + id + '/resolve', headers, payload })).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/reviews/' + id + '/resolve', headers: ownerHeaders, payload })).json().status).toBe('rejected');
  expect((await app.inject({ method: 'GET', url: '/reviews', headers })).json().reviews).toHaveLength(1);
});
test('review storage survives reopen, refuses second writer and serializes updates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ga-ledger-')); cleanups.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'reviews.json'); const q = await Reviews.open(path);
  await expect(Reviews.open(path)).rejects.toThrow();
  await Promise.all([1, 2].map(n => q.add({ requester: 'alice', owner: 'analytics', reason: 'unknown_metric', question: 'metric ' + n })));
  expect(q.list({ id: 'bob', roles: ['analyst'], dimensions: [] })).toHaveLength(0);
  await q.close(); const next = await Reviews.open(path);
  expect(next.list(analyst)).toHaveLength(2); await next.close();
});
test('accepted proposal does not automatically promote a metric', async () => {
  const { app } = await setup();
  const response = await app.inject({ method: 'POST', url: '/proposals', headers, payload: { ...raw.metrics[0], id: 'new_metric', aliases: ['new metric'], status: 'draft' } });
  expect(response.statusCode).toBe(200);
  await app.inject({ method: 'POST', url: '/reviews/' + response.json().id + '/resolve', headers: ownerHeaders, payload: { status: 'accepted', note: 'Ready for catalog PR', effortMinutes: 3 } });
  expect((await app.inject({ method: 'POST', url: '/plans', headers, payload: { question: 'new metric' } })).statusCode).toBe(422);
});

