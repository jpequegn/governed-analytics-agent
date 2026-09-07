import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { hash, loadCatalog } from './contracts.js';
import { buildSnapshot, Snapshot } from './snapshot.js';
import { Gateway } from './gateway.js';
import { Reviews } from './reviews.js';
import { createServer } from './server.js';
const Case = z.object({
  id: z.string(), question: z.string(), scenario: z.enum(['stale', 'future', 'missing', 'ambiguous', 'draft', 'guest', 'no_city']).optional(),
  code: z.string().optional(), expectedRows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))).optional(),
}).strict().refine(c => Boolean(c.code) !== Boolean(c.expectedRows), 'Exactly one expected outcome');
export async function evaluate(fixtureDirectory: string, output: string) {
  const cases = z.array(Case).parse(JSON.parse(await readFile(join(fixtureDirectory, 'eval-cases.json'), 'utf8')));
  const base = loadCatalog(JSON.parse(await readFile(join(fixtureDirectory, 'catalog.json'), 'utf8')));
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  await mkdir(output, { recursive: false, mode: 0o700 });
  const temp = await mkdtemp(join(tmpdir(), 'ga-eval-'));
  const results: Record<string, unknown>[] = [];
  const now = new Date('2026-09-07T12:00:00Z');
  try {
    for (const item of cases) {
      const directory = join(temp, item.id);
      const updatedAt = item.scenario === 'stale' ? '2026-09-01T00:00:00Z' :
        item.scenario === 'future' ? '2026-09-08T00:00:00Z' : now.toISOString();
      await buildSnapshot(join(fixtureDirectory, 'orders.csv'), directory, updatedAt);
      if (item.scenario === 'missing') {
        const path = join(directory, 'manifest.json');
        const manifest = JSON.parse(await readFile(path, 'utf8')); manifest.sources = {};
        await writeFile(path, JSON.stringify(manifest));
      }
      const catalog = structuredClone(base);
      if (item.scenario === 'ambiguous') catalog.metrics[1].aliases.push('revenue');
      if (item.scenario === 'draft') catalog.metrics[0].status = 'draft';
      const principal = { id: 'eval_user', roles: [item.scenario === 'guest' ? 'guest' : 'analyst'],
        dimensions: item.scenario === 'no_city' ? [] : ['city', 'country'] };
      const gateway = new Gateway(catalog, await Snapshot.open(directory), undefined, () => now);
      const queue = await Reviews.open(join(directory, 'reviews.json'));
      const token = 'offline-evaluation-token-0001';
      const app = createServer(gateway, queue, [{ token, principal }]);
      const headers = { authorization: 'Bearer ' + token };
      try {
        const response = await app.inject({ method: 'POST', url: '/plans', headers, payload: { question: item.question } });
        const offered = response.json();
        let actual: unknown = offered.code;
        let definitionAdherent: boolean | null = null;
        if (response.statusCode === 200) {
          const answer = await app.inject({ method: 'POST', url: '/execute', headers,
            payload: { id: offered.id, approvalHash: offered.approvalHash } });
          if (answer.statusCode !== 200) throw new Error('Unexpected execution error in ' + item.id);
          const receipt = answer.json();
          actual = receipt.rows;
          definitionAdherent = receipt.catalogHash === hash(catalog) && receipt.plan.params[0] === 'paid';
          await writeFile(join(output, item.id + '.receipt.json'), JSON.stringify(receipt, null, 2));
        }
        const expected = item.code ?? item.expectedRows;
        results.push({
          id: item.id, question: item.question, scenario: item.scenario ?? 'standard',
          expected, actual, expectedAnswer: Boolean(item.expectedRows),
          answered: response.statusCode === 200, passed: hash(expected) === hash(actual),
          definitionAdherent, reviewCount: queue.list(principal).length,
        });
      } finally { await app.close(); }
    }
    const report = { version: 1, corpusHash: hash(cases), catalogHash: hash(base), results };
    await writeFile(join(output, 'evaluation.json'), JSON.stringify(report, null, 2));
    return report;
  } finally { await rm(temp, { recursive: true, force: true }); }
}
