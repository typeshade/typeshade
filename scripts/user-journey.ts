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
//      the documented setup, whose `prepare` runs `tshc sync`. Its host file type-checks
//      with plain `tsc` (and a wrong call is caught), `vite build` bundles it, and Node runs the
//      bundle, which must print what the plain-JavaScript reference computes and ship no compiler.
//      One of its shader modules imports a package by its name (Rule 3.9, change 0024):
//      `journeys/_shade-package/`, packed and installed with npm beside the tarball, so every
//      path reads a package from a real `node_modules`.
//   5. the host examples (change 0061): `examples/hosts/` is built with Vite in that project, and
//      each host's `run()` is called in a page with WebGPU, held to `examples/hosts/_reference.ts`,
//      the reference the unit suite holds the CPU tier to.
//
// TYPESHADE_CHROMIUM points at a Chromium binary, as for the compile gate; without it Playwright
// launches its own. TYPESHADE_JOURNEY_KEEP=1 keeps the temporary project for inspection.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
import { HOST_ORDER } from '../examples/hosts/_order.js';
import {
  compare,
  INPUTS,
  type Drive,
  type Outputs,
  type Surface,
} from '../examples/hosts/_reference.js';
import { KERNEL_TREE } from '../src/core/kernel-tree.js';

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
    // The shader package a module of the import path imports (change 0024), packed from a copy
    // the way npm publishes it.
    const shadeStage = join(work, 'shade-package');
    cpSync(join(REPO, 'journeys', '_shade-package'), shadeStage, { recursive: true });
    const shadePackage = join(
      work,
      sh('npm', ['pack', '--silent', '--pack-destination', work], shadeStage)
        .trim()
        .split('\n')
        .pop()!,
    );

    // 2. A fresh project that installs it, with the README's tsconfig.
    const app = join(work, 'app');
    mkdirSync(app);
    writeFileSync(
      join(app, 'package.json'),
      `${JSON.stringify({ name: 'journeys', version: '1.0.0', private: true, type: 'module' }, null, 2)}\n`,
    );
    // The shader package too: plain `tsc` reads the import path's module that imports it, through
    // the README's `customConditions` (change 0024).
    sh(
      'npm',
      ['install', '--silent', '--no-audit', '--no-fund', join(work, tarball), shadePackage],
      app,
    );
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
    return await hostImport(work, join(work, tarball), shadePackage);
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
async function hostImport(work: string, tarball: string, shadePackage: string): Promise<number> {
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
        scripts: { prepare: 'tshc sync' },
      },
      null,
      2,
    )}\n`,
  );
  sh(
    'npm',
    ['install', '--silent', '--no-audit', '--no-fund', tarball, shadePackage, ...HOST_DEPS],
    app,
  );
  // A plain `npm install`, as a clone of the project runs it, runs `prepare`, so the views exist
  // before anything reads them. (An install that names packages does not run it.)
  sh('npm', ['install', '--silent', '--no-audit', '--no-fund'], app);
  const failures: string[] = [];
  const check = (ok: boolean, what: string): void => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} host import: ${what}`);
    if (!ok) failures.push(what);
  };
  check(existsSync(join(app, 'src', 'terrain.shade.typeshade.ts')), 'prepare wrote the host view');
  // `relief.shade.ts` imports `shade-contour` by its name, which `tshc sync` read from the
  // `node_modules` npm laid out (change 0024).
  check(
    existsSync(join(app, 'node_modules', 'shade-contour', 'src', 'contour.shade.ts')) &&
      existsSync(join(app, 'src', 'relief.shade.typeshade.ts')),
    'npm installed the shader package, and prepare wrote the view of the module that imports it',
  );

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

  // The GPU half (change 0016, Rule 8.24): the browser bundle of src/gpu.ts calls compute entries
  // in a page with WebGPU. `blockSum` reaches a barrier, which has no CPU tier, so it answers only
  // where WebGPU ran it. `markGroups` runs over a count `planGroups` wrote (change 0075), on WebGPU
  // and again on the CPU tier.
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
  const pa = particlesRun['args'] as Record<string, unknown>;
  const web = await inBrowser(join(app, 'out-web'), {
    sim: pa['sim'],
    particles: pa['particles'],
    frames: particlesRun['repeat'],
    frame: (plasmaRun['bindings'] as Record<string, unknown>)['frame'],
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
    // An emulated double is held to a double's reference, far inside what an f32 could reach.
    const bound = key.startsWith('double') ? 1e-12 : 1e-6;
    check(
      got.length === exp.length && worst <= bound,
      `WebGPU ${key} match the reference (worst ${worst}${web.error ? `; ${web.error}` : ''})`,
    );
  }

  // The indirect workgroup count (change 0075): WebGPU's `dispatchWorkgroupsIndirect` writes what
  // the CPU tier writes for the same chain, element for element.
  check(
    JSON.stringify(web.result?.['indirectWebgpu']) === JSON.stringify(web.result?.['indirectCpu']),
    `WebGPU's indirect dispatch writes what the CPU tier writes (${JSON.stringify(web.result?.['indirectWebgpu']?.slice(38, 42))})`,
  );

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
  ) as { plasma: number[]; tiled: number[]; ramped: number[]; deep: number[] };
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
  // A Resident a kernel function filled, bound as it is on WebGPU and read on the CPU tier
  // (Rule 11.8): each element k/32 exactly, rounded to 8 bits.
  for (const tier of ['webgpu', '2d']) compare(`ramped ${tier}`, drawRef.ramped, 1);
  // Emulated doubles on every tier, the `_fp64` guard bound on the GPU ones: a band an f32
  // would smear across the frame, within two 8-bit steps of the double reference.
  for (const tier of ['webgpu', 'webgl2', '2d']) compare(`deep ${tier}`, drawRef.deep, 2);
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

  // Kernel functions (change 0013): each loop the proof accepts runs on WebGPU, one invocation per
  // iteration, and writes back into the caller's arrays in place.
  const loopRef = JSON.parse(
    spawnSync(
      'node',
      [
        '--input-type=module',
        '-e',
        "console.log(JSON.stringify((await import('./reference.mjs')).loopReference()))",
      ],
      { cwd: app, encoding: 'utf8' },
    ).stdout,
  ) as Record<string, number[]>;
  for (const key of Object.keys(loopRef)) {
    const got = web.loops?.[key];
    const want = loopRef[key]!;
    const worst =
      typeof got === 'object'
        ? Math.max(...want.map((w, i) => Math.abs((got[i] ?? NaN) - w)))
        : NaN;
    // f32 on both sides. WGSL gives sin and cos an absolute error of 2^-11 in [-pi, pi], and
    // render sums k.x * sin + k.z * cos with |k.x| + |k.z| = 3; the other kernels are exact.
    // WebGL2's sin and cos carry no bound in GLSL ES 3.00; the driver's are within 2^-10 here.
    // An emulated double is held to a double's reference: 1e-12 of the largest value.
    const bound =
      key === 'render' || key === 'residentRender'
        ? 3 * 2 ** -11
        : key === 'glRender'
          ? 3 * 2 ** -10
          : key.startsWith('double')
            ? 1e-12 * Math.max(...want.map(Math.abs))
            : 0;
    check(
      typeof got === 'object' && got.length === want.length && worst <= bound,
      `the kernel function ${key}, called through the import, writes the reference (worst ${worst}${web.error ? `; ${web.error}` : ''})`,
    );
  }
  check(
    /TypeError: render\(\): parameter "out" holds 10 elements, and loop 1 writes it at indices 0 to 4095\./.test(
      String(web.loops?.['short']),
    ),
    `a kernel call checks an array's length before it uploads (${String(web.loops?.['short'])})`,
  );

  // `console.*` from the GPU (change 0014 through 0016): a production build records nothing, and
  // `vite dev` prints `report`'s four calls from WebGPU in invocation order, each line saying
  // where it ran (change 0025).
  check(
    web.logs !== undefined && web.logs.length === 0,
    `a production build records no console call (got ${JSON.stringify(web.logs)})`,
  );
  const dev = await inDevServer(app);
  const printed4 = [1.5, 2.5, 3.5, 4.5].map(
    (x, i) => `GPU  kernels.shade.ts:41  [${i}, 0, 0]  x ${i} ${x}`,
  );
  check(
    JSON.stringify(dev.logs) === JSON.stringify(printed4),
    `vite dev prints the entry's console calls from WebGPU in order (got ${JSON.stringify(dev.logs)}${dev.error ? `; ${dev.error}` : ''})`,
  );

  // The host examples (change 0061): `examples/hosts/` built with Vite in the same project, from
  // the same tarball, and each host's `run()` called in a page with WebGPU, held to the reference
  // the unit suite holds the CPU tier to.
  await hostExamples(app, check);
  return failures.length === 0 ? 0 : 1;
}

