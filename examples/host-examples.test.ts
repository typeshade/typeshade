// ═══ The host examples (change 0061) ═══
//
// Each host example is a `"use typeshade"` module and the host file that runs it,
// `examples/hosts/<id>/`. The module is part of the `.shade.ts` corpus, so `shade-examples.test.ts`,
// the emit goldens and the compile gate hold it. This suite holds the rest:
//
//   1. `hostExamples` (`typeshade/examples`) is the directories, in `_order.ts`'s order, with the
//      text of each file as it is on disk: `hosts/index.ts` is `_registry.ts`'s output;
//   2. each host's `run()`, imported here as an application imports it, through the Vite plugin
//      in Vitest's pipeline (`vitest.config.ts`), gives on the CPU tier what the plain-JavaScript
//      reference computes (`hosts/_reference.ts`). Node has no WebGPU and no WebGL2, so a kernel
//      call and an entry call run on the CPU tier, and a draw paints a canvas whose one context is
//      `2d`. `host-program` runs on the program runtime, which has no CPU tier (surface §69): its
//      fragment entry is held to the same reference through the CPU oracle instead;
//   3. each host file type-checks as an application's does: `tshc sync` writes the host views,
//      and `tsc` reads `hosts/tsconfig.json`, the setup of surface §64, with 0 errors, and finds
//      the error in a wrong call.
//
// `bun run gate:journeys` runs the same `run()`s on headless WebGPU against the same reference.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { compile, compileModule } from '../src/index.js';
import { runCli, type CliHost } from '../src/cli/run.js';
import { hostExamples } from './index.js';
import { HOST_ORDER } from './hosts/_order.js';
import { REGISTRY, renderHostRegistry } from './hosts/_registry.js';
import { compare, INPUTS, reference, type Drive, type Surface } from './hosts/_reference.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOSTS = join(HERE, 'hosts');

