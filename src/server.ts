import Fastify from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z, ZodError } from 'zod';
import { PrincipalSchema, MetricSchema, loadCatalog, type Principal } from './contracts.js';
import { Gateway } from './gateway.js';
import { Reviews } from './reviews.js';
import { GateError } from './errors.js';
declare module 'fastify' { interface FastifyRequest { principal: Principal | null } }
export const AuthSchema = z.array(z.object({
  token: z.string().min(24).max(256), principal: PrincipalSchema,
}).strict()).min(1).max(20).superRefine((entries, ctx) => {
  if (new Set(entries.map(e => e.token)).size !== entries.length) ctx.addIssue({ code: 'custom', message: 'Duplicate token' });
});
export function createServer(gateway: Gateway, reviews: Reviews, authInput: unknown) {
  const auth = AuthSchema.parse(authInput).map(e => ({
    ...e, digest: createHash('sha256').update(e.token).digest(),
  }));
  const app = Fastify({ logger: false, bodyLimit: 8192 });
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const digest = createHash('sha256').update(token).digest();
    req.principal = auth.find(e => timingSafeEqual(e.digest, digest))?.principal ?? null;
    if (!req.principal) return reply.code(401).send({ code: 'unauthorized' });
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ code: 'invalid_input' });
    if (error instanceof GateError) return reply.code(error.code === 'permission' ? 403 : 422).send({ code: error.code, message: error.message });
    const status = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 500;
    return reply.code(status >= 400 && status < 500 ? status : 500).send({ code: status === 500 ? 'internal' : 'invalid_request' });
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.post('/plans', async (req, reply) => {
    const { question } = z.object({ question: z.string().trim().min(1).max(240) }).strict().parse(req.body);
    try { return { status: 'awaiting_approval', ...await gateway.plan(question, req.principal!) }; }
    catch (error) {
      if (!(error instanceof GateError)) throw error;
      const review = await reviews.add({
        requester: req.principal!.id, owner: gateway.getCatalog().sources[0].owner,
        question, reason: error.code,
      });
      return reply.code(422).send({ status: 'abstained', code: error.code, reviewId: review.id });
    }
  });
  app.post('/execute', async req => {
    const { id, approvalHash } = z.object({ id: z.uuid(), approvalHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(req.body);
    return gateway.execute(id, approvalHash, req.principal!);
  });
  app.get('/reviews', async req => ({ reviews: reviews.list(req.principal!) }));
  app.post('/reviews/:id/resolve', async req => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { status, note, effortMinutes } = z.object({
      status: z.enum(['accepted', 'rejected']), note: z.string().trim().min(1).max(1000),
      effortMinutes: z.number().min(0).max(480),
    }).strict().parse(req.body);
    return reviews.resolve(id, req.principal!, status, note, effortMinutes);
  });
  app.post('/proposals', async req => {
    const proposal = MetricSchema.parse(req.body);
    if (!req.principal!.roles.includes('analyst')) throw new GateError('permission', 'Only analysts can propose metrics');
    if (proposal.status !== 'draft') throw new GateError('unapproved', 'Proposals must be drafts');
    const source = gateway.getCatalog().sources.find(s => s.id === proposal.source);
    if (!source || source.owner !== proposal.owner) throw new GateError('owner', 'Proposal owner must match the registered source owner');
    const catalog = gateway.getCatalog();
    loadCatalog({ ...catalog, metrics: [...catalog.metrics.filter(m => m.id !== proposal.id), proposal] });
    return reviews.add({ requester: req.principal!.id, owner: source.owner, reason: 'metric_proposal', proposal });
  });
  app.addHook('onClose', async () => { try { await reviews.close(); } finally { await gateway.close(); } });
  return app;
}
