// Verifies: Rule 8.20 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.7 (docs/language-design.md; traced in reqs/).

import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace } from './host-face.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function face(source: string, name = 'm') {
  const f = hostFace(source, { fileName: `/app/${name}.shade.ts`, runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

async function load(source: string): Promise<Record<string, unknown>> {
  const f = face(source);
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-host-'));
  dirs.push(dir);
  const file = join(dir, 'm.shade.mjs');
  writeFileSync(file, f.code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

async function hostErrors(source: string, host: string): Promise<string[]> {
  const f = face(source, 'terrain');
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-view-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'terrain.shade.ts'), source);
  writeFileSync(join(dir, 'terrain.shade.typeshade.ts'), f.view);
  writeFileSync(join(dir, 'app.ts'), host);
  const diagnostics = await tscDiagnostics([join(dir, 'app.ts')], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    moduleSuffixes: ['.typeshade', ''],
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: [],
  });
  return diagnostics.map(
    (d) => `${d.fileName ? d.fileName.slice(dir.length + 1) : ''} TS${d.code}`,
  );
}

describe('the CPU tier runs at f32 precision (Rule 11.7)', () => {
  const SOURCE = `"use typeshade";
export function sum(a: f32, b: f32): f32 { return a + b; }
export function height(p: vec2, k: vec4): f32 {
  return k.x * sin(p.x * k.y) + k.z * cos(p.y * k.w);
}
export function lerp3(a: vec3, b: vec3, t: f32): vec3 { return mix(a, b, t); }
export function photoCell(q: vec3, k: vec4, grid: vec4): vec3 {
  const cell = floor((q.xy - grid.xy) / grid.zw);
  const d = max(q.z * k.w, 1e-4);
  return vec3(cell.x + k.x * d, cell.y + k.y * d, d * k.z);
}
export function seenEmpty(depth: f32, a: f32, b: f32, c: f32, d: f32, scale: f32): bool {
  const m = min(min(a, b), min(c, d));
  return depth * scale < m - 0.01;
}
`;
  const CASES: Record<string, unknown[][]> = {
    photoCell: [
      [
        [0.3, 0.7, 2.5],
        [0.1, 0.2, 0.3, 0.9],
        [0, 0, 0.01, 0.01],
      ],
      [
        [-1.25, 3.1, 0.7],
        [0.5, -0.25, 1e-3, 0.7],
        [0.1, -0.2, 0.05, 0.3],
      ],
    ],
    seenEmpty: [
      [0.5, 0.6, 0.7, 0.8, 0.9, 1],
      [0.1, 0.2, 0.11, 0.3, 0.4, 0.3],
    ],
    sum: [
      [1, 1e-8],
      [0.1, 0.2],
      [16777216, 1],
    ],
    height: [
      [
        [0.1, 0.7],
        [1.3, 0.5, 2.1, 0.25],
      ],
      [
        [3.3, -1.7],
        [0.7, 1.9, 0.3, 4.1],
      ],
    ],
    lerp3: [
      [[0.1, 0.2, 0.3], [0.7, 0.11, 1e-9], 0.3],
      [[1, 2, 3], [4, 5, 6], 0.1],
    ],
  };

  it('every call equals compileModule(m, { precision: "f32" }) on inputs where f32 and f64 part', async () => {
    const m = await load(SOURCE);
    const mod = compile(SOURCE).module;
    const f32 = compileModule(mod, { precision: 'f32' });
    const f64 = compileModule(mod);
    let parted = 0;
    for (const [name, rows] of Object.entries(CASES)) {
      for (const args of rows) {
        const rounded = args.map((a) =>
          Array.isArray(a) ? a.map((x) => Math.fround(x as number)) : Math.fround(a as number),
        );
        const got = (m[name] as (...a: unknown[]) => unknown)(...args);
        expect(got).toEqual(f32.fns[name]!(...(rounded as never[])));
        if (JSON.stringify(got) !== JSON.stringify(f64.fns[name]!(...(args as never[])))) parted++;
      }
    }
    expect(parted).toBeGreaterThanOrEqual(5);
  });

  it('ships no new Function: the CPU tier is module code', () => {
    const f = face(SOURCE);
    expect(f.code).not.toMatch(/new Function|\beval\(/);
    expect(f.code).toMatch(/^import \* as __ts_rt from /m);
  });

  it('generates code for the functions a host call reaches, and not an entry point', () => {
    const f = face(`"use typeshade";
export function helper(x: f32): f32 { return x * 2.; }
@fragment export function fs(): vec4 { return vec4(dpdx(1.)); }
`);
    expect(f.code).toContain('"helper": function');
    expect(f.code).not.toContain('"fs": function');
  });
});

describe('a function its calls decide, which the host imports (change 0134)', () => {
  const forms: [string, string, string][] = [
    ['an export clause', 'function g() { return 3; }', 'export { g };'],
    ['an export clause with another name', 'function g() { return 3; }', 'export { g as h };'],
    ['an export modifier', 'export function g() { return 3; }', ''],
  ];
  for (const [what, decl, clause] of forms) {
    it(`keeps the f32 under ${what}`, async () => {
      const source = `"use typeshade";\n${decl}\nexport function t(vi: u32): u32 { return vi + g(); }\n${clause}\n`;
      const name = clause.includes(' as h') ? 'h' : 'g';
      const f = face(source);
      expect(f.view).toContain(`export declare function ${name}(): f32;`);
      expect(f.view).not.toContain('g_u32');
      const m = await load(source);
      expect((m[name] as () => number)()).toBe(3);
      expect((m.t as (vi: number) => number)(2)).toBe(5);
      expect(
        await hostErrors(
          source,
          `import { ${name}, t } from './terrain.shade.ts';\nconst a: number = ${name}();\nconst b: number = t(2);\nexport { a, b };\n`,
        ),
      ).toEqual([]);
    });
  }
});
