import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluate } from '../src/evaluation.js';
test('adversarial corpus passes through actual authenticated APIs and DuckDB', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ga-corpus-'));
  try {
    const report = await evaluate('fixtures', join(root, 'output'));
    expect(report.results).toHaveLength(22);
    expect(report.results.filter(r => !r.passed)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

