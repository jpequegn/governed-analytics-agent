import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Identifier, MetricSchema, type Metric, type Principal } from './contracts.js';
import { GateError } from './errors.js';
const ReviewSchema = z.object({
  id: z.uuid(), requester: Identifier, owner: Identifier,
  kind: z.enum(['question', 'proposal']), reason: z.string().max(100),
  question: z.string().max(240).optional(), proposal: MetricSchema.optional(),
  createdAt: z.iso.datetime(), status: z.enum(['pending', 'accepted', 'rejected']),
  resolution: z.object({
    reviewer: Identifier, note: z.string().min(1).max(1000),
    effortMinutes: z.number().min(0).max(480), resolvedAt: z.iso.datetime(),
  }).strict().optional(),
}).strict();
type Review = z.infer<typeof ReviewSchema>;
export class Reviews {
  private tail: Promise<unknown> = Promise.resolve();
  private constructor(private path: string, private rows: Review[]) {}
  static async open(path: string) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const lock = await open(path + '.lock', 'wx', 0o600);
    await lock.close();
    try {
      let rows: Review[] = [];
      try {
        if ((await stat(path)).size > 4 * 1024 * 1024) throw new GateError('capacity', 'Review ledger too large');
        rows = z.array(ReviewSchema).max(1000).parse(JSON.parse(await readFile(path, 'utf8')));
        if (new Set(rows.map(r => r.id)).size !== rows.length) throw new GateError('invalid_ledger', 'Duplicate review IDs');
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
      return new Reviews(path, rows);
    } catch (e) { await rm(path + '.lock'); throw e; }
  }
  private mutate<T>(work: (rows: Review[]) => T): Promise<T> {
    const operation = this.tail.then(async () => {
      const next = structuredClone(this.rows);
      const result = work(next);
      if (next.length > 1000) throw new GateError('capacity', 'Review queue full');
      const content = JSON.stringify(next, null, 2);
      if (Buffer.byteLength(content) > 4 * 1024 * 1024) throw new GateError('capacity', 'Review ledger too large');
      const temp = this.path + '.' + randomUUID() + '.tmp';
      try {
        const file = await open(temp, 'wx', 0o600);
        try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
        await rename(temp, this.path);
      } finally { await rm(temp, { force: true }); }
      this.rows = next;
      return structuredClone(result);
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  add(input: { requester: string; owner: string; reason: string; question?: string; proposal?: Metric }) {
    const review = ReviewSchema.parse({
      ...input, id: randomUUID(), kind: input.proposal ? 'proposal' : 'question',
      status: 'pending', createdAt: new Date().toISOString(),
    });
    return this.mutate(rows => { rows.push(review); return review; });
  }
  list(principal: Principal) {
    return structuredClone(this.rows.filter(r => r.requester === principal.id ||
      (principal.roles.includes('reviewer') && r.owner === principal.id)));
  }
  resolve(id: string, principal: Principal, status: 'accepted' | 'rejected', note: string, effortMinutes: number) {
    return this.mutate(rows => {
      const review = rows.find(r => r.id === id);
      if (!review) throw new GateError('unknown_review', 'Review not found');
      if (!principal.roles.includes('reviewer') || principal.id !== review.owner || principal.id === review.requester) {
        throw new GateError('permission', 'Only the independent designated owner can resolve this review');
      }
      if (review.status !== 'pending') throw new GateError('resolved', 'Review already resolved');
      const updated = ReviewSchema.parse({
        ...review, status, resolution: { reviewer: principal.id, note, effortMinutes, resolvedAt: new Date().toISOString() },
      });
      Object.assign(review, updated); return review;
    });
  }
  async close() { await this.tail; await rm(this.path + '.lock'); }
}
