// The user-journey gate: TypeShade used the way a user uses it, from the tarball npm would ship.
//
//   bun run build && bun run gate:journeys
//
// The unit suite and the compile gate check the compiler from inside the repository, through
// its source. A user never sees that: they install the package, write `.shade.ts` files in an
// editor, maybe type-check them with the README's `tsconfig.shade.json`, compile them with
// `compile()`, and run the output on a GPU. Each of those steps has failed in ways no test here
// saw: the README's tsconfig did not load the ambient types at all (#211), and the first loop a
// TypeScript author writes did not compile (#209). This gate walks that path:
//
//   1. pack the tarball the way `.github/workflows/publish.yml` does (`dist/` built, the
//      manifest rewritten onto it by `derivePublishManifest`), in a staging copy, so the
//      working tree is not touched;
//   2. install it into a fresh `npm init` project, with `tsconfig.shade.json` copied verbatim
//      from the README;
//   3. copy `journeys/` in and run `journeys/_harness.mjs` there with Node. The harness imports
//      only `typeshade`, and checks each journey through the compiler, the language service,
//      plain `tsc`, WebGPU (headless Chromium on SwiftShader) and the CPU oracle;
//   4. the import path (change 0009): `journeys/_host-import/` becomes a fresh Vite project with
//      the documented setup, whose `prepare` runs `typeshade sync`. Its host file type-checks
//      with plain `tsc` (and a wrong call is caught), `vite build` bundles it, and Node runs the
//      bundle, which must print what the plain-JavaScript reference computes and ship no compiler.
//
// TYPESHADE_CHROMIUM points at a Chromium binary, as for the compile gate; without it Playwright
// launches its own. TYPESHADE_JOURNEY_KEEP=1 keeps the temporary project for inspection.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { derivePublishManifest } from './publish-manifest.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sh(cmd: string, args: readonly string[], cwd: string): string {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}:\n${r.stdout}\n${r.stderr}`);
  }
  return r.stdout;
}

/** The README's `tsconfig.shade.json`, exactly as a user would copy it. */
export function readmeTsconfig(readme: string): string {
  const at = readme.indexOf('// tsconfig.shade.json');
  if (at < 0) throw new Error('README.md has no `// tsconfig.shade.json` block to copy');
  const start = readme.lastIndexOf('```jsonc', at);
  const end = readme.indexOf('```', at);
  if (start < 0 || end < 0)
    throw new Error('README.md: the tsconfig.shade.json block is not fenced');
  return readme.slice(readme.indexOf('\n', start) + 1, end);
}

