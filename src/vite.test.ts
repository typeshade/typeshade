// Verifies: Rule 3.8 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 3.9 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.24 (docs/language-design.md; traced in reqs/).
//
// The Vite plugin (`typeshade/vite`, change 0009) and `tshc sync`, the two writers of a
// shader module's host face. Vitest runs on Vite with the plugin in its pipeline
// (`vitest.config.ts`), so the first case imports a `.shade.ts` the way a host file does and
// calls what it exports; the rest drive the plugin's hook and the command directly.

import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { typeshade } from './vite.js';
import { hostFace } from './compiler/ts/host-face.js';
import { compile } from './compiler/ts/compile.js';
import { compileModule } from './core/oracle.js';
import { runCli, type CliHost } from './cli/run.js';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'typeshade-vite-'));
  dirs.push(d);
  return d;
};

const TERRAIN = `"use typeshade";

export const K: f32 = 0.5;

export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}

@fragment
export function fs(): vec4 {
  return vec4(height(vec2(0.5, 0.5), vec4(1., K, 2., 0.25)));
}
`;

describe('a host file imports a .shade.ts through the plugin', () => {
  it('calls the export, which runs at f32 on the CPU tier, and the view is written beside it', async () => {
    const dir = tempDir();
    const file = join(dir, 'terrain.shade.ts');
    writeFileSync(file, TERRAIN);
    // A computed specifier, so `tsc -p tsconfig.tests.json` does not resolve it to the source.
    const m = (await import(/* @vite-ignore */ file)) as {
      height: (p: readonly number[], k: readonly number[]) => number;
      K: number;
      fs: (...a: unknown[]) => Promise<void>;
    };
    const args = [
      [0.5, 0.5],
      [1, 0.5, 2, 0.25],
    ] as const;
    const oracle = compileModule(compile(TERRAIN).module, { precision: 'f32' });
    expect(m.height(...args)).toBe(oracle.fns.height!(...(args as unknown as never[])));
    expect(m.K).toBe(0.5);
    // A draw needs a canvas: without one it is refused, as a rejected promise.
    await expect(m.fs()).rejects.toThrow(TypeError);
    expect(readFileSync(join(dir, 'terrain.shade.typeshade.ts'), 'utf8')).toBe(
      hostFace(TERRAIN, { fileName: file }).view,
    );
    // The default export is the program's manifest (Rule 11.10).
    const program = (m as unknown as { default: { schema: number; entries: { name: string }[] } })
      .default;
    expect(program.schema).toBe(1);
    expect(program.entries.map((e) => e.name)).toEqual(['fs']);
  });

  it('a bundle that imports only the default export carries the manifest and no CPU tier', async () => {
    const { build } = await import('vite');
    const dir = tempDir();
    writeFileSync(join(dir, 'terrain.shade.ts'), TERRAIN);
    writeFileSync(
      join(dir, 'main.ts'),
      "import program from './terrain.shade.ts';\nexport const wgsl = program.wgsl;\n",
    );
    const out = await build({
      root: dir,
      configFile: false,
      logLevel: 'silent',
      plugins: [typeshade()],
      resolve: {
        alias: { 'typeshade/runtime/internal': join(import.meta.dirname, 'runtime-internal.ts') },
      },
      build: {
        write: false,
        minify: false,
        lib: { entry: join(dir, 'main.ts'), formats: ['es'], fileName: 'main' },
      },
    });
    const chunks = (Array.isArray(out) ? out[0]! : out) as unknown as {
      output: readonly { code?: string }[];
    };
    const code = chunks.output.map((o) => o.code ?? '').join('\n');
    expect(code).toContain('@fragment');
    expect(code).not.toContain('createCodegenRuntime');
    expect(code).not.toContain('callDraw');
  });
});

/** A module that imports a helper and a struct from another shader file (Rule 3.9). */
const LIB = `"use typeshade";

export class Tint {
  gain: f32;
}

export function tinted(x: f32, t: Tint): f32 {
  return x * t.gain;
}
`;
const APP = `"use typeshade";
import { tinted, Tint } from "./lib.shade.ts";

export function brighten(x: f32): f32 {
  const t: Tint = { gain: 3. };
  return tinted(x, t) + 1.;
}
`;