/** The GPU tiers the host examples' arm runs each host on. */
const HOST_GPU_TIERS = ['webgpu', 'webgl2'] as const;

/** The host examples' arm (change 0061): copy `examples/hosts/` into the Vite project `app`, build
 *  its driver (`_drive.ts`) as a browser bundle, run every host on WebGPU and again on WebGL2, and
 *  compare each result with `_reference.ts`. A host passes on a tier exactly when `_order.ts`
 *  lists that tier for it, so the list a reader is shown is what this arm saw, in both
 *  directions: a listed tier that fails, and an unlisted one that passes, are each a failure. */
async function hostExamples(
  app: string,
  check: (ok: boolean, what: string) => void,
): Promise<void> {
  const hosts = join(app, 'hosts');
  // The examples' own tsconfig extends the repository's base, which the project does not have,
  // and the host views are the plugin's to write: the project builds with its own setup.
  cpSync(join(REPO, 'examples', 'hosts'), hosts, {
    recursive: true,
    filter: (from) => !from.endsWith('tsconfig.json') && !from.endsWith('.shade.typeshade.ts'),
  });
  writeFileSync(
    join(app, 'vite.hosts.config.ts'),
    [
      "import { defineConfig } from 'vite';",
      "import { typeshade } from 'typeshade/vite';",
      '',
      '// `loop-fuse` is built with `fuse: true`, as its host file says an application builds it',
      '// (change 0058); every other module as the default plugin builds it.',
      'const plain = typeshade();',
      'const fused = typeshade({ fuse: true });',
      'export default defineConfig({',
      '  plugins: [',
      '    {',
      '      ...plain,',
      '      configResolved(config) {',
      '        plain.configResolved(config);',
      '        fused.configResolved(config);',
      '      },',
      '      transform(code, id) {',
      "        return (id.includes('/hosts/loop-fuse/') ? fused : plain).transform.call(this, code, id);",
      '      },',
      '    },',
      '  ],',
      "  build: { lib: { entry: 'hosts/_drive.ts', formats: ['es'], fileName: 'drive' }, outDir: 'out-hosts' },",
      '});',
      '',
    ].join('\n'),
  );
  sh('npx', ['vite', 'build', '--config', 'vite.hosts.config.ts', '--logLevel', 'warn'], app);
  const ids = HOST_ORDER.map((h) => h.id);
  for (const tier of HOST_GPU_TIERS) {
    const name = tier === 'webgpu' ? 'WebGPU' : 'WebGL2';
    const ran = await hostsInBrowser(join(app, 'out-hosts'), ids, tier);
    check(
      ran.webgpu === (tier === 'webgpu'),
      tier === 'webgpu'
        ? 'host examples: the page has WebGPU, so each host ran on it'
        : 'host examples: the page hides WebGPU, so each host ran on WebGL2',
    );
    if (tier === 'webgpu') checkFuseReports(ran.reports, check);
    if (tier === 'webgl2') {
      // A program-runtime pass, then a kernel call, on the call layer's one WebGL2 context.
      const want = Array.from({ length: 8 }, (_, i) => 1 - Math.exp(-i / 4));
      const got = ran.afterPass;
      const worst =
        typeof got === 'object'
          ? Math.max(...want.map((w, i) => Math.abs((got[i] ?? NaN) - w)))
          : NaN;
      check(
        typeof got === 'object' && got.length === 8 && worst <= 1e-5,
        `host examples: a kernel call after a program-runtime pass runs on WebGL2 (${typeof got === 'string' ? got : `worst ${worst}`})`,
      );
    }
    for (const { id, tiers } of HOST_ORDER) {
      const wrong = ran.error !== undefined ? [ran.error] : compare(id, ran.results?.[id]);
      const listed = tiers.includes(tier);
      check(
        (wrong.length === 0) === listed,
        listed
          ? `host example ${id}: run() on ${name} gives the reference${wrong.length ? ` (${wrong.join('; ')})` : ''}`
          : `host example ${id}: _order.ts leaves ${tier} out, and run() on ${name} does not give the reference (${wrong.join('; ') || 'it does: list the tier'})`,
      );
    }
  }
}