async function main(): Promise<number> {
  if (!existsSync(join(REPO, 'dist', 'src', 'index.js'))) {
    console.error('user journeys: dist/ is missing. Run `bun run build` first.');
    return 1;
  }
  const work = mkdtempSync(join(tmpdir(), 'typeshade-journeys-'));
  try {
    // 1. The tarball, from a staging copy carrying the publish-shaped manifest.
    const stage = join(work, 'stage');
    mkdirSync(stage);
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
    for (const entry of pkg.files as string[]) {
      if (entry.startsWith('!')) continue;
      const from = join(REPO, entry);
      if (existsSync(from)) cpSync(from, join(stage, entry), { recursive: true });
    }
    writeFileSync(
      join(stage, 'package.json'),
      `${JSON.stringify(derivePublishManifest(pkg), null, 2)}\n`,
    );
    const tarball = sh('npm', ['pack', '--silent', '--pack-destination', work], stage)
      .trim()
      .split('\n')
      .pop()!;

    // 2. A fresh project that installs it, with the README's tsconfig.
    const app = join(work, 'app');
    mkdirSync(app);
    writeFileSync(
      join(app, 'package.json'),
      `${JSON.stringify({ name: 'journeys', version: '1.0.0', private: true, type: 'module' }, null, 2)}\n`,
    );
    sh('npm', ['install', '--silent', '--no-audit', '--no-fund', join(work, tarball)], app);
    writeFileSync(
      join(app, 'tsconfig.shade.json'),
      readmeTsconfig(readFileSync(join(REPO, 'README.md'), 'utf8')),
    );
    writeFileSync(
      join(app, 'tsconfig.shade.json'),
      readFileSync(join(app, 'tsconfig.shade.json'), 'utf8').replace(
        'src/**/*.shade.ts',
        'journeys/**/*.shade.ts',
      ),
    );

    // 3. The journeys, run there.
    cpSync(join(REPO, 'journeys'), join(app, 'journeys'), { recursive: true });
    const run = spawnSync('node', ['journeys/_harness.mjs'], {
      cwd: app,
      stdio: 'inherit',
      env: {
        ...process.env,
        TYPESHADE_PLAYWRIGHT: join(REPO, 'node_modules', 'playwright', 'index.mjs'),
      },
    });
    if ((run.status ?? 1) !== 0) return run.status ?? 1;

    // 4. The import path.
    return await hostImport(work, join(work, tarball));
  } finally {
    if (process.env['TYPESHADE_JOURNEY_KEEP'] === '1') console.log(`kept ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

/** Versions the import journey installs beside the tarball: the repository's own TypeScript pin,
 *  and the Vite line the proposal measured (change 0009). */
const HOST_DEPS = [
  'vite@^7.3.6',
  `typescript@${
    (
      JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as {
        devDependencies: Record<string, string>;
      }
    ).devDependencies['typescript']
  }`,
];

/** Step 4: a Vite project that imports a `.shade.ts` and calls it, set up as surface §64 says. */
async function hostImport(work: string, tarball: string): Promise<number> {
  const app = join(work, 'host-import');
  cpSync(join(REPO, 'journeys', '_host-import'), app, { recursive: true });
  // The particles and plasma journeys' shaders, which `src/gpu.ts` runs through the import.
  for (const [id, file] of [
    ['particles', 'particles.shade.ts'],
    ['plasma', 'plasma.shade.ts'],
  ] as const)
    cpSync(join(REPO, 'journeys', id, file), join(app, 'src', file));
  writeFileSync(
    join(app, 'package.json'),
    `${JSON.stringify(
      {
        name: 'host-import',
        version: '1.0.0',
        private: true,
        type: 'module',
        scripts: { prepare: 'typeshade sync' },
      },
      null,
      2,
    )}\n`,
  );
  sh('npm', ['install', '--silent', '--no-audit', '--no-fund', tarball, ...HOST_DEPS], app);
  // A plain `npm install`, as a clone of the project runs it, runs `prepare`, so the views exist
  // before anything reads them. (An install that names packages does not run it.)
  sh('npm', ['install', '--silent', '--no-audit', '--no-fund'], app);
  const failures: string[] = [];
  const check = (ok: boolean, what: string): void => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} host import: ${what}`);
    if (!ok) failures.push(what);
  };
  check(existsSync(join(app, 'src', 'terrain.shade.typeshade.ts')), 'prepare wrote the host view');

  const tsc = (): string[] => {
    const r = spawnSync('npx', ['tsc', '-p', 'tsconfig.json', '--pretty', 'false'], {
      cwd: app,
      encoding: 'utf8',
    });
    return `${r.stdout}${r.stderr}`.split('\n').filter((l) => /error TS\d+/.test(l));
  };
  const clean = tsc();
  check(clean.length === 0, `tsc reports 0 errors (got ${clean.length}: ${clean.join(' | ')})`);
  writeFileSync(
    join(app, 'src', 'wrong.ts'),
    "import { height } from './terrain.shade.ts';\nexport const h = height([0.5], [1, 0.5, 2, 0.25]);\n",
  );
  const wrong = tsc();
  check(
    wrong.length === 1 && /^src\/wrong\.ts\(2,\d+\): error TS2345/.test(wrong[0]!),
    `a wrong-length vector is TS2345 at the host line (got ${wrong.join(' | ')})`,
  );
  rmSync(join(app, 'src', 'wrong.ts'));

  sh('npx', ['vite', 'build', '--ssr', 'src/app.ts', '--outDir', 'out', '--logLevel', 'warn'], app);
  const bundle = readFileSync(join(app, 'out', 'app.js'), 'utf8');
  check(
    !bundle.includes('createSourceFile') && !bundle.includes('new Function'),
    `the bundle ships no compiler and no new Function (${bundle.length} bytes)`,
  );
  const printed = JSON.parse(sh('node', [join('out', 'app.js')], app)) as Record<string, unknown>;
  const reference = spawnSync(
    'node',
    [
      '--input-type=module',
      '-e',
      "console.log(JSON.stringify((await import('./reference.mjs')).default))",
    ],
    { cwd: app, encoding: 'utf8' },
  );
  const want = JSON.parse(reference.stdout) as Record<string, unknown>;
  const flat = (v: unknown): number[] => (Array.isArray(v) ? v.flatMap(flat) : [v as number]);
  for (const key of Object.keys(want)) {
    const got = flat(printed[key]);
    const exp = flat(want[key]);
    const worst = Math.max(
      ...exp.map((e, i) => Math.abs((got[i] ?? NaN) - e) / Math.max(1, Math.abs(e))),
    );
    // f32 arithmetic against the f64 reference: a few f32 ulps, and the normal's difference
    // quotient amplifies them by 1 / (2 EPS).
    check(got.length === exp.length && worst < 2e-3, `${key} match the reference (worst ${worst})`);
  }

  // The GPU half (change 0016, Rule 8.24): the browser bundle of src/gpu.ts calls two compute
  // entries in a page with WebGPU. `blockSum` reaches a barrier, which has no CPU tier, so it answers only
  // where WebGPU ran it.
  sh('npx', ['vite', 'build', '--config', 'vite.web.config.ts', '--logLevel', 'warn'], app);
  // Each copied journey's own starting data and reference (its `journey.mjs`).
  const journeyOf = async (id: string): Promise<Record<string, unknown>> =>
    (
      (await import(pathToFileURL(join(REPO, 'journeys', id, 'journey.mjs')).href)) as {
        default: { runs: Record<string, unknown>[] };
      }
    ).default.runs[0]!;
  const particlesRun = await journeyOf('particles');
  const plasmaRun = await journeyOf('plasma');
  const pb = particlesRun['bindings'] as Record<string, { cpu: unknown }>;
  const web = await inBrowser(join(app, 'out-web'), {
    sim: pb['sim']!.cpu,
    particles: pb['particles']!.cpu,
    frames: particlesRun['repeat'],
    frame: (plasmaRun['bindings'] as Record<string, { cpu: unknown }>)['frame']!.cpu,
  });
  check(web.webgpu, 'the page has WebGPU, so the entries ran on it');
  const gpuRef = JSON.parse(
    spawnSync(
      'node',
      [
        '--input-type=module',
        '-e',
        "console.log(JSON.stringify((await import('./reference.mjs')).gpuReference()))",
      ],
      { cwd: app, encoding: 'utf8' },
    ).stdout,
  ) as Record<string, number[]>;
  for (const key of Object.keys(gpuRef)) {
    const got = web.result?.[key] ?? [];
    const exp = gpuRef[key]!;
    const worst = Math.max(
      ...exp.map((e, i) => Math.abs((got[i] ?? NaN) - e) / Math.max(1, Math.abs(e))),
    );
    // f32 on both sides, in the same order: WebGPU rounds each add and multiply as IEEE does.
    check(
      got.length === exp.length && worst <= 1e-6,
      `WebGPU ${key} match the reference (worst ${worst}${web.error ? `; ${web.error}` : ''})`,
    );
  }

  // The draw (Rule 8.24): each fragment entry drawn on each tier, read back in the task that
  // submitted it. The first context a canvas hands out decides its tier, so the page makes the
  // WebGL2 and 2d canvases' contexts before drawing into them.
  const drawRef = JSON.parse(
    spawnSync(
      'node',
      [
        '--input-type=module',
        '-e',
        "console.log(JSON.stringify((await import('./reference.mjs')).drawReference()))",
      ],
      { cwd: app, encoding: 'utf8' },
    ).stdout,
  ) as { plasma: number[]; tiled: number[] };
  const drawn = web.draws ?? {};
  const compare = (key: string, want: number[], steps: number): void => {
    const got = drawn[key];
    if (typeof got !== 'object') {
      check(false, `${key} draws (${String(got ?? web.error)})`);
      return;
    }
    const worst = Math.max(...want.map((w, i) => Math.abs((got[i] ?? NaN) - w)));
    check(
      got.length === want.length && worst <= steps,
      `${key} draws the reference frame (worst ${worst.toFixed(2)} of 255)`,
    );
  };
  // f32 against the f64 reference, rounded to 8 bits: two steps of 1/255.
  for (const tier of ['webgpu', 'webgl2', '2d']) compare(`plasma ${tier}`, drawRef.plasma, 2);
  // Nearest filtering at texel centres: the image's bytes, exactly.
  for (const tier of ['webgpu', 'webgl2']) compare(`tiled ${tier}`, drawRef.tiled, 0);
  const noCpu = drawn['tiled 2d'];
  check(
    typeof noCpu === 'string' &&
      /TypeError: tiled\(\).*"image", which the CPU tier cannot read/.test(noCpu),
    `a sampled texture has no CPU tier, and the draw says so (${String(noCpu)})`,
  );

  // The particles and plasma journeys through the import (change 0016): `step` 20 frames on
  // WebGPU, and `fs` drawn into a 64x64 canvas, each against its journey's own reference.
  const ranParticles = web.journeys?.particles ?? [];
  const wantParticles = (particlesRun['expected'] as () => number[])();
  const worstParticle = Math.max(
    ...wantParticles.map((w, i) => Math.abs((ranParticles[i] ?? NaN) - w)),
  );
  check(
    ranParticles.length === wantParticles.length &&
      worstParticle <= (particlesRun['tolerance'] as number),
    `the particles journey's step, called through the import, matches its reference (worst ${worstParticle})`,
  );
  const ranPlasma = web.journeys?.plasma ?? [];
  const pixel = plasmaRun['expected'] as (x: number, y: number) => number[];
  let worstPlasma = 0;
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const want = pixel(x, y).map((v) => Math.min(1, Math.max(0, v)));
      for (let i = 0; i < 4; i++)
        worstPlasma = Math.max(
          worstPlasma,
          Math.abs((ranPlasma[4 * (y * 64 + x) + i] ?? NaN) / 255 - want[i]!),
        );
    }
  check(
    ranPlasma.length === 64 * 64 * 4 && worstPlasma <= (plasmaRun['tolerance'] as number),
    `the plasma journey's fs, drawn through the import, matches its reference (worst ${(worstPlasma * 255).toFixed(2)} of 255)`,
  );

  // `console.*` from the GPU (change 0014 through 0016): a production build records nothing, and
  // `vite dev` prints `report`'s four calls from WebGPU in invocation order.
  check(
    web.logs !== undefined && web.logs.length === 0,
    `a production build records no console call (got ${JSON.stringify(web.logs)})`,
  );
  const dev = await inDevServer(app);
  const printed4 = ['x 0 1.5', 'x 1 2.5', 'x 2 3.5', 'x 3 4.5'];
  check(
    JSON.stringify(dev.logs) === JSON.stringify(printed4),
    `vite dev prints the entry's console calls from WebGPU in order (got ${JSON.stringify(dev.logs)}${dev.error ? `; ${dev.error}` : ''})`,
  );
  return failures.length === 0 ? 0 : 1;
}

