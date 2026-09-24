// Verifies: Rule 3.8 (docs/language-design.md; traced in reqs/).
//
// The Vite plugin (`typeshade/vite`, change 0009) and `typeshade sync`, the two writers of a
// shader module's host face. Vitest runs on Vite with the plugin in its pipeline
// (`vitest.config.ts`), so the first case imports a `.shade.ts` the way a host file does and
// calls what it exports; the rest drive the plugin's hook and the command directly.

import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      fs: () => never;
    };
    const args = [
      [0.5, 0.5],
      [1, 0.5, 2, 0.25],
    ] as const;
    const oracle = compileModule(compile(TERRAIN).module, { precision: 'f32' });
    expect(m.height(...args)).toBe(oracle.fns.height!(...(args as unknown as never[])));
    expect(m.K).toBe(0.5);
    expect(() => m.fs()).toThrow(TypeError);
    expect(readFileSync(join(dir, 'terrain.shade.typeshade.ts'), 'utf8')).toBe(
      hostFace(TERRAIN, { fileName: file }).view,
    );
  });
});

describe('the plugin hook', () => {
  it('passes a host file through untouched', async () => {
    expect(await typeshade().transform('export const x = 1;', '/app/main.ts')).toBeNull();
  });

  it('returns the generated module for a .shade.ts, importing the runtime subpath', async () => {
    const dir = tempDir();
    const out = await typeshade().transform(TERRAIN, join(dir, 'terrain.shade.ts'));
    expect(out?.code).toMatch(/^import \* as __ts_rt from "typeshade\/runtime";$/m);
    expect(out?.code).toContain('export function height(p, k) {');
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

describe('typeshade sync', () => {
  function memoryHost(files: Record<string, string>) {
    const out: string[] = [];
    const err: string[] = [];
    const host: CliHost = {
      cwd: '/p',
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
    expect(a.stderr()).toBe('src/terrain.shade.typeshade.ts is missing; run typeshade sync.\n');
    expect(files[VIEW]).toBeUndefined();
    files[VIEW] = '// old\n';
    const b = memoryHost(files);
    expect(runCli(['sync', '--check'], b.host, info)).toBe(1);
    expect(b.stderr()).toBe('src/terrain.shade.typeshade.ts is stale; run typeshade sync.\n');
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

  it('refuses a file not named *.shade.ts (Rule 3.8)', () => {
    const a = memoryHost({ '/p/a.ts': TERRAIN });
    expect(runCli(['sync', 'a.ts'], a.host, info)).toBe(2);
    expect(a.stderr()).toContain('is not named *.shade.ts');
  });
});
