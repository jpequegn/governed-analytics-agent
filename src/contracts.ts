import { createHash } from 'node:crypto';
import { z } from 'zod';

export const Identifier = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);
const Text = z.string().trim().min(1).max(500);
const Filter = z.object({ column: Identifier, value: z.string().min(1).max(80) }).strict();
const Operation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('count') }).strict(),
  z.object({ kind: z.literal('sum'), column: Identifier }).strict(),
  z.object({ kind: z.literal('ratio'), numerator: Identifier, denominator: Identifier }).strict(),
]);
export const SourceSchema = z.object({
  id: Identifier, table: Identifier, owner: Identifier,
  columns: z.record(Identifier, z.enum(['text', 'number'])),
  lineage: z.array(Text).min(1).max(20), freshnessHours: z.number().positive().max(8760),
}).strict();
export const MetricSchema = z.object({
  id: Identifier, version: z.number().int().positive(), aliases: z.array(z.string().regex(/^[a-z][a-z ]{0,60}$/)).min(1),
  definition: Text, owner: Identifier, grain: Text, source: Identifier,
  status: z.enum(['approved', 'draft']), roles: z.array(Identifier).min(1),
  dimensions: z.array(Identifier).max(5), requiredFilters: z.array(Filter).min(1).max(10),
  operation: Operation, unit: Text, joins: z.literal('forbidden'),
}).strict();
export const CatalogSchema = z.object({
  version: z.number().int().positive(), sources: z.array(SourceSchema).min(1).max(20),
  metrics: z.array(MetricSchema).min(1).max(100),
}).strict().superRefine((c, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  for (const key of ['sources', 'metrics'] as const) {
    if (new Set(c[key].map(x => x.id)).size !== c[key].length) issue('Duplicate ' + key);
  }
  if (new Set(c.sources.map(x => x.table)).size !== c.sources.length) issue('Duplicate source tables');
  for (const m of c.metrics) {
    const source = c.sources.find(s => s.id === m.source);
    if (!source) { issue('Unknown metric source'); continue; }
    if (new Set(m.dimensions).size !== m.dimensions.length) issue('Duplicate dimensions');
    for (const d of m.dimensions) if (source.columns[d] !== 'text') issue('Dimension must be a declared text column');
    for (const f of m.requiredFilters) if (source.columns[f.column] !== 'text') issue('Filter must use a declared text column');
    const numeric = m.operation.kind === 'sum' ? [m.operation.column] :
      m.operation.kind === 'ratio' ? [m.operation.numerator, m.operation.denominator] : [];
    for (const col of numeric) if (source.columns[col] !== 'number') issue('Operation requires a numeric column');
  }
});
export const PrincipalSchema = z.object({
  id: Identifier, roles: z.array(Identifier).min(1), dimensions: z.array(Identifier).max(20),
}).strict();
export const IntentSchema = z.object({
  metric: Identifier, groupBy: Identifier.optional(),
  filters: z.array(Filter).max(5).default([]),
}).strict();
export type Catalog = z.infer<typeof CatalogSchema>;
export type Metric = z.infer<typeof MetricSchema>;
export type Principal = z.infer<typeof PrincipalSchema>;
export type Intent = z.infer<typeof IntentSchema>;

// Stable key ordering preserves array order while making object serialization deterministic.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  }
  return JSON.stringify(value);
}
export function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
export function loadCatalog(input: unknown): Catalog { return CatalogSchema.parse(input); }