describe('a .shade.ts that imports another, through the plugin (Rule 3.9)', () => {
  it('calls the export, which runs the imported function, and writes the view', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'lib.shade.ts'), LIB);
    const file = join(dir, 'app.shade.ts');
    writeFileSync(file, APP);
    const m = (await import(/* @vite-ignore */ file)) as { brighten: (x: number) => number };
    expect(m.brighten(2)).toBe(7);
    expect(readFileSync(join(dir, 'app.shade.typeshade.ts'), 'utf8')).toBe(
      hostFace(APP, { fileName: file, readDocument: (f) => readFileSync(f, 'utf8') }).view,
    );
  });

  it('hands each file the module read to the bundler to watch', async () => {
    const dir = tempDir();
    const lib = join(dir, 'lib.shade.ts');
    writeFileSync(lib, LIB);
    const watched: string[] = [];
    const out = await typeshade().transform.call(
      { addWatchFile: (id: string) => void watched.push(id) } as never,
      APP,
      join(dir, 'app.shade.ts'),
    );
    expect(out?.code).toContain(' as brighten };');
    expect(watched).toEqual([lib]);
  });

  it('fails the build on an error in the imported file, at that file', async () => {
    const dir = tempDir();
    const lib = join(dir, 'lib.shade.ts');
    writeFileSync(lib, LIB.replace('x * t.gain', 'x * t.gian'));
    await expect(typeshade().transform(APP, join(dir, 'app.shade.ts'))).rejects.toThrow(
      `${join(dir, 'app.shade.ts')} does not compile:\n${lib}:8:16 TS8022 `,
    );
  });
});

/** `shade-tint` installed in `dir`'s node_modules, publishing `LIB` under the `typeshade`
 *  condition beside the JavaScript it publishes for hosts (proposal 0024). */
const installTint = (dir: string): string => {
  const root = join(dir, 'node_modules', 'shade-tint');
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({
      name: 'shade-tint',
      version: '1.0.0',
      exports: { '.': { typeshade: './src/tint.shade.ts', default: './dist/index.js' } },
    }),
  );
  writeFileSync(join(root, 'src', 'tint.shade.ts'), LIB);
  return join(root, 'src', 'tint.shade.ts');
};
const APP_OF_PACKAGE = APP.replace('"./lib.shade.ts"', '"shade-tint"');

describe("a .shade.ts that imports a package's shader module, through the plugin (0024)", () => {
  it('calls the export, which runs the function the package publishes', async () => {
    const dir = tempDir();
    installTint(dir);
    const file = join(dir, 'app.shade.ts');
    writeFileSync(file, APP_OF_PACKAGE);
    const m = (await import(/* @vite-ignore */ file)) as { brighten: (x: number) => number };
    expect(m.brighten(2)).toBe(7);
  });

  it("hands the package's file the module read to the bundler to watch", async () => {
    const dir = tempDir();
    const tint = installTint(dir);
    const watched: string[] = [];
    await typeshade().transform.call(
      { addWatchFile: (id: string) => void watched.push(id) } as never,
      APP_OF_PACKAGE,
      join(dir, 'app.shade.ts'),
    );
    expect(watched).toEqual([tint]);
  });
});

