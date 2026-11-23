// ═══ The learning path (change 0145) ═══
//
// Each step is a `"use typeshade"` module and the host file that runs it, `examples/path/<id>/`.
// The module is part of the `.shade.ts` corpus, so `shade-examples.test.ts`, the emit goldens and
// the compile gate hold it. This suite holds the rest:
//
//   1. `pathExamples` (`typeshade/examples`) is the directories, in `_order.ts`'s order, with the
//      text of each file as it is on disk: `path/index.ts` is `_registry.ts`'s output;
//   2. each module is read by both halves, `compile()` and the language service, on the same
//      source (Rule 12.7);
//   3. each host's `run()`, imported through the Vite plugin in Vitest's pipeline, gives on the
//      CPU tier what the plain-JavaScript reference computes (`path/_reference.ts`), and the host
//      is the form of change 0145: `run`, and `animate` only where the step moves;
//   4. each host file type-checks as an application's does: `tshc sync` writes the host views, and
//      `tsc` reads `path/tsconfig.json` with 0 errors.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { runCli, type CliHost } from '../src/cli/run.js';
import { bothTake } from '../src/core/testing/both-halves.js';
import { pathExamples } from './index.js';
import { PATH_ORDER } from './path/_order.js';
import { REGISTRY, renderPathRegistry } from './path/_registry.js';
import { compare, reference, type Drive, type Surface } from './path/_reference.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PATH = join(HERE, 'path');
const ids = PATH_ORDER.map((s) => s.id);

describe('pathExamples: the directories, in order, with their text', () => {
  it('lists every step directory, in the order of _order.ts', () => {
    const dirs = readdirSync(PATH, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(dirs.length).toBeGreaterThanOrEqual(4);
    expect(pathExamples.map((s) => s.id)).toEqual(ids);
    expect([...ids].sort()).toEqual(dirs);
    expect(pathExamples.map((s) => s.step)).toEqual(ids.map((_, i) => i + 1));
  });

  it('carries the text of both files as they are on disk', () => {
    for (const s of pathExamples) {
      expect(s.shadeSource, s.id).toBe(readFileSync(join(HERE, s.shadeFile), 'utf8'));
      expect(s.hostSource, s.id).toBe(readFileSync(join(HERE, s.hostFile), 'utf8'));
      expect(s.shadeSource.startsWith('"use typeshade";'), s.id).toBe(true);
      expect(s.hostSource, s.id).toContain(`from './${s.id}.shade.ts'`);
      expect(s.blurb.length, s.id).toBeGreaterThan(40);
    }
  });

  it('is the file _registry.ts writes (run `bun examples/path/_registry.ts` after an edit)', async () => {
    expect(readFileSync(REGISTRY, 'utf8')).toBe(await renderPathRegistry());
  });
});

describe('the host form: run, and animate only where the step moves', () => {
  it.each(pathExamples.map((s) => [s.id, s.hostSource] as const))('%s', (id, host) => {
    expect(host, id).toMatch(
      /^export async function run\(canvas: HTMLCanvasElement \| OffscreenCanvas/m,
    );
    const moves = id === 'moving-wave' || id === 'bouncing-balls';
    expect(/^export function animate\(canvas: HTMLCanvasElement\)/m.test(host), id).toBe(moves);
    expect(host.match(/^export /gm)?.length, id).toBe(moves ? 2 : 1);
    const lead = host.split('\n').findIndex((l) => !l.startsWith('//'));
    expect(lead, id).toBeGreaterThanOrEqual(1);
    expect(lead, id).toBeLessThanOrEqual(3);
    expect(host, id).not.toMatch(/createDevice|bindGroup|createBuffer|createRenderPipeline/);
  });

  it('step 1 passes no bindings (Rule 8.24) and step 3 adds time only to the uniform of step 2', () => {
    const source = (id: string): string => pathExamples.find((s) => s.id === id)!.shadeSource;
    const host = (id: string): string => pathExamples.find((s) => s.id === id)!.hostSource;
    expect(host('first-color')).toContain('await fs(canvas);');
    expect(source('uv-gradient')).toMatch(/interface Frame \{\s*size: vec2;\s*\}/);
    expect(source('moving-wave')).toMatch(/interface Frame \{\s*size: vec2;\s*time: f32;\s*\}/);
    expect(host('uv-gradient')).toContain('{ frame: { size: [canvas.width, canvas.height] } }');
  });
});

describe('both halves read each module the same way (Rule 12.7)', () => {
  const stages = (id: string): string[] =>
    bothTake(pathExamples.find((s) => s.id === id)!.shadeSource, {
      fileName: `${id}.shade.ts`,
    }).result.module.funcs.map((f) => String(f.stage));

  it.each(ids)(
    '%s: no diagnostic from compile() or the language service, one fragment entry',
    (id) => {
      expect(stages(id).filter((s) => s === 'fragment')).toHaveLength(1);
      expect(stages(id).filter((s) => s === 'vertex' || s === 'compute')).toEqual([]);
    },
  );

  it('the editor types the position builtin and the uniform field as the compiler does', () => {
    const halves = bothTake(pathExamples.find((s) => s.id === 'uv-gradient')!.shadeSource, {
      fileName: 'uv-gradient.shade.ts',
    });
    expect(halves.hover('size: vec2')).toContain('vec2');
    expect(halves.hover('uv =')).toContain('vec2');
    expect(halves.result.module.bindings.map((b) => b.name)).toEqual(['frame']);
  });
});

class PixelCanvas {
  data: Uint8ClampedArray = new Uint8ClampedArray(0);
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(kind: string): object | null {
    if (kind !== '2d') return null;
    return {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(4 * w * h) }),
      putImageData: (img: { data: Uint8ClampedArray }) => {
        this.data = img.data.slice();
      },
    };
  }
}

