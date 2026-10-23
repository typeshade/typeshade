// Run a newly packed manifest on this reader and the actual pre-change schema-2 reader.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { compile } from '../src/compiler/ts/compile.js';
import { packModule } from '../src/compiler/ts/pack.js';
import { createTypeshadeLanguageService } from '../src/language-service/service.js';

// This immutable revision precedes retained variants. Test its code, rather than simulating it.
const BASELINE = 'fe7e105e842ee33ce44ba1818bf9fe9a67002d4a';

export async function consoleVariants(options: {
  readonly repo: string;
  readonly app: string;
  readonly chromiumArgs: readonly string[];
}): Promise<number> {
  const { repo, app, chromiumArgs } = options;
  const dir = join(app, 'console-variants');
  const baseline = join(dir, 'baseline');
  mkdirSync(baseline, { recursive: true });
  const archive = spawnSync('git', ['archive', BASELINE, 'src'], {
    cwd: repo,
    maxBuffer: 64 << 20,
  });
  if (archive.status !== 0) throw new Error(`Cannot read baseline ${BASELINE}: ${archive.stderr}`);
  const extract = spawnSync('tar', ['-x', '-C', baseline], { input: archive.stdout });
  if (extract.status !== 0) throw new Error(`Cannot extract baseline: ${extract.stderr}`);
  writeFileSync(
    join(dir, 'baseline.ts'),
    "export { createRuntime } from './baseline/src/runtime.js';\n",
  );
  const source = readFileSync(join(repo, 'journeys/_console-variants/console.shade.ts'), 'utf8');
  const fileName = 'console.shade.ts';
  const compiled = compile(source, { fileName });
  const service = createTypeshadeLanguageService();
  service.openDocument(fileName, source);
  if (
    compiled.diagnostics.some((d) => d.category === 'error') ||
    service.getDiagnostics(fileName).length
  )
    throw new Error('Both compiler and editor must accept the console journey source.');
  writeFileSync(join(dir, 'program.json'), JSON.stringify(packModule(compiled.module!)));
  writeFileSync(
    join(dir, 'enabled.json'),
    JSON.stringify(packModule(compiled.module!, { console: true })),
  );
  cpSync(join(repo, 'journeys/_console-variants/page.mjs'), join(dir, 'page.mjs'));
  const bundle = spawnSync(
    'bun',
    ['build', './page.mjs', '--target=browser', '--format=esm', '--outfile=page.js'],
    {
      cwd: dir,
      encoding: 'utf8',
    },
  );
  if (bundle.status !== 0) throw new Error(`Console journey bundle failed:\n${bundle.stderr}`);
  const js = readFileSync(join(dir, 'page.js'), 'utf8');
  const server = createServer((req, res) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; script-src 'self'; connect-src 'self'",
    );
    if (req.url === '/page.js') {
      res.setHeader('Content-Type', 'text/javascript');
      res.end(js);
    } else {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><script type="module" src="/page.js"></script>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    executablePath: process.env['TYPESHADE_CHROMIUM'] || undefined,
    args: [...chromiumArgs],
  });
  try {
    const page = await browser.newPage();
    const address = server.address();
    if (typeof address !== 'object' || address === null)
      throw new Error('No console journey address.');
    await page.goto(`http://127.0.0.1:${address.port}`);
    const result = await page.evaluate(
      async () =>
        await (
          globalThis as unknown as {
            consoleVariantResult: Promise<{ checks?: string[]; error?: string }>;
          }
        ).consoleVariantResult,
    );
    if (result.error !== undefined) throw new Error(result.error);
    if (result.checks?.length !== 20)
      throw new Error('The console variant checks did not all run.');
    for (const check of result.checks) console.log(`ok   console variants: ${check}`);
    console.log(`console variants: 20 checks passed; baseline reader ${BASELINE}`);
    return 0;
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}