/** Start `vite` (the dev server) in `app`, load the page and run `logged()` from `src/gpu.ts`,
 *  collecting what the page prints. */
async function inDevServer(app: string): Promise<{ logs: string[]; error?: string }> {
  const port = 5170 + Math.floor(Math.random() * 500);
  const server = spawn(
    'npx',
    ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    {
      cwd: app,
      stdio: 'ignore',
    },
  );
  const url = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({
    executablePath: process.env['TYPESHADE_CHROMIUM'] || undefined,
    args: CHROMIUM_ARGS,
  });
  try {
    for (let i = 0; ; i++) {
      try {
        await fetch(url);
        break;
      } catch {
        if (i === 100) return { logs: [], error: 'the dev server did not start' };
        await new Promise((done) => setTimeout(done, 200));
      }
    }
    const page = await browser.newPage();
    const logs: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'log') logs.push(m.text());
    });
    await page.goto(url);
    const error = await page.evaluate(async () => {
      try {
        const m = (await import('/src/gpu.ts' as string)) as { logged(): Promise<void> };
        await m.logged();
        return undefined;
      } catch (e) {
        return String(e);
      }
    });
    // The console events are page messages, delivered after the call resolves.
    await page.waitForTimeout(200);
    return { logs, ...(error !== undefined ? { error } : {}) };
  } finally {
    await browser.close();
    server.kill();
  }
}