/** The line of `loop-fuse.shade.ts` that `pairsum` reads `t[i ^ 1]` on, which the report names. */
function pairsumLine(): number {
  return (
    readFileSync(join(REPO, 'examples', 'hosts', 'loop-fuse', 'loop-fuse.shade.ts'), 'utf8')
      .split('\n')
      .findIndex((l) => l.includes('out[i] = t[i] + t[i ^ 1];')) + 1
  );
}

/** The dispatches that fold the partials of a reduction over `n` iterations, after the dispatch of
 *  its loop: the loop makes one partial for each workgroup of `KERNEL_TREE` iterations, and a
 *  dispatch folds `KERNEL_TREE` partials into one, until one is left (`reduceOnGpu`,
 *  `src/core/host-kernel.ts`). */
const foldLevels = (n: number, count = Math.ceil(n / KERNEL_TREE)): number =>
  count <= 1 ? 0 : 1 + foldLevels(n, Math.ceil(count / KERNEL_TREE));

/** The WebGPU reports of `loop-fuse` (change 0058): the chain `add → mul → relu` is one fused
 *  group and one dispatch; with `pairsum` between, two groups, the second saying why in the
 *  author's words, with the line; and `add → mul → total` is one fused group whose loop is one
 *  dispatch, followed by a dispatch for each level of partials, all in one submission. */
