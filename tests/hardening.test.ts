import { expect, test } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import raw from '../fixtures/catalog.json' with { type: 'json' };
import { loadCatalog, hash } from '../src/contracts.js';
import { compile } from '../src/planner.js';
import { buildSnapshot, Snapshot } from '../src/snapshot.js';
import { Gateway } from '../src/gateway.js';
import { replay } from '../src/replay.js';
const user = { id: 'alice', roles: ['analyst'], dimensions: ['city', 'country'] };
test('receipt replay catches serialization tampering and result changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ga-replay-'));
  try {
    await buildSnapshot('fixtures/orders.csv', join(root, 'db'), new Date().toISOString());
    const g = new Gateway(loadCatalog(raw), await Snapshot.open(join(root, 'db')));
    try {
      const plan = await g.plan('revenue', user); const receipt = await g.execute(plan.id, plan.approvalHash, user);
      expect((await replay(JSON.parse(JSON.stringify(receipt)), g.snapshot)).verified).toBe(true);
      await expect(replay({ ...receipt, rows: [{ value: 999, source_rows: 5 }] }, g.snapshot)).rejects.toThrow(/identity/);
      const { status, receiptHash, ...changed } = { ...receipt, rows: [{ value: 999, source_rows: 5 }] };
      await expect(replay({ status, ...changed, receiptHash: hash(changed) }, g.snapshot)).rejects.toThrow(/Replayed/);
    } finally { await g.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('freshness is rechecked during the approval window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ga-expire-'));
  let now = new Date('2026-09-07T12:00:00Z');
  try {
    await buildSnapshot('fixtures/orders.csv', join(root, 'db'), '2026-09-06T12:01:00Z');
    const g = new Gateway(loadCatalog(raw), await Snapshot.open(join(root, 'db')), undefined, () => now);
    try {
      const p = await g.plan('revenue', user); now = new Date('2026-09-07T12:02:00Z');
      await expect(g.execute(p.id, p.approvalHash, user)).rejects.toThrow(/SLA/);
    } finally { await g.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('overflow aggregates and oversized result groups fail instead of misleading', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ga-bounds-'));
  try {
    const csv = join(root, 'source.csv');
    await writeFile(csv, 'id,city,country,status,amount,units\n' + Array.from({ length: 102 }, (_, i) => i + ',City' + i + ',US,paid,1e308,1').join('\n') + '\n');
    await buildSnapshot(csv, join(root, 'db'), new Date().toISOString());
    const s = await Snapshot.open(join(root, 'db'));
    try {
      await expect(s.execute(loadCatalog(raw), compile(loadCatalog(raw), { metric: 'revenue', filters: [] }))).rejects.toThrow(/Nonfinite/);
      await expect(s.execute(loadCatalog(raw), compile(loadCatalog(raw), { metric: 'order_count', groupBy: 'city', filters: [] }))).rejects.toThrow(/100 groups/);
    } finally { await s.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('mismatched engine metadata and malformed sources are refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ga-version-'));
  try {
    await buildSnapshot('fixtures/orders.csv', join(root, 'db'), new Date().toISOString());
    const path = join(root, 'db', 'manifest.json');
    const manifest = JSON.parse(await readFile(path, 'utf8')); manifest.engine = 'v0.0.0';
    await writeFile(path, JSON.stringify(manifest));
    await expect(Snapshot.open(join(root, 'db'))).rejects.toThrow(/engine/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