/** The four flags that make WebGPU exist on SwiftShader, as the compile gate passes them. */
const CHROMIUM_ARGS = [
  '--enable-unsafe-webgpu',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--use-vulkan=swiftshader',
  '--enable-features=Vulkan',
];

/** Load `dir/gpu.js` in a page served from localhost (a secure context, which WebGPU needs),
 *  run its `run()`, `draws()` and `logged()`, and collect what the page prints. */
async function inBrowser(
  dir: string,
  input: unknown,
): Promise<{
  webgpu: boolean;
  result?: Record<string, number[]>;
  draws?: Record<string, number[] | string>;
  logs?: string[];
  journeys?: { particles: number[]; plasma: number[] };
  error?: string;
}> {
  const js = readFileSync(join(dir, 'gpu.js'), 'utf8');
  const server = createServer((req, res) => {
    if (req.url === '/gpu.js') {
      res.setHeader('content-type', 'text/javascript');
      res.end(js);
    } else {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>typeshade host import</title>');
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const browser = await chromium.launch({
    executablePath: process.env['TYPESHADE_CHROMIUM'] || undefined,
    args: CHROMIUM_ARGS,
  });
  try {
    const page = await browser.newPage();
    const { port } = server.address() as { port: number };
    await page.goto(`http://127.0.0.1:${port}/`);
    const logs: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'log') logs.push(m.text());
    });
    const out = await page.evaluate(async (input) => {
      const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      const webgpu = gpu !== undefined && (await gpu.requestAdapter()) !== null;
      try {
        const m = (await import('/gpu.js' as string)) as {
          run(): Promise<Record<string, number[]>>;
          draws(): Promise<Record<string, number[] | string>>;
          logged(): Promise<void>;
          journeys(input: unknown): Promise<{ particles: number[]; plasma: number[] }>;
        };
        const result = await m.run();
        const draws = await m.draws();
        await m.logged();
        const journeys = await m.journeys(input);
        return { webgpu, result, draws, journeys };
      } catch (e) {
        return { webgpu, error: String(e) };
      }
    }, input);
    await page.waitForTimeout(200);
    return { ...out, logs };
  } finally {
    await browser.close();
    server.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(await main());
