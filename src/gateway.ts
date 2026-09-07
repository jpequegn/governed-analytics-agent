import { randomUUID } from 'node:crypto';
import { hash, loadCatalog, type Catalog, type Principal } from './contracts.js';
import { authorize, resolveQuestion } from './resolver.js';
import { compile, validatePlan, type Plan } from './planner.js';
import { Snapshot } from './snapshot.js';
import { Telemetry } from './telemetry.js';
import { GateError } from './errors.js';

type OfferedPlan = {
  id: string; approvalHash: string; principalId: string; createdAt: string; expiresAt: string;
  snapshotHash: string; plan: Plan;
};
export class Gateway {
  private catalog: Catalog;
  private pending = new Map<string, OfferedPlan>();
  constructor(catalog: Catalog, readonly snapshot: Snapshot, readonly telemetry = new Telemetry(),
    private clock: () => Date = () => new Date()) { this.catalog = loadCatalog(catalog); }
  replaceCatalog(input: unknown) { this.catalog = loadCatalog(input); }
  getCatalog() { return structuredClone(this.catalog); }
  async plan(question: string, principal: Principal): Promise<OfferedPlan> {
    const now = this.clock();
    for (const [id, p] of this.pending) if (Date.parse(p.expiresAt) <= now.getTime()) this.pending.delete(id);
    const intent = await this.telemetry.observe('question.resolve', () => resolveQuestion(this.catalog, question));
    await this.telemetry.observe('catalog.gates', () => authorize(this.catalog, intent, principal, this.snapshot.manifest.sources, now));
    const plan = await this.telemetry.observe('sql.plan', () => compile(this.catalog, intent));
    if (this.pending.size >= 100) throw new GateError('capacity', 'Pending plan limit reached');
    const details = {
      id: randomUUID(), principalId: principal.id, createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 5 * 60000).toISOString(),
      snapshotHash: hash(this.snapshot.manifest), plan,
    };
    const offered = { ...details, approvalHash: hash(details) };
    this.pending.set(offered.id, structuredClone(offered));
    return structuredClone(offered);
  }
  async execute(id: string, approvalHash: string, principal: Principal) {
    const offered = this.pending.get(id);
    if (!offered) throw new GateError('unknown_plan', 'Plan is absent or already consumed');
    if (offered.principalId !== principal.id) throw new GateError('permission', 'Plan belongs to another principal');
    if (offered.approvalHash !== approvalHash) throw new GateError('approval', 'Approve the exact offered plan hash');
    this.pending.delete(id);
    const now = this.clock();
    if (Date.parse(offered.expiresAt) <= now.getTime() || now.getTime() < Date.parse(offered.createdAt)) {
      throw new GateError('expired', 'Plan expired or clock moved backwards');
    }
    const catalog = this.getCatalog();
    if (offered.snapshotHash !== hash(this.snapshot.manifest)) throw new GateError('snapshot_changed', 'Snapshot metadata changed');
    const checked = await this.telemetry.observe('execution.gates', () =>
      authorize(catalog, offered.plan.intent, principal, this.snapshot.manifest.sources, now));
    const plan = validatePlan(catalog, offered.plan);
    const rows = await this.telemetry.observe('duckdb.execute', () => this.snapshot.execute(catalog, plan));
    return this.telemetry.observe('answer.validate', () => {
      const evidence = {
        schemaVersion: 1, planId: id, principalId: principal.id, approvalHash,
        approvedAt: now.toISOString(), completedAt: this.clock().toISOString(),
        catalog, catalogHash: hash(catalog), metricHash: plan.metricHash,
        snapshot: structuredClone(this.snapshot.manifest), snapshotHash: offered.snapshotHash,
        plan, rows, returnedRows: rows.length, freshness: checked.freshness,
        citations: [
          { kind: 'metric', id: checked.metric.id, version: checked.metric.version, owner: checked.metric.owner, definition: checked.metric.definition },
          { kind: 'source', id: checked.source.id, table: checked.source.table, owner: checked.source.owner, lineage: checked.source.lineage },
          { kind: 'query', sql: plan.sql, params: plan.params },
        ],
        caveats: [
          'Synthetic data; not a production financial result.',
          'Null means no matching values or an undefined zero-denominator ratio, not zero.',
          'Numeric aggregates use double precision; joins are prohibited.',
          'Hashes detect accidental changes, not a malicious operator replacing all artifacts.',
        ],
      };
      return { status: 'answered' as const, ...evidence, receiptHash: hash(evidence) };
    });
  }
  async close() { await this.telemetry.close(); await this.snapshot.close(); }
}

