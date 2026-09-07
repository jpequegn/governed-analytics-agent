import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DuckDBInstance } from '@duckdb/node-api';
import { z } from 'zod';
import { type Catalog } from './contracts.js';
import { GateError } from './errors.js';
import { validatePlan } from './planner.js';
import { SourceStates } from './resolver.js';

const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
export const ManifestSchema = z.object({
  version: z.literal(1), databaseHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.iso.datetime({ offset: true }),
  sources: SourceStates, engine: z.string().min(1), synthetic: z.literal(true),
}).strict();
export type Manifest = z.infer<typeof ManifestSchema>;
async function boundedRead(path: string, max = 64 * 1024 * 1024) {
  if ((await stat(path)).size > max) throw new GateError('size_limit', 'Snapshot exceeds local size limit');
  const bytes = await readFile(path);
  if (bytes.length > max) throw new GateError('size_limit', 'Snapshot exceeds local size limit');
  return bytes;
}

export async function buildSnapshot(csv: string, output: string, sourceUpdatedAt: string): Promise<Manifest> {
  SourceStates.parse({ orders: { updatedAt: sourceUpdatedAt } });
  const source = await boundedRead(csv, 16 * 1024 * 1024);
  await mkdir(output, { recursive: false, mode: 0o700 });
  await writeFile(join(output, 'source.csv'), source, { flag: 'wx', mode: 0o600 });
  const db = await DuckDBInstance.create(join(output, 'analytics.duckdb'));
  let engine = '';
  try {
    const con = await db.connect();
    try {
      await con.run("CREATE TABLE orders AS SELECT * FROM read_csv($1, header=true, columns={'id':'BIGINT','city':'VARCHAR','country':'VARCHAR','status':'VARCHAR','amount':'DOUBLE','units':'DOUBLE'})", [join(output, 'source.csv')]);
      const bad = await con.runAndReadAll('SELECT COUNT(*) AS n FROM orders WHERE id IS NULL OR city IS NULL OR country IS NULL OR status IS NULL OR amount IS NULL OR units IS NULL OR NOT isfinite(amount) OR NOT isfinite(units) OR units < 0 OR amount < 0');
      if (Number(bad.getRowObjects()[0].n) !== 0) throw new GateError('invalid_source', 'Synthetic rows must be complete, finite and nonnegative');
      const count = await con.runAndReadAll('SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS unique_n FROM orders');
      const row = count.getRowObjects()[0];
      if (row.n !== row.unique_n || Number(row.n) > 100000) throw new GateError('invalid_source', 'Duplicate IDs or too many rows');
      engine = String((await con.runAndReadAll('SELECT version() AS version')).getRowObjects()[0].version);
      await con.run('CHECKPOINT');
    } finally { con.closeSync(); }
  } finally { db.closeSync(); }
  const manifest = ManifestSchema.parse({
    version: 1, databaseHash: digest(await boundedRead(join(output, 'analytics.duckdb'))),
    sourceHash: digest(source), sources: { orders: { updatedAt: sourceUpdatedAt } },
    createdAt: new Date().toISOString(), engine, synthetic: true,
  });
  await writeFile(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  return manifest;
}

export class Snapshot {
  private constructor(
    readonly manifest: Manifest,
    private readonly db: DuckDBInstance,
    private readonly directory: string,
  ) {}
  static async open(directory: string): Promise<Snapshot> {
    const manifest = ManifestSchema.parse(JSON.parse((await boundedRead(join(directory, 'manifest.json'), 100000)).toString()));
    const bytes = await boundedRead(join(directory, 'analytics.duckdb'));
    if (digest(bytes) !== manifest.databaseHash ||
        digest(await boundedRead(join(directory, 'source.csv'), 16 * 1024 * 1024)) !== manifest.sourceHash) {
      throw new GateError('snapshot_changed', 'Snapshot hash does not match its manifest');
    }
    const pinned = await mkdtemp(join(tmpdir(), 'governed-snapshot-'));
    try {
      const path = join(pinned, 'analytics.duckdb');
      await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
      const db = await DuckDBInstance.create(path, {
        access_mode: 'READ_ONLY', enable_external_access: 'false',
        allow_unsigned_extensions: 'false', autoload_known_extensions: 'false',
        autoinstall_known_extensions: 'false', threads: '1', memory_limit: '128MB',
      });
      return new Snapshot(manifest, db, pinned);
    } catch (error) { await rm(pinned, { recursive: true, force: true }); throw error; }
  }
  async execute(catalog: Catalog, input: unknown) {
    const plan = validatePlan(catalog, input);
    const con = await this.db.connect();
    const timer = setTimeout(() => con.interrupt(), 2000);
    try {
      const reader = await con.runAndReadAll(plan.sql, plan.params);
      const rows = reader.getRowObjectsJson();
      if (rows.length > 100) throw new GateError('row_limit', 'More than 100 groups; narrow the question');
      for (const row of rows) {
        if (typeof row.value === 'number' && !Number.isFinite(row.value)) throw new GateError('invalid_result', 'Nonfinite metric result');
      }
      return rows;
    } finally { clearTimeout(timer); con.closeSync(); }
  }
  async close() { this.db.closeSync(); await rm(this.directory, { recursive: true, force: true }); }
}