async function driver(): Promise<Drive> {
  const file = join(PATH, '_drive.ts');
  return ((await import(/* @vite-ignore */ file)) as { drive: Drive }).drive;
}

describe('the CPU tier: each step draws the reference where _order.ts lists cpu', () => {
  const surface: Surface = {
    canvas: (w, h) => new PixelCanvas(w, h) as unknown as OffscreenCanvas,
    pixels: (c) => [...(c as unknown as PixelCanvas).data],
  };
  const g = globalThis as { OffscreenCanvas?: unknown };

  for (const { id, tiers } of PATH_ORDER) {
    const listed = tiers.includes('cpu');
    it(`${id}: run() on the CPU tier ${listed ? 'gives' : 'does not give'} the reference, as _order.ts says`, async () => {
      const before = g.OffscreenCanvas;
      g.OffscreenCanvas = PixelCanvas;
      try {
        const ran = await (await driver())(surface, [id]);
        if (listed) expect(compare(id, ran[id])).toEqual([]);
        else expect(compare(id, ran[id]).length, JSON.stringify(ran[id])).toBeGreaterThan(0);
      } finally {
        if (before === undefined) delete g.OffscreenCanvas;
        else g.OffscreenCanvas = before;
      }
    });
  }

  it('compare() sees a wrong pixel and a failed run (the instrument is not blind)', () => {
    const want = [...reference()['first-color']!];
    expect(compare('first-color', { pixels: want })).toEqual([]);
    want[0] = want[0]! + 10;
    expect(compare('first-color', { pixels: want })).toHaveLength(1);
    expect(compare('first-color', 'TypeError: no tier')).toHaveLength(1);
    expect(new Set(reference()['first-color']!.filter((_, i) => i % 4 === 0))).toEqual(
      new Set([51]),
    );
  });

  it('the steps draw different pictures', () => {
    const pictures = Object.values(reference()).map((p) => p.join(','));
    expect(new Set(pictures).size).toBe(pictures.length);
  });
});

describe('each host file type-checks as an application does (surface §64)', () => {
  it('tshc sync writes the views, and tsc over path/tsconfig.json reports 0 errors', () => {
    const out: string[] = [];
    const host: CliHost = {
      cwd: HERE.replace(/\\/g, '/'),
      readFile: (p) => {
        try {
          return readFileSync(p, 'utf8');
        } catch {
          return undefined;
        }
      },
      writeFile: (p, text) => writeFileSync(p, text),
      kind: (p) => {
        const s = statSync(p, { throwIfNoEntry: false });
        return s === undefined ? undefined : s.isFile() ? 'file' : 'directory';
      },
      list: (p) => readdirSync(p),
      stdout: (t) => out.push(t),
      stderr: (t) => out.push(t),
    };
    expect(runCli(['sync', 'path'], host, { version: 'test' }), out.join('')).toBe(0);

    const config = ts.getParsedCommandLineOfConfigFile(join(PATH, 'tsconfig.json'), undefined, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      },
    })!;
    expect(config.fileNames.filter((f) => f.endsWith('/host.ts')).length).toBe(ids.length);
    const errors = (program: ts.Program): string[] =>
      ts.getPreEmitDiagnostics(program).map((d) => {
        const at = d.file
          ? `${d.file.fileName.slice(HERE.length + 1)}(${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}): `
          : '';
        return `${at}TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
      });
    const program = ts.createProgram(config.fileNames, config.options);
    expect(errors(program)).toEqual([]);

    const wrong = join(PATH, 'uv-gradient', 'wrong.ts').replace(/\\/g, '/');
    const base = ts.createCompilerHost(config.options);
    const text =
      "import { fs } from './uv-gradient.shade.ts';\nexport const f = fs({} as OffscreenCanvas, { frame: { size: [1] } });\n";
    const virtual: ts.CompilerHost = {
      ...base,
      fileExists: (f) => f === wrong || base.fileExists(f),
      readFile: (f) => (f === wrong ? text : base.readFile(f)),
      getSourceFile: (f, v, ...rest) =>
        f === wrong ? ts.createSourceFile(f, text, v, true) : base.getSourceFile(f, v, ...rest),
    };
    const found = errors(
      ts.createProgram([...config.fileNames, wrong], config.options, virtual, program),
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]).toMatch(/^path\/uv-gradient\/wrong\.ts\(2\): TS2/);
  });
});