function checkFuseReports(
  reports: Record<string, unknown> | undefined,
  check: (ok: boolean, what: string) => void,
): void {
  type Report = {
    tier: string;
    dispatches: number;
    submissions: number;
    groups: { calls: string[]; fused: boolean; why?: string }[];
  };
  const chain = reports?.['chain'] as Report | undefined;
  const split = reports?.['split'] as Report | undefined;
  const reduce = reports?.['reduce'] as Report | undefined;
  const calls = (r: Report | undefined): string => JSON.stringify(r?.groups.map((g) => g.calls));
  check(
    chain?.tier === 'webgpu' &&
      chain.dispatches === 1 &&
      calls(chain) === JSON.stringify([['add', 'mul', 'relu']]) &&
      chain.groups[0]?.fused === true,
    `host example loop-fuse: add → mul → relu is one fused dispatch on WebGPU (${JSON.stringify(chain)})`,
  );
  const why = `mul and pairsum run as two dispatches because pairsum reads \`t[i ^ 1]\` (line ${pairsumLine()})`;
  check(
    split?.tier === 'webgpu' &&
      split.dispatches === 2 &&
      calls(split) ===
        JSON.stringify([
          ['add', 'mul'],
          ['pairsum', 'relu'],
        ]) &&
      split.groups[1]?.why === why,
    `host example loop-fuse: pairsum splits the chain into two dispatches, and says why (${JSON.stringify(split)})`,
  );
  // The levels share a device buffer of partials, so the loop and each fold are in the plan's one
  // submission, which also copies the folded slot: add and mul run in the loop's dispatch.
  const folds = foldLevels(INPUTS.fuse.a.length);
  check(
    reduce?.tier === 'webgpu' &&
      reduce.dispatches === 1 + folds &&
      reduce.submissions === 1 &&
      calls(reduce) === JSON.stringify([['add', 'mul', 'total']]) &&
      reduce.groups[0]?.fused === true,
    `host example loop-fuse: add → mul → total is one fused group, the loop's dispatch and ${folds} fold(s) in one submission, on WebGPU (${JSON.stringify(reduce)})`,
  );
}

/** Load the host examples' driver, `dir/drive.js`, in a page served from localhost (a secure
 *  context, which WebGPU needs), and run each of `ids` on `tier` alone:
 *
 *  - `webgpu`: every kernel and entry call is required to run on WebGPU
 *    (`configure({ prefer: ['webgpu'] })`), and a draw into a fresh canvas takes WebGPU first.
 *  - `webgl2`: the page hides `navigator.gpu` before any script runs, so neither the call layer
 *    nor `runtime()` finds WebGPU; every kernel and entry call is required to run on WebGL2
 *    (`configure({ prefer: ['webgl2'] })`), and each canvas hands out a `webgl2` context first,
 *    which decides its tier, so a draw cannot fall to the CPU tier either.
 *
 *  The bundle is split (the runtime's WebGL2 tier is a chunk of its own), so every `.js` file of
 *  `dir` is served. */
