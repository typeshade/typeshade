import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { hostFace } from './host-face.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SOURCE = `"use typeshade";
export class Particle { life: f32 = 0.; }
export declare const ps: storage<array<Particle>, "read_write">;
export declare const cam: uniform<Particle>;
@compute([1]) export function step(id: builtin<"global_invocation_id">) { ps[id.x].life = cam.life; }
`;

const lineErrors = async (lib: string[]): Promise<string[]> => {
  const view = hostFace(SOURCE, { fileName: '/app/scene.shade.ts', runtime: RUNTIME }).view;
  if (view === undefined) throw new Error('the module has no host view');
  const dir = mkdtempSync(join(tmpdir(), 'typeshade-host-view-lib-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'scene.shade.ts'), SOURCE);
  writeFileSync(join(dir, 'scene.shade.typeshade.ts'), view);
  const app = join(dir, 'app.ts');
  const lines = [
    'ps.resize(2);',
    'ps.dispose();',
    'cam.dispose();',
    'cam.set({ life: 1 });',
    'const d: Disposable = ps;',
  ];
  writeFileSync(
    app,
    `import { ps, cam } from './scene.shade.ts';\n${lines.join('\n')}\nexport { ps };\n`,
  );
  const found = await tscDiagnostics([app], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    moduleSuffixes: ['.typeshade', ''],
    lib,
    types: [],
  });
  return found.map((d) => `${d.fileName === app ? (d.line ?? 0) - 1 : d.fileName} TS${d.code}`);
};

describe('the type of an exported binding has no dispose under either lib', () => {
  it('has no dispose() and no Symbol.dispose under a lib that declares one', async () => {
    expect(
      await lineErrors(['lib.es2022.d.ts', 'lib.esnext.disposable.d.ts', 'lib.dom.d.ts']),
    ).toEqual(['2 TS2339', '3 TS2339', '5 TS2741']);
  });

  it('has no dispose() and no other error under a lib that declares no Symbol.dispose', async () => {
    expect(await lineErrors(['lib.es2022.d.ts', 'lib.dom.d.ts'])).toEqual(['2 TS2339', '3 TS2339']);
  });
});
