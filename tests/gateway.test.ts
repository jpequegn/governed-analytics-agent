import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import raw from '../fixtures/catalog.json' with { type: 'json' };
import { loadCatalog, hash } from '../src/contracts.js';
import { buildSnapshot, Snapshot } from '../src/snapshot.js';
import { Gateway } from '../src/gateway.js';
const roots: string[] = []; const gateways: Gateway[] = [];
const user = { id: 'alice', roles: ['analyst'], dimensions: ['city', 'country'] };
afterEach(async () => { for (const g of gateways.splice(0)) await g.close(); for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true }); });
async function setup() {
  let now = new Date('2026-09-07T12:00:00Z');
  const root = await mkdtemp(join(tmpdir(), 'ga-gateway-')); roots.push(root);
  await buildSnapshot('fixtures/orders.csv', join(root, 'db'), now.toISOString());
  const g = new Gateway(loadCatalog(raw), await Snapshot.open(join(root, 'db')), undefined, () => now);
  gateways.push(g); return { g, advance: () => { now = new Date(now.getTime() + 360000); } };
}
test('explicit approval yields a reproducible receipt and telemetry', async () => {
  const { g } = await setup();
  const p = await g.plan('revenue by city', user);
  await expect(g.execute(p.id, 'wrong', user)).rejects.toThrow(/exact/);
  const receipt = await g.execute(p.id, p.approvalHash, user);
  expect(receipt.rows).toEqual([{ dimension: 'Boston', value: 200, source_rows: 1 }, { dimension: 'London', value: 120, source_rows: 2 }, { dimension: 'NYC', value: 400, source_rows: 2 }]);
  const { status, receiptHash, ...evidence } = receipt;
  expect(hash(evidence)).toBe(receiptHash);
  expect(hash(JSON.parse(JSON.stringify(evidence)))).toBe(receiptHash);
  expect((await g.telemetry.records()).map(x => x.name)).toContain('duckdb.execute');
  await expect(g.execute(p.id, p.approvalHash, user)).rejects.toThrow(/consumed/);
});
test('cross-user execution and revoked permissions fail', async () => {
  const { g } = await setup(); const p = await g.plan('revenue', user);
  await expect(g.execute(p.id, p.approvalHash, { ...user, id: 'bob' })).rejects.toThrow(/another/);
  await expect(g.execute(p.id, p.approvalHash, { ...user, roles: ['guest'] })).rejects.toThrow(/permitted/);
});
test('changed contracts and expired approvals require replanning', async () => {
  const { g, advance } = await setup();
  const p = await g.plan('revenue', user);
  g.replaceCatalog({ ...raw, version: 2 });
  await expect(g.execute(p.id, p.approvalHash, user)).rejects.toThrow(/match/);
  const newer = await g.plan('revenue', user); advance();
  await expect(g.execute(newer.id, newer.approvalHash, user)).rejects.toThrow(/expired/);
});
test('caller mutation of offered plans does not change stored execution', async () => {
  const { g } = await setup(); const p = await g.plan('revenue', user);
  p.plan.params[0] = 'cancelled'; p.plan.sql = 'DROP TABLE orders';
  expect((await g.execute(p.id, p.approvalHash, user)).rows[0].value).toBe(720);
});
