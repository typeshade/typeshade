// Verifies: Rule 8.24 (docs/language-design.md; traced in reqs/).
// Change 0125: only a fragment with no host-supplied binding can omit its trailing object.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace } from './host-face.js';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import { tscDiagnostics } from '../../core/testing/tsc-diagnostics.js';
import { isGuard } from '../../core/host-entry.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const dir = mkdtempSync(join(tmpdir(), 'typeshade-empty-bindings-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const RED = '@fragment export function fs(): vec4 { return vec4(1., 0., 0., 1.); }';
interface Case {
  readonly name: string;
  readonly source: string;
  readonly binding?: string;
  readonly guard?: boolean;
  readonly record?: boolean;
}
const cases: readonly Case[] = [
  { name: 'empty', source: RED },
  { name: 'unreached', source: `declare const unused: uniform<f32>; ${RED}` },
  {
    name: 'another-entry',
    source: `declare const gain: uniform<f32>; ${RED}
@fragment export function bound(): vec4 { return vec4(gain); }`,
  },
  {
    name: 'guard-only',
    guard: true,
    source: `@fragment export function fs(p: builtin<"position", vec4>): vec4 {
  return vec4(f32(f64(p.x) * f64(p.x)) * 0.25, 0., 0., 1.);
}`,
  },
  {
    name: 'console-only',
    record: true,
    source: `@fragment export function fs(): vec4 {
  console.log("pixel");
  return vec4(1., 0., 0., 1.);
}`,
  },
  {
    name: 'decorator',
    source: '@fragment export function fs(): vec4 { return vec4(1., 0., 0., 1.); }',
  },
  {
    name: 'direct',
    binding: 'gain',
    source: `declare const gain: uniform<f32>;
@fragment export function fs(): vec4 { return vec4(gain, 0., 0., 1.); }`,
  },
  {
    name: 'transitive',
    binding: 'gain',
    source: `declare const gain: uniform<f32>;
function color(): vec4 { return vec4(gain, 0., 0., 1.); }
@fragment export function fs(): vec4 { return color(); }`,
  },
  ...['_fp64', '_console'].map((binding) => ({
    name: `authored${binding}`,
    binding,
    source: `declare const ${binding}: uniform<f32>;
@fragment export function fs(): vec4 { return vec4(${binding}, 0., 0., 1.); }`,
  })),
];

