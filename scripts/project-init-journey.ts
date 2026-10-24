// A fresh tarball consumer: initialize once, rebuild missing views and run the result on WebGPU.
import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { verifyGateGpu, withGateBrowser, type GateBrowserSettings } from './gate-browser.js';

export async function initializedProject(options: {
  readonly repo: string;
  readonly work: string;
  readonly tarball: string;
  readonly dependencies: readonly string[];
  readonly browserSettings: GateBrowserSettings;
}): Promise<number> {
  const { repo, work, tarball, dependencies, browserSettings } = options;
  const app = join(work, 'project-init');
  mkdirSync(join(app, 'src'), { recursive: true });
  const run = (cmd: string, args: readonly string[]): string => {
    const result = spawnSync(cmd, args, { cwd: app, encoding: 'utf8' });
    if (result.status !== 0)
      throw new Error(
        `${cmd} ${args.join(' ')} failed in initialized project:\n${result.stdout}\n${result.stderr}`,
      );
    return result.stdout;
  };
  const checks: boolean[] = [];
  const check = (condition: boolean, message: string): void => {
    checks.push(condition);
    console.log(`${condition ? 'ok  ' : 'FAIL'} project init: ${message}`);
  };
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify(
      {
        name: 'initialized-consumer',
        version: '1.0.0',
        type: 'module',
        private: true,
        scripts: {
          build: 'tsc --noEmit && vite build',
          prepare: 'node -e "process.stdout.write(\'kept prepare\\n\')"',
        },
      },
      null,
      2,
    ),
  );
  cpSync(join(repo, 'journeys/_project-init/index.html'), join(app, 'index.html'));
  writeFileSync(join(app, 'src/main.ts'), 'export {};\n');
  run('npm', ['install', '--silent', '--no-audit', '--no-fund', tarball, ...dependencies]);
  const first = run('npx', ['--no-install', 'tshc', 'init']);
  check(
    first.includes('wrote vite.config.ts') && first.includes('wrote tsconfig.json'),
    'installed tshc creates the Vite and TypeScript setup',
  );
  const tracked = [
    'package.json',
    'tsconfig.json',
    'tsconfig.shade.json',
    'vite.config.ts',
    '.gitignore',
  ];
  const before = tracked.map((p) => readFileSync(join(app, p), 'utf8'));
  const repeat = run('npx', ['--no-install', 'tshc', 'init']);
  check(
    !repeat.includes('wrote ') &&
      before.every((text, i) => text === readFileSync(join(app, tracked[i]!), 'utf8')),
    'a second initialization changes no file',
  );
  const install = run('npm', ['install', '--silent', '--no-audit', '--no-fund']);
  check(
    install.includes('kept prepare'),
    'install works before the first shader and retains the existing prepare command',
  );
  run('npm', ['run', 'typecheck']);

  cpSync(join(repo, 'journeys/_project-init/src'), join(app, 'src'), { recursive: true });
  const absent = spawnSync('npx', ['--no-install', 'tsc', '--noEmit', '-p', 'tsconfig.json'], {
    cwd: app,
    encoding: 'utf8',
  });
  check(
    absent.status !== 0 && /error TS\d+/.test(`${absent.stdout}${absent.stderr}`),
    'bare host tsc detects a missing view before synchronization',
  );
  run('npm', ['run', 'typecheck']);
  const view = join(app, 'src/ops.shade.typeshade.ts');
  check(
    existsSync(view),
    'typecheck synchronizes views and runs shared compiler/editor diagnostics before tsc',
  );
  rmSync(view);
  run('npm', ['run', 'build']);
  check(
    existsSync(view),
    'build synchronizes a deleted view before the original tsc and Vite commands',
  );

  const dir = join(app, 'dist');
  const assets = new Map(
    readdirSync(dir, { recursive: true })
      .filter((p): p is string => typeof p === 'string' && !p.endsWith('/'))
      .filter((p) => /\.(?:html|js)$/.test(p))
      .map((p) => [`/${p.replaceAll('\\', '/')}`, readFileSync(join(dir, p))]),
  );
  const server = createServer((req, res) => {
    if (req.url === '/__typeshade_gpu_probe__') {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><title>GPU probe</title>');
      return;
    }
    const path =
      req.url === '/' ? '/index.html' : new URL(req.url ?? '/', 'http://localhost').pathname;
    const body = assets.get(path);
    res.statusCode = body ? 200 : 404;
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; connect-src 'self'",
    );
    res.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(body ?? 'missing');
  });
  const closeServer = () =>
    new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const browser = await chromium.launch(browserSettings.launch).catch(async (error: unknown) => {
    await closeServer().catch((cleanup) =>
      console.error('project-init server cleanup also failed', cleanup),
    );
    throw error;
  });
  const runBrowser = async () => {
    const { port } = server.address() as { port: number };
    const origin = `http://127.0.0.1:${port}`;
    await verifyGateGpu(browser, `${origin}/__typeshade_gpu_probe__`, browserSettings, {
      webgpu: true,
      webgl: false,
    });
    const page = await browser.newPage();
    await page.goto(`${origin}/`);
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.result !== undefined ||
        document.documentElement.dataset.error !== undefined,
    );
    const result = await page.evaluate(() => ({
      result: document.documentElement.dataset.result,
      error: document.documentElement.dataset.error,
    }));
    check(
      result.error === undefined && result.result === '[2.5,-4,7]',
      `the initialized production app executes an ordinary owned-array call on WebGPU (${JSON.stringify(result)})`,
    );
  };
  await withGateBrowser(browser, closeServer, runBrowser);
  return checks.filter((passed) => !passed).length;
}
