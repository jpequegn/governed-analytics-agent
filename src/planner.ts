import parserPackage from 'node-sql-parser';
import { z } from 'zod';
import { canonical, hash, loadCatalog, IntentSchema, type Catalog, type Intent } from './contracts.js';
import { GateError } from './errors.js';
const parser = new parserPackage.Parser();
export const PlanSchema = z.object({
  intent: IntentSchema, catalogHash: z.string().length(64), metricHash: z.string().length(64),
  sql: z.string().max(10000), params: z.array(z.string().max(80)).max(15),
  explanation: z.string(), source: z.string(), definition: z.string(), unit: z.string(),
}).strict();
export type Plan = z.infer<typeof PlanSchema>;
const quote = (name: string) => '"' + name + '"';

export function compile(raw: Catalog, input: Intent): Plan {
  const catalog = loadCatalog(raw);
  const intent = IntentSchema.parse(input);
  const m = catalog.metrics.find(m => m.id === intent.metric);
  if (!m || m.status !== 'approved') throw new GateError('unapproved', 'Cannot plan an unapproved metric');
  if ([intent.groupBy, ...intent.filters.map(f => f.column)].filter(Boolean).some(d => !m.dimensions.includes(d!))) {
    throw new GateError('dimension', 'Plan uses an unapproved dimension');
  }
  const source = catalog.sources.find(s => s.id === m.source)!;
  const op = m.operation;
  const expression = op.kind === 'count' ? 'COUNT(*)' : op.kind === 'sum' ?
    'SUM(' + quote(op.column) + ')' :
    'SUM(' + quote(op.numerator) + ') / NULLIF(SUM(' + quote(op.denominator) + '), 0)';
  const filters = [...m.requiredFilters, ...intent.filters];
  const group = intent.groupBy ? quote(intent.groupBy) : undefined;
  const sql = 'SELECT ' + (group ? group + ' AS dimension, ' : '') +
    'CAST(' + expression + ' AS DOUBLE) AS value, CAST(COUNT(*) AS DOUBLE) AS source_rows FROM ' +
    quote(source.table) + ' WHERE ' + filters.map((f, i) => quote(f.column) + ' = $' + (i + 1)).join(' AND ') +
    (group ? ' GROUP BY ' + group + ' ORDER BY ' + group : '') + ' LIMIT 101';
  return PlanSchema.parse({
    intent, catalogHash: hash(catalog), metricHash: hash(m), sql,
    params: filters.map(f => f.value), source: source.id, definition: m.definition, unit: m.unit,
    explanation: m.definition + ' Grain: ' + m.grain + '. Required filters: ' +
      m.requiredFilters.map(f => f.column + '=' + f.value).join(', ') +
      '. Joins prohibited. At most 100 result groups; larger results are refused.',
  });
}

export function validatePlan(catalog: Catalog, input: unknown): Plan {
  const candidate = PlanSchema.parse(input);
  const expected = compile(catalog, candidate.intent);
  try {
    const ast = parser.astify(candidate.sql, { database: 'Postgresql' });
    const target = parser.astify(expected.sql, { database: 'Postgresql' });
    if (Array.isArray(ast) || ast.type !== 'select' || canonical(ast) !== canonical(target)) {
      throw new Error('AST mismatch');
    }
  } catch {
    throw new GateError('unsafe_sql', 'SQL does not match the contract-derived SELECT');
  }
  if (canonical({ ...candidate, sql: expected.sql }) !== canonical(expected)) {
    throw new GateError('plan_changed', 'Plan metadata or parameters do not match the contract');
  }
  // Execute the regenerated SQL, never the caller-supplied serialization.
  return expected;
}

