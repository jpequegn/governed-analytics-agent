import { z } from 'zod';
import { CatalogSchema, hash } from './contracts.js';
import { PlanSchema, validatePlan } from './planner.js';
import { ManifestSchema, Snapshot } from './snapshot.js';
import { GateError } from './errors.js';
const Receipt = z.object({
  status: z.literal('answered'), receiptHash: z.string().length(64),
  catalog: CatalogSchema, catalogHash: z.string().length(64),
  snapshot: ManifestSchema, snapshotHash: z.string().length(64),
  plan: PlanSchema,
  rows: z.array(z.record(z.string(), z.union([z.number().finite(), z.string(), z.null()]))),
}).passthrough();
export async function replay(input: unknown, snapshot: Snapshot) {
  const parsed = Receipt.parse(input);
  const { status, receiptHash, ...evidence } = parsed;
  if (hash(evidence) !== receiptHash || hash(parsed.catalog) !== parsed.catalogHash ||
      hash(parsed.snapshot) !== parsed.snapshotHash || hash(snapshot.manifest) !== parsed.snapshotHash) {
    throw new GateError('receipt_changed', 'Receipt or snapshot identity does not match');
  }
  const plan = validatePlan(parsed.catalog, parsed.plan);
  const rows = await snapshot.execute(parsed.catalog, plan);
  if (hash(rows) !== hash(parsed.rows)) throw new GateError('result_changed', 'Replayed results differ');
  return { verified: true, rows: rows.length, receiptHash };
}

