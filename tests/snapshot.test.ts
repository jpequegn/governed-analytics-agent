import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import raw from '../fixtures/catalog.json' with { type: 'json' };
import { loadCatalog } from '../src/contracts.js';
import { compile } from '../src/planner.js';
import { buildSnapshot, Snapshot } from '../src/snapshot.js';
const c = loadCatalog(raw);
const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function setup(csv = 'fixtures/orders.csv') {
  const root = await mkdtemp(join(tmpdir(), 'ga-test-')); dirs.push(root);
  const path = join(root, 'snapshot');
  await buildSnapshot(csv, path, '2026-09-07T00:00:00Z');
  return path;
}
test('real DuckDB answers exclude cancelled orders and preserve ratio denominator', async () => {
  const snapshot = await Snapshot.open(await setup());
  try {
    expect(await snapshot.execute(c, compile(c, { metric: 'revenue', filters: [] }))).toEqual([{ value: 720, source_rows: 5 }]);
    expect(await snapshot.execute(c, compile(c, { metric: 'unit_price', filters: [] }))).toEqual([{ value: 720 / 7, source_rows: 5 }]);
    expect(await snapshot.execute(c, compile(c, { metric: 'revenue', filters: [{ column: 'city', value: 'NYC' }] }))).toEqual([{ value: 400, source_rows: 2 }]);
    expect(await snapshot.execute(c, compile(c, { metric: 'revenue', filters: [{ column: 'city', value: "' OR 1=1 --" }] }))).toEqual([{ value: null, source_rows: 0 }]);
  } finally { await snapshot.close(); }
});
test('tampered snapshot rejected, existing output never overwritten', async () => {
  const path = await setup();
  await expect(buildSnapshot('fixtures/orders.csv', path, '2026-09-07T00:00:00Z')).rejects.toThrow();
  await writeFile(join(path, 'analytics.duckdb'), 'tampered');
  await expect(Snapshot.open(path)).rejects.toThrow(/hash/);
});
test('database configuration itself rejects writes and external reads', async () => {
  const path = await setup();
  const db = await DuckDBInstance.create(join(path, 'analytics.duckdb'), { access_mode: 'READ_ONLY', enable_external_access: 'false' });
  const con = await db.connect();
  try {
    await expect(con.run('DELETE FROM orders')).rejects.toThrow();
    await expect(con.run("SELECT * FROM read_csv_auto('/etc/passwd')")).rejects.toThrow();
  } finally { con.closeSync(); db.closeSync(); }
});
test('zero denominator is null and pinned copy survives original mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ga-zero-')); dirs.push(root);
  const csv = join(root, 'zero.csv');
  await writeFile(csv, 'id,city,country,status,amount,units\n1,Empty,US,paid,0,0\n');
  const path = await setup(csv);
  const snapshot = await Snapshot.open(path);
  try {
    await writeFile(join(path, 'analytics.duckdb'), 'changed after pinning');
    expect(await snapshot.execute(c, compile(c, { metric: 'unit_price', filters: [] }))).toEqual([{ value: null, source_rows: 1 }]);
  } finally { await snapshot.close(); }
});
