// Fresh package consumers under a strict CSP, with a deliberate missing-executor instrument (0085).
import { readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium } from 'playwright';

interface Result {
  readonly values: number[];
  readonly synchronous: boolean;
  readonly bodies: number;
  readonly tier: string;
  readonly dispatches: number;
  readonly fused: boolean;
}
interface Observation {
  readonly gpu?: Result;
  readonly cpu?: Result;
  readonly worker?: { readonly result?: Result; readonly error?: string };
  readonly error?: string;
  readonly csp?: boolean;
}

export async function automaticFusion(
  dir: string,
  chromiumArgs: readonly string[],
): Promise<readonly (readonly [boolean, string])[]> {
  const assets = new Map(
    readdirSync(dir, { recursive: true })
      .filter((p): p is string => typeof p === 'string' && p.endsWith('.js'))
      .map((p) => [`/${p.replaceAll('\\', '/')}`, readFileSync(join(dir, p), 'utf8')]),
  );
  const executor = [...assets.keys()].find((p) => /\/fuse-plan-[^/]+\.js$/.test(p));
  if (executor === undefined)
    throw new Error('The automatic fuse journey emitted no deferred executor.');
  const checks: [boolean, string][] = [];
  const browser = await chromium.launch({
    executablePath: process.env['TYPESHADE_CHROMIUM'] || undefined,
    args: [...chromiumArgs],
  });
  try {
    for (const mode of ['complete-assets', 'missing-chunk', 'offline'] as const) {
      let refused = 0,
        networkRequests = 0;
      const response = (url: string) => {
        const headers: Record<string, string> = {
          'Content-Security-Policy':
            "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'",
          'content-type': 'text/javascript',
        };
        if (mode === 'missing-chunk' && url === executor) {
          refused++;
          return { status: 404, headers, body: '' };
        }
        if (url === '/')
          return {
            status: 200,
            headers: { ...headers, 'content-type': 'text/html' },
            body: '<!doctype html><script>globalThis.inlineRan = true;</script><script type="module" src="/bootstrap.js"></script>',
          };
        if (url === '/bootstrap.js')
          return {
            status: 200,
            headers,
            body: `
          import { run } from './automatic.js';
          let csp = false;
          try { new Function('return 1')(); } catch { csp = true; }
          try {
            const gpu = await run();
            const cpu = await run('cpu');
            const worker = await new Promise((resolve, reject) => {
              const w = new Worker('./worker.js', { type: 'module' });
              w.onmessage = e => { w.terminate(); resolve(e.data); };
              w.onerror = e => { w.terminate(); reject(Error(e.message)); };
            });
            globalThis.result = { gpu, cpu, worker, csp: csp && !globalThis.inlineRan };
          } catch (error) { globalThis.result = { error: String(error), csp: csp && !globalThis.inlineRan }; }
        `,
          };
        const code = assets.get(url);
        return { status: code === undefined ? 404 : 200, headers, body: code ?? '' };
      };
      const server = createServer((req, res) => {
        networkRequests++;
        const reply = response(req.url ?? '');
        res.writeHead(reply.status, reply.headers);
        res.end(reply.body);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const context = await browser.newContext();
      try {
        const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
        if (mode === 'offline') {
          // Serve only the retained artifact map, with browser networking disabled and no HTTP cache.
          await context.route('**/*', async (route) => {
            const url = new URL(route.request().url());
            if (url.origin !== origin) {
              await route.abort();
              return;
            }
            await route.fulfill(response(url.pathname));
          });
          await context.setOffline(true);
        }
        const page = await context.newPage();
        await page.goto(origin);
        await page.waitForFunction(() => (globalThis as { result?: unknown }).result !== undefined);
        const observed = await page.evaluate(
          () => (globalThis as { result?: Observation }).result!,
        );
        checks.push([
          observed.csp === true,
          `automatic fuse ${mode} page enforces CSP against inline scripts and Function`,
        ]);
        if (mode === 'missing-chunk') {
          checks.push([
            refused > 0 && observed.error !== undefined,
            `automatic fuse refuses a missing local executor (${observed.error ?? 'no error'})`,
          ]);
        } else {
          for (const [realm, value, gpu] of [
            ['browser GPU', observed.gpu, true],
            ['browser CPU', observed.cpu, false],
            ['worker GPU', observed.worker?.result, true],
          ] as const)
            checks.push([
              value !== undefined &&
                value.synchronous &&
                value.bodies === 2 &&
                JSON.stringify(value.values) === '[9,-9,21]' &&
                value.tier === (gpu ? 'webgpu' : 'cpu') &&
                value.dispatches === (gpu ? 1 : 0) &&
                value.fused === gpu,
              `automatic fuse ${mode} in a fresh ${realm} records once, nests and reserves its queue before loading (${observed.error ?? observed.worker?.error ?? JSON.stringify(value)})`,
            ]);
          if (mode === 'offline')
            checks.push([
              networkRequests === 0,
              'automatic fuse offline page and worker use only retained local assets, with zero network requests',
            ]);
        }
      } finally {
        await context.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  } finally {
    await browser.close();
  }
  return checks;
}