describe('the plugin hook', () => {
  it('records console calls in vite dev, and none in a build', async () => {
    const src = `"use typeshade";
declare const ys: storage<array<f32>, "read_write">;
@compute([1])
export function note(@builtin("global_invocation_id") gid: vec3u) { console.log("n", gid.x); ys[0] = 1.; }
`;
    const dir = tempDir();
    const file = join(dir, 'note.shade.ts');
    const dev = typeshade();
    dev.configResolved({ command: 'serve' });
    const build = typeshade();
    build.configResolved({ command: 'build' });
    expect((await dev.transform(src, file))?.code).toContain('log: __ts_console');
    expect((await build.transform(src, file))?.code).not.toContain('__ts_console');
  });

  it("records in a build with console: 'always', never with 'never', and says so once at the build's start", async () => {
    const src = `"use typeshade";
declare const ys: storage<array<f32>, "read_write">;
@compute([1])
export function note(@builtin("global_invocation_id") gid: vec3u) { console.log("n", gid.x); ys[0] = 1.; }
`;
    const file = join(tempDir(), 'note.shade.ts');
    const plugin = (console: 'dev' | 'always' | 'never', command: string) => {
      const p = typeshade({ console });
      p.configResolved({ command });
      return p;
    };
    const records = async (p: ReturnType<typeof typeshade>): Promise<boolean> =>
      ((await p.transform(src, file))?.code ?? '').includes('log: __ts_console');
    expect(await records(plugin('always', 'build'))).toBe(true);
    expect(await records(plugin('always', 'serve'))).toBe(true);
    expect(await records(plugin('never', 'serve'))).toBe(false);
    expect(await records(plugin('never', 'build'))).toBe(false);
    expect(await records(plugin('dev', 'serve'))).toBe(true);
    expect(await records(plugin('dev', 'build'))).toBe(false);
    // The one line: a build that records says so, and no other build or server does.
    const said: unknown[] = [];
    const info = console.info;
    console.info = (...a: unknown[]) => void said.push(a.join(' '));
    try {
      plugin('always', 'build').buildStart();
      plugin('always', 'serve').buildStart();
      plugin('dev', 'build').buildStart();
    } finally {
      console.info = info;
    }
    expect(said).toEqual([
      "typeshade: console: 'always' records each GPU entry's console.* calls in this build; a dispatch or draw of an entry that logs binds a console buffer and reads it back.",
    ]);
    expect(() => typeshade({ console: 'prod' as never })).toThrow(
      `typeshade(): console takes 'dev', 'always' or 'never', not "prod".`,
    );
  });

  it("puts the program's portable IR in the manifest with ir: true, and only then (change 0025)", async () => {
    const src = `"use typeshade";
declare const ys: storage<array<f32>, "read_write">;
@compute([1])
export function note(@builtin("global_invocation_id") gid: vec3u) { ys[gid.x] = 1.; }
`;
    const file = join(tempDir(), 'note.shade.ts');
    const code = async (options: Parameters<typeof typeshade>[0]): Promise<string> => {
      const p = typeshade(options);
      p.configResolved({ command: 'build' });
      return (await p.transform(src, file))?.code ?? '';
    };
    expect(await code({ ir: true })).toContain('"ir":{"version":');
    expect(await code({})).not.toContain('"ir":');
  });

  it('passes a host file through untouched', async () => {
    expect(await typeshade().transform('export const x = 1;', '/app/main.ts')).toBeNull();
  });

  it('returns the generated module for a .shade.ts, importing the runtime subpath', async () => {
    const dir = tempDir();
    const out = await typeshade().transform(TERRAIN, join(dir, 'terrain.shade.ts'));
    expect(out?.code).toMatch(/^import \* as __ts_rt from "typeshade\/runtime\/internal";$/m);
    expect(out?.code).toMatch(/^export \{.* as height\b.*\};$/m);
  });

  it('refuses a shader module under another name, with the rename (Rule 3.8)', async () => {
    await expect(typeshade().transform(TERRAIN, '/app/src/terrain.ts')).rejects.toThrow(
      '/app/src/terrain.ts begins with "use typeshade", so it is a shader module, and a host ' +
        'imports a shader module by the name *.shade.ts (Rule 3.8). Rename it to ' +
        'terrain.shade.ts and import it by that name.',
    );
    // Its valid neighbours: a host file that only mentions the directive, and a package's file.
    expect(
      await typeshade().transform('export const s = "use typeshade";', '/app/src/a.ts'),
    ).toBeNull();
    expect(await typeshade().transform(TERRAIN, '/app/node_modules/x/terrain.ts')).toBeNull();
  });

  it('fails the build on a module with errors, each TS80xx diagnostic at its line and column', async () => {
    const dir = tempDir();
    const file = join(dir, 'bad.shade.ts');
    const bad = `"use typeshade";\nexport function f(x: f32): f32 {\n  return y;\n}\n`;
    const expected = compile(bad, { fileName: file }).diagnostics.find(
      (d) => d.category === 'error',
    )!;
    await expect(typeshade().transform(bad, file)).rejects.toThrow(
      `${file} does not compile:\n${file}:${expected.line}:${expected.character} ${expected.code} ${expected.message}`,
    );
    expect(existsSync(join(dir, 'bad.shade.typeshade.ts'))).toBe(false);
  });
});