describe('hostExamples: the directories, in order, with their text', () => {
  it('lists every host example directory, in the order of _order.ts', () => {
    const dirs = readdirSync(HOSTS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    // The floor: a scan that read nothing would agree with an empty list.
    expect(dirs.length).toBeGreaterThanOrEqual(6);
    expect(hostExamples.map((h) => h.id)).toEqual(HOST_ORDER.map((h) => h.id));
    expect([...hostExamples.map((h) => h.id)].sort()).toEqual(dirs);
  });

  it('carries the text of both files as they are on disk', () => {
    for (const h of hostExamples) {
      expect(h.shadeSource, h.id).toBe(readFileSync(join(HERE, h.shadeFile), 'utf8'));
      expect(h.hostSource, h.id).toBe(readFileSync(join(HERE, h.hostFile), 'utf8'));
      expect(h.shadeSource.startsWith('"use typeshade";'), h.id).toBe(true);
      expect(h.hostSource, h.id).toContain(`from './${h.id}.shade.ts'`);
      expect(h.hostSource, h.id).toMatch(/^export async function run\(/m);
      expect(h.blurb.length, h.id).toBeGreaterThan(40);
    }
  });

  it('is the file _registry.ts writes (run `bun examples/hosts/_registry.ts` after an edit)', async () => {
    expect(readFileSync(REGISTRY, 'utf8')).toBe(await renderHostRegistry());
  });
});

/** A canvas with one context, `2d`, that keeps what the CPU tier puts on it: `OffscreenCanvas`
 *  as far as a draw reads one. Node has no canvas of its own. */
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

/** The driver, imported by a computed path: `tsconfig.tests.json` does not read the host files,
 *  which resolve their module to its host view only under `hosts/tsconfig.json`. */
async function driver(): Promise<Drive> {
  const file = join(HOSTS, '_drive.ts');
  return ((await import(/* @vite-ignore */ file)) as { drive: Drive }).drive;
}

describe('the CPU tier: each host gives the reference exactly where _order.ts lists cpu', () => {
  const surface: Surface = {
    canvas: (w, h) => new PixelCanvas(w, h) as unknown as OffscreenCanvas,
    pixels: (c) => [...(c as unknown as PixelCanvas).data],
  };
  const g = globalThis as { OffscreenCanvas?: unknown };

  // Every host, whatever it lists: `tiers` names `cpu` exactly when the CPU-tier run gives the
  // reference, so a listed tier that fails and an unlisted one that passes both fail here.
  for (const { id, tiers } of HOST_ORDER) {
    const listed = tiers.includes('cpu');
    it(`${id}: run() on the CPU tier ${listed ? 'gives' : 'does not give'} the reference, as _order.ts says`, async () => {
      const before = g.OffscreenCanvas;
      g.OffscreenCanvas = PixelCanvas;
      try {
        const drive = await driver();
        const ran = await drive(surface, [id]);
        if (listed) expect(compare(id, ran[id])).toEqual([]);
        else expect(compare(id, ran[id]).length, JSON.stringify(ran[id])).toBeGreaterThan(0);
      } finally {
        if (before === undefined) delete g.OffscreenCanvas;
        else g.OffscreenCanvas = before;
      }
    });
  }

  it('loop-fuse: on the CPU tier nothing is dispatched, and no group is fused', async () => {
    // Only WebGPU fuses (change 0058); the gate holds the WebGPU reports. Here each scope's
    // calls run one after another on the CPU tier, with the same result.
    const file = join(HOSTS, '_drive.ts');
    const m = (await import(/* @vite-ignore */ file)) as {
      drive: Drive;
      reports: Record<string, { tier: string; dispatches: number; groups: { fused: boolean }[] }>;
    };
    const ran = await m.drive(surface, ['loop-fuse']);
    expect(compare('loop-fuse', ran['loop-fuse'])).toEqual([]);
    for (const scope of ['chain', 'split', 'reduce']) {
      const r = m.reports[scope];
      expect(r?.tier, JSON.stringify(r)).toBe('cpu');
      expect(r?.dispatches).toBe(0);
      expect(r?.groups.length).toBeGreaterThan(0);
      expect(r?.groups.every((g) => !g.fused)).toBe(true);
    }
  });

  it('compare() sees a wrong value (the instrument is not blind)', () => {
    const want = reference()['host-compute']!;
    const ys = [...want['ys']!.values];
    const correct = { ys, direct: want['direct']!.values, planned: want['planned']!.values };
    expect(compare('host-compute', correct)).toEqual([]);
    ys[7] = ys[7]! + 1;
    expect(compare('host-compute', correct)).toHaveLength(1);
    expect(compare('host-compute', 'TypeError: no tier')).toHaveLength(1);
  });

  it('host-program: the fragment entry gives the reference on the CPU oracle', () => {
    // The program runtime has no CPU tier, so this holds the program, not the host, on the CPU:
    // the binding values are the ones `run()` passes for its last frame.
    expect(HOST_ORDER.find((h) => h.id === 'host-program')?.tiers).not.toContain('cpu');
    const source = readFileSync(join(HOSTS, 'host-program', 'host-program.shade.ts'), 'utf8');
    const m = compileModule(compile(source).module, { precision: 'f32' });
    const { size, times } = INPUTS.program;
    m.setBinding('sky', { size: [size, size], time: times[times.length - 1]! });
    const pixels: number[] = [];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const { color } = m.fns['fs']!([x + 0.5, y + 0.5, 0, 1]) as unknown as {
          color: number[];
        };
        for (const c of color) pixels.push(Math.round(Math.min(1, Math.max(0, c)) * 255));
      }
    expect(compare('host-program', { pixels })).toEqual([]);
  });
});

describe('each host file type-checks as an application does (surface §64)', () => {
  it('tshc sync writes the views, and tsc over hosts/tsconfig.json reports 0 errors', () => {
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
    expect(runCli(['sync', 'hosts'], host, { version: 'test' }), out.join('')).toBe(0);

    const config = ts.getParsedCommandLineOfConfigFile(join(HOSTS, 'tsconfig.json'), undefined, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      },
    })!;
    const hostFiles = config.fileNames.filter((f) => f.endsWith('/host.ts'));
    expect(hostFiles.length).toBe(HOST_ORDER.length);
    const errors = (program: ts.Program): string[] =>
      ts.getPreEmitDiagnostics(program).map((d) => {
        const at = d.file
          ? `${d.file.fileName.slice(HERE.length + 1)}(${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}): `
          : '';
        return `${at}TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
      });
    const program = ts.createProgram(config.fileNames, config.options);
    expect(errors(program)).toEqual([]);

    // The instrument: a wrong-length vector at a host's own line is TS2345 there.
    const wrong = join(HOSTS, 'host-helper', 'wrong.ts');
    const base = ts.createCompilerHost(config.options);
    const text =
      "import { height } from './host-helper.shade.ts';\nexport const h = height([0.5]);\n";
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
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^hosts\/host-helper\/wrong\.ts\(2\): TS2345 /);
  });
});
