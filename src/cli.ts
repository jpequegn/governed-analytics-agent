import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadCatalog } from './contracts.js';
import { buildSnapshot, Snapshot } from './snapshot.js';
import { Gateway } from './gateway.js';
import { Reviews } from './reviews.js';
import { AuthSchema, createServer } from './server.js';
import { replay } from './replay.js';
const codeRoot = fileURLToPath(new URL('../', import.meta.url));
const root = basename(codeRoot) === 'dist' ? dirname(codeRoot) : codeRoot;
const user = { id: 'alice', roles: ['analyst'], dimensions: ['city', 'country'] };
async function catalog(path?: string) {
  return loadCatalog(JSON.parse(await readFile(path ?? join(root, 'fixtures/catalog.json'), 'utf8')));
}
export async function main(args: string[]) {
  const [command, directory, extra] = args;
  if (command === 'verify' && directory && extra) {
    const snapshot = await Snapshot.open(resolve(extra));
    try { console.log(JSON.stringify(await replay(JSON.parse(await readFile(directory, 'utf8')), snapshot))); }
    finally { await snapshot.close(); }
    return;
  }
  if (command === 'init' || command === 'demo') {
    const out = resolve(directory ?? join('data', command + '-' + Date.now()));
    await mkdir(dirname(out), { recursive: true, mode: 0o700 });
    await mkdir(out, { recursive: false, mode: 0o700 });
    await buildSnapshot(join(root, 'fixtures/orders.csv'), join(out, 'snapshot'), new Date().toISOString());
    if (command === 'init') { console.log(JSON.stringify({ snapshot: join(out, 'snapshot') })); return; }
    const gateway = new Gateway(await catalog(), await Snapshot.open(join(out, 'snapshot')));
    try {
      const offered = await gateway.plan('revenue by city where country = "US"', user);
      await writeFile(join(out, 'plan.json'), JSON.stringify(offered, null, 2), { flag: 'wx' });
      console.log('Demo explicitly approves this synthetic plan:', offered.plan.sql, offered.plan.params);
      const receipt = await gateway.execute(offered.id, offered.approvalHash, user);
      await writeFile(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx' });
      await writeFile(join(out, 'traces.json'), JSON.stringify(await gateway.telemetry.records(), null, 2), { flag: 'wx' });
      console.log(JSON.stringify({ output: out, rows: receipt.rows }, null, 2));
    } finally { await gateway.close(); }
    return;
  }
  if (command === 'serve' && directory) {
    const snapshot = await Snapshot.open(resolve(directory));
    let gateway: Gateway | undefined;
    let serverOwnsResources = false;
    try {
      gateway = new Gateway(await catalog(process.env.GA_CATALOG), snapshot);
      const auth = process.env.GA_AUTH_FILE ? AuthSchema.parse(JSON.parse(await readFile(process.env.GA_AUTH_FILE, 'utf8'))) :
        [{ token: randomBytes(24).toString('hex'), principal: user }];
      if (!process.env.GA_AUTH_FILE) console.log('Ephemeral analyst bearer token:', auth[0].token);
      const reviews = await Reviews.open(resolve(extra ?? 'data/reviews.json'));
      const app = createServer(gateway, reviews, auth);
      serverOwnsResources = true;
      const port = Number(process.env.PORT ?? 4318);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) { await app.close(); throw new Error('Invalid PORT'); }
      try { await app.listen({ host: '127.0.0.1', port }); }
      catch (e) { await app.close(); throw e; }
      console.log('Listening on http://127.0.0.1:' + port);
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
    } catch (e) {
      // If startup failed before server ownership, release the pinned database.
      if (!serverOwnsResources) {
        if (gateway) await gateway.close(); else await snapshot.close();
      }
      throw e;
    }
    return;
  }
  console.log('Usage: tsx src/cli.ts init [new-output-dir] | demo [new-output-dir] | serve <snapshot-dir> [review-file] | verify <receipt.json> <snapshot-dir>');
  if (command && command !== '--help') process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 2; });
}