function checked(c: Case) {
  const source = `"use typeshade";\n${c.source}`;
  const fileName = join(dir, `${c.name}.shade.ts`);
  const f = hostFace(source, { fileName, runtime: RUNTIME, console: c.record ? 'gpu' : undefined });
  expect(compile(source).diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  const service = createTypeshadeLanguageService();
  service.openDocument(fileName, source);
  const diagnostics = service.getDiagnostics(fileName);
  // A stage attribute is the entry's form (change 0130), with no warning, as a stage call has none.
  expect(diagnostics).toEqual([]);
  service.closeDocument(fileName);
  const e = f.exports!.find((e) => e.name === 'fs');
  if (e?.kind !== 'fragment') throw new Error(`${c.name}: fs is ${e?.kind}`);
  expect(e.entry.bindings.filter((b) => !isGuard(b)).map((b) => b.name)).toEqual(
    c.binding ? [c.binding] : [],
  );
  expect(e.entry.bindings.some(isGuard)).toBe(c.guard === true);
  if (c.record) expect(e.entry.console).toBe(true);
  return f as Required<typeof f>;
}

class Canvas {
  readonly width = 2;
  readonly height = 1;
  pixels: Uint8ClampedArray | undefined;
  readonly kinds: string[] = [];
  getContext(kind: string): unknown {
    this.kinds.push(kind);
    if (kind !== '2d') return null;
    return {
      createImageData: () => ({ data: new Uint8ClampedArray(8) }),
      putImageData: (image: { data: Uint8ClampedArray }) => {
        this.pixels = image.data;
      },
    };
  }
}
const globals = globalThis as Record<string, unknown>;
beforeEach(() => {
  globals.OffscreenCanvas = Canvas;
});
afterEach(() => {
  delete globals.OffscreenCanvas;
  vi.restoreAllMocks();
});

async function draw(c: Case): Promise<(...args: unknown[]) => Promise<void>> {
  const path = join(dir, `${c.name}.mjs`);
  writeFileSync(path, checked(c).code);
  return (await import(/* @vite-ignore */ pathToFileURL(path).href)).fs;
}

describe('optional empty fragment bindings (change 0125)', () => {
  it('agrees in shader compilation, shader editing, host tsc and host editing', async () => {
    const files = cases.map((c, i) => {
      const f = checked(c);
      writeFileSync(join(dir, `view${i}.ts`), f.view);
      const app = join(dir, `app${i}.ts`);
      writeFileSync(
        app,
        `import { fs } from './view${i}';
declare const canvas: HTMLCanvasElement;
fs(canvas);
fs(canvas, undefined);
fs(canvas, {});
${c.binding ? `fs(canvas, { ${c.binding}: 1 });` : ''}
`,
      );
      return app;
    });
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      types: [],
    };
    const errors = new Map(files.map((file) => [file, [] as number[]]));
    for (const d of await tscDiagnostics(files, options)) {
      const bucket = d.fileName === undefined ? undefined : errors.get(d.fileName);
      expect(bucket, d.message).toBeDefined();
      bucket!.push(d.code);
    }
    const editor = ts.createLanguageService({
      getScriptFileNames: () => files,
      getScriptVersion: () => '0',
      getScriptSnapshot: (file) => {
        const text = ts.sys.readFile(file);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => dir,
      getCompilationSettings: () => options,
      getDefaultLibFileName: ts.getDefaultLibFilePath,
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    });
    try {
      cases.forEach((c, i) => {
        const expected = c.binding ? [2554, 2345, 2345] : [];
        expect(errors.get(files[i]!), c.name).toEqual(expected);
        expect(
          [
            ...editor.getSyntacticDiagnostics(files[i]!),
            ...editor.getSemanticDiagnostics(files[i]!),
          ].map((d) => d.code),
          c.name,
        ).toEqual(expected);
      });
    } finally {
      editor.dispose();
    }
  });

  it.each(cases.filter((c) => !c.binding))(
    '$name draws the same pixels with omitted, undefined and empty bindings',
    async (c) => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const fs = await draw(c);
      for (const args of [[], [undefined], [{}]]) {
        const target = new Canvas();
        await fs(target, ...args);
        expect([...target.pixels!]).toEqual(
          c.guard ? [16, 0, 0, 255, 143, 0, 0, 255] : [255, 0, 0, 255, 255, 0, 0, 255],
        );
      }
      if (c.record) expect(log).toHaveBeenCalledTimes(6);
    },
  );

  it.each(cases.filter((c) => c.binding))(
    '$name still requires the authored binding before drawing',
    async (c) => {
      const fs = await draw(c);
      const target = new Canvas();
      await expect(fs(target)).rejects.toThrow(
        'fs() takes 2 arguments, (target, bindings); got 1.',
      );
      await expect(fs(target, undefined)).rejects.toThrow('"bindings" is an object');
      await expect(fs(target, {})).rejects.toThrow(`binding "${c.binding}" (f32) is missing.`);
      expect(target.kinds).toEqual([]);
      await fs(target, { [c.binding!]: 1 });
      expect([...target.pixels!]).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
    },
  );

  it('preserves invalid-target, invalid-object, unknown-key and arity refusals before drawing', async () => {
    const fs = await draw(cases[0]!);
    const target = new Canvas();
    await expect(fs()).rejects.toThrow('fs() takes 1 or 2 arguments, (target, bindings?); got 0.');
    await expect(fs(target, {}, {})).rejects.toThrow(
      'fs() takes 1 or 2 arguments, (target, bindings?); got 3.',
    );
    await expect(fs({})).rejects.toThrow('"target" is an HTMLCanvasElement or an OffscreenCanvas');
    for (const value of [null, [], 1, true, 'empty'])
      await expect(fs(target, value)).rejects.toThrow('"bindings" is an object');
    await expect(fs(target, { extra: 1 })).rejects.toThrow(
      'the entry reaches no binding "extra"; it takes none.',
    );
    expect(target.kinds).toEqual([]);
    expect(target.pixels).toBeUndefined();
  });

  it('keeps a binding-free compute call positional', async () => {
    const source = '"use typeshade"; @compute([1]) export function run(): void {}';
    const f = hostFace(source, { fileName: join(dir, 'compute.shade.ts'), runtime: RUNTIME });
    expect(f.diagnostics).toEqual([]);
    expect(f.view).toContain('run(bindings: {}, workgroups:');
    const path = join(dir, 'compute.mjs');
    writeFileSync(path, f.code!);
    const { run } = await import(/* @vite-ignore */ pathToFileURL(path).href);
    await expect(run(1)).rejects.toThrow('takes 2 or 3 arguments');
    await expect(run(undefined, 1)).rejects.toThrow('"bindings" is an object');
    await expect(run({}, 1)).resolves.toBeUndefined();
  });

  it('still refuses an omitted-bindings draw inside a fuse scope before drawing', async () => {
    const fs = await draw(cases[0]!);
    const target = new Canvas();
    const { fuse } = await import('../../fuse.js');
    await expect(
      fuse(() => {
        void fs(target);
      }),
    ).rejects.toThrow('a draw');
    expect(target.kinds).toEqual([]);
    expect(target.pixels).toBeUndefined();
  });
});