async function hostsInBrowser(
  dir: string,
  ids: readonly string[],
  tier: (typeof HOST_GPU_TIERS)[number],
): Promise<{
  webgpu: boolean;
  results?: Record<string, Outputs | string>;
  reports?: Record<string, unknown>;
  afterPass?: number[] | string;
  error?: string;
}> {
  const chunks = new Map<string, string>(
    readdirSync(dir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => [`/${f}`, readFileSync(join(dir, f), 'utf8')] as const),
  );
  const server = createServer((req, res) => {
    const js = chunks.get(req.url ?? '');
    if (js !== undefined) {
      res.setHeader('content-type', 'text/javascript');
      res.end(js);
    } else {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>typeshade host examples</title>');
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const browser = await chromium.launch({
    executablePath: process.env['TYPESHADE_CHROMIUM'] || undefined,
    args: CHROMIUM_ARGS,
  });
  try {
    const page = await browser.newPage();
    if (tier === 'webgl2')
      await page.addInitScript(() =>
        Object.defineProperty(Navigator.prototype, 'gpu', { get: () => undefined }),
      );
    const { port } = server.address() as { port: number };
    await page.goto(`http://127.0.0.1:${port}/`);
    return await page.evaluate(
      async ({ ids, tier }) => {
        const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
        const webgpu = gpu !== undefined && (await gpu.requestAdapter()) !== null;
        try {
          const m = (await import('/drive.js' as string)) as {
            configure(options: { prefer: readonly string[] }): void;
            drive: Drive;
            reports: Record<string, unknown>;
            passThenKernel(): Promise<number[]>;
          };
          m.configure({ prefer: [tier] });
          // A canvas the page made, read back through a `2d` copy: the top row first.
          const surface: Surface = {
            canvas: (w, h) => {
              const c = document.createElement('canvas');
              c.width = w;
              c.height = h;
              if (tier === 'webgl2')
                c.getContext('webgl2', {
                  alpha: false,
                  antialias: false,
                  preserveDrawingBuffer: true,
                });
              return c;
            },
            pixels: (c) => {
              const copy = document.createElement('canvas');
              copy.width = c.width;
              copy.height = c.height;
              const ctx = copy.getContext('2d')!;
              ctx.drawImage(c, 0, 0);
              return [...ctx.getImageData(0, 0, c.width, c.height).data];
            },
          };
          const results = (await m.drive(surface, ids)) as Record<string, Outputs | string>;
          // On WebGL2 alone: a kernel call after a program-runtime pass on the same context.
          const afterPass =
            tier === 'webgl2'
              ? await m.passThenKernel().then(
                  (v) => v,
                  (e: unknown) => String(e),
                )
              : undefined;
          return { webgpu, results, afterPass, reports: m.reports };
        } catch (e) {
          return { webgpu, error: String(e) };
        }
      },
      { ids, tier },
    );
  } finally {
    await browser.close();
    server.close();
  }
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
    const printed: Promise<string>[] = [];
    page.on('console', (m) => {
      if (m.type() === 'log')
        printed.push(
          Promise.all(m.args().map((a) => a.jsonValue() as Promise<unknown>)).then(asPrinted),
        );
    });
    await page.goto(url);
    const call = (): Promise<string | undefined> =>
      page.evaluate(async () => {
        try {
          const m = (await import('/src/gpu.ts' as string)) as { logged(): Promise<void> };
          await m.logged();
          return undefined;
        } catch (e) {
          return String(e);
        }
      });
    let error: string | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        error = await call();
        break;
      } catch (e) {
        // The import brings the dev server a dependency it has not optimized yet (`typeshade/fuse`,
        // change 0073), and Vite reloads the page once it has: the call is made again on the
        // reloaded page, which has every dependency, and prints nothing of the first attempt.
        if (attempt < 3 && /Execution context was destroyed/.test(String(e))) {
          await page.waitForLoadState('load');
          printed.length = 0;
          continue;
        }
        throw e;
      }
    }
    // The console events are page messages, delivered after the call resolves.
    await page.waitForTimeout(200);
    const logs = await Promise.all(printed);
    return { logs, ...(error !== undefined ? { error } : {}) };
  } finally {
    await browser.close();
    server.kill();
  }
}

/** A console call's arguments as the browser prints them: the format string's `%c` styles
 *  applied and dropped, the arguments after it joined by spaces. `m.text()` joins the raw
 *  arguments instead, styles and all. */
function asPrinted(args: readonly unknown[]): string {
  const [first, ...rest] = args;
  if (typeof first !== 'string') return args.map(String).join(' ');
  const styles = first.split('%c').length - 1;
  return [first.replace(/%c/g, '').replace(/%%/g, '%'), ...rest.slice(styles).map(String)]
    .join(' ')
    .trim();
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
  loops?: Record<string, number[] | string>;
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
          loops(): Promise<Record<string, number[] | string>>;
        };
        const result = await m.run();
        const draws = await m.draws();
        await m.logged();
        const journeys = await m.journeys(input);
        const loops = await m.loops();
        return { webgpu, result, draws, journeys, loops };
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
