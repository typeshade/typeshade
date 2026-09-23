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
//      plain `tsc`, WebGPU (headless Chromium on SwiftShader) and the CPU oracle.
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
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

function main(): number {
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
    return run.status ?? 1;
  } finally {
    if (process.env['TYPESHADE_JOURNEY_KEEP'] === '1') console.log(`kept ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