describe('tshc sync', () => {
  function memoryHost(files: Record<string, string>, cwd = '/p') {
    const out: string[] = [];
    const err: string[] = [];
    const host: CliHost = {
      cwd,
      readFile: (path) => files[path],
      writeFile: (path, text) => void (files[path] = text),
      kind(path) {
        if (files[path] !== undefined) return 'file';
        return Object.keys(files).some((f) => f.startsWith(`${path}/`)) ? 'directory' : undefined;
      },
      list(path) {
        const names = new Set<string>();
        for (const f of Object.keys(files))
          if (f.startsWith(`${path}/`)) names.add(f.slice(path.length + 1).split('/')[0]!);
        return [...names];
      },
      stdout: (text) => void out.push(text),
      stderr: (text) => void err.push(text),
    };
    return { host, stdout: () => out.join(''), stderr: () => err.join('') };
  }
  const info = { version: 'test' };
  const VIEW = '/p/src/terrain.shade.typeshade.ts';

  it('writes every view, and --check then passes', () => {
    const files: Record<string, string> = { '/p/src/terrain.shade.ts': TERRAIN };
    const a = memoryHost(files);
    expect(runCli(['sync'], a.host, info)).toBe(0);
    expect(a.stdout()).toBe(
      'wrote src/terrain.shade.typeshade.ts\n1 host view written, 0 up to date.\n',
    );
    expect(files[VIEW]).toBe(hostFace(TERRAIN, { fileName: 'src/terrain.shade.ts' }).view);
    const b = memoryHost(files);
    expect(runCli(['sync', '--check'], b.host, info)).toBe(0);
    expect(b.stdout()).toBe('1 host view up to date.\n');
  });

  it('--check fails on a missing or stale view, and writes nothing', () => {
    const files: Record<string, string> = { '/p/src/terrain.shade.ts': TERRAIN };
    const a = memoryHost(files);
    expect(runCli(['sync', '--check'], a.host, info)).toBe(1);
    expect(a.stderr()).toBe('src/terrain.shade.typeshade.ts is missing; run tshc sync.\n');
    expect(files[VIEW]).toBeUndefined();
    files[VIEW] = '// old\n';
    const b = memoryHost(files);
    expect(runCli(['sync', '--check'], b.host, info)).toBe(1);
    expect(b.stderr()).toBe('src/terrain.shade.typeshade.ts is stale; run tshc sync.\n');
    expect(files[VIEW]).toBe('// old\n');
  });

  it('prints the errors of a module that does not compile, and writes no view for it', () => {
    const files: Record<string, string> = {
      '/p/bad.shade.ts': `"use typeshade";\nexport function f(x: f32): f32 { return y; }\n`,
    };
    const a = memoryHost(files);
    expect(runCli(['sync'], a.host, info)).toBe(1);
    expect(a.stderr()).toMatch(/^bad\.shade\.ts:2:\d+ TS80\d\d /);
    expect(files['/p/bad.shade.typeshade.ts']).toBeUndefined();
  });

  it('writes the view of a module that imports another, reading it beside the module', () => {
    const files: Record<string, string> = {
      '/p/src/lib.shade.ts': LIB,
      '/p/src/app.shade.ts': APP,
    };
    const a = memoryHost(files);
    expect(runCli(['sync', 'src/app.shade.ts'], a.host, info)).toBe(0);
    expect(files['/p/src/app.shade.typeshade.ts']).toContain(
      'export declare function brighten(x: number): number;',
    );
  });

  it('writes the view of a module that imports a package installed above the working directory', () => {
    const files: Record<string, string> = {
      '/p/node_modules/shade-tint/package.json': JSON.stringify({
        name: 'shade-tint',
        version: '1.0.0',
        exports: { typeshade: './src/tint.shade.ts' },
      }),
      '/p/node_modules/shade-tint/src/tint.shade.ts': LIB,
      '/p/app/src/app.shade.ts': APP_OF_PACKAGE,
    };
    const a = memoryHost(files, '/p/app');
    expect(runCli(['sync', 'src/app.shade.ts'], a.host, info)).toBe(0);
    expect(files['/p/app/src/app.shade.typeshade.ts']).toContain(
      'export declare function brighten(x: number): number;',
    );
    // An error is printed at its file: relative to the working directory, or in full above it.
    files['/p/node_modules/shade-tint/src/tint.shade.ts'] = LIB.replace('x * t.gain', 'x * t.gian');
    files['/p/app/src/other.shade.ts'] =
      `"use typeshade";\nexport function f(x: f32): f32 { return y; }\n`;
    const b = memoryHost(files, '/p/app');
    expect(runCli(['sync', 'src/app.shade.ts', 'src/other.shade.ts'], b.host, info)).toBe(1);
    expect(b.stderr()).toMatch(
      /^\/p\/node_modules\/shade-tint\/src\/tint\.shade\.ts:8:16 TS8022 /m,
    );
    expect(b.stderr()).toMatch(/^src\/other\.shade\.ts:2:\d+ TS80\d\d /m);
  });

  it('refuses a file not named *.shade.ts (Rule 3.8)', () => {
    const a = memoryHost({ '/p/a.ts': TERRAIN });
    expect(runCli(['sync', 'a.ts'], a.host, info)).toBe(2);
    expect(a.stderr()).toContain('is not named *.shade.ts');
  });
});
