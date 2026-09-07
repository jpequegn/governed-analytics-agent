import { z } from 'zod';
import { loadCatalog, IntentSchema, PrincipalSchema, type Catalog, type Intent, type Principal } from './contracts.js';
import { GateError } from './errors.js';

export const SourceStates = z.record(z.string(), z.object({ updatedAt: z.iso.datetime({ offset: true }) }).strict());
export type SourceState = z.infer<typeof SourceStates>;

export function resolveQuestion(catalog: Catalog, question: string): Intent {
  if (typeof question !== 'string' || question.length > 240) throw new GateError('unsupported', 'Question must be at most 240 characters');
  const text = question.trim().replace(/\?$/, '');
  const match = /^(?:show )?([a-z ]+?)(?: by ([a-z_]+))?(?: where ([a-z_]+) = "([^"\r\n]{1,80})")?$/i.exec(text);
  if (!match) throw new GateError('unsupported', 'Use: show <metric> [by <dimension>] [where <dimension> = "<value>"]');
  const alias = match[1].trim().toLowerCase();
  const candidates = catalog.metrics.filter(m => m.aliases.includes(alias) || m.id === alias);
  if (!candidates.length) throw new GateError('unknown_metric', 'No approved metric definition matches this question');
  if (candidates.length > 1) throw new GateError('ambiguous', 'Metric name matches multiple definitions');
  return IntentSchema.parse({ metric: candidates[0].id, groupBy: match[2]?.toLowerCase(),
    filters: match[3] ? [{ column: match[3].toLowerCase(), value: match[4] }] : [] });
}

export function authorize(raw: Catalog, rawIntent: Intent, rawPrincipal: Principal, rawStates: SourceState, now: Date) {
  const catalog = loadCatalog(raw);
  const intent = IntentSchema.parse(rawIntent);
  const principal = PrincipalSchema.parse(rawPrincipal);
  const states = SourceStates.parse(rawStates);
  const metric = catalog.metrics.find(m => m.id === intent.metric);
  if (!metric) throw new GateError('unknown_metric', 'Metric does not exist');
  if (metric.status !== 'approved') throw new GateError('unapproved', 'Metric requires owner approval');
  if (!metric.roles.some(r => principal.roles.includes(r))) throw new GateError('permission', 'Metric is not permitted');
  const dimensions = [...(intent.groupBy ? [intent.groupBy] : []), ...intent.filters.map(f => f.column)];
  if (dimensions.some(d => !metric.dimensions.includes(d))) throw new GateError('dimension', 'Dimension is not in this metric contract');
  if (dimensions.some(d => !principal.dimensions.includes(d))) throw new GateError('permission', 'Dimension is not permitted');
  const source = catalog.sources.find(s => s.id === metric.source)!;
  const state = states[source.id];
  if (!state) throw new GateError('missing_freshness', 'No source freshness evidence');
  const ageMs = now.getTime() - Date.parse(state.updatedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) throw new GateError('invalid_time', 'Source or evaluation time is invalid or in the future');
  if (ageMs > source.freshnessHours * 3600000) throw new GateError('stale', 'Source exceeds its freshness SLA');
  return { metric, source, intent, freshness: { updatedAt: state.updatedAt, checkedAt: now.toISOString(), ageMs, slaHours: source.freshnessHours } };
}

