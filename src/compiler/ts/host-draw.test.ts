// Verifies: Rule 8.24 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 8.21 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.7 (docs/language-design.md; traced in reqs/).
//
// A full-screen `@fragment` entry drawn from host code (change 0016, part 2):
// `entry(target, bindings)`. Read twice, as every host call is: `tsc` reads the host view (the
// target, the bindings object), and the program runs the generated module. Node has no WebGPU,
// no WebGL2 and no canvas, so the draws here run on the CPU tier into a stand-in
// `OffscreenCanvas` whose only context is `2d`, and each frame is held against the plain
// JavaScript reference. The WebGPU and WebGL2 tiers are checked in a browser by the import
// journey (`scripts/user-journey.ts`), frame against frame.

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { hostFace, type HostExport } from './host-face.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');
const ROOT = resolve(__dirname, '../../..');
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'typeshade-draw-'));
  dirs.push(d);
  return d;
};

function face(source: string) {
  const f = hostFace(source, { fileName: '/app/m.shade.ts', runtime: RUNTIME });
  expect(f.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return f as Required<typeof f>;
}

async function load(source: string): Promise<Record<string, unknown>> {
  const file = join(tempDir(), 'm.shade.mjs');
  writeFileSync(file, face(source).code);
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>;
}

const fragmentOf = (exports: readonly HostExport[], name: string) => {
  const e = exports.find((x) => x.name === name);
  if (e?.kind !== 'fragment') throw new Error(`${name} is ${e?.kind}`);
  return e;
};
const reasonOf = (exports: readonly HostExport[], name: string): string => {
  const e = exports.find((x) => x.name === name);
  if (e?.kind !== 'never') throw new Error(`${name} is ${e?.kind}`);
  return e.reason;
};

const PLASMA = readFileSync(join(ROOT, 'journeys/plasma/plasma.shade.ts'), 'utf8');

/** What plasma's `fs` computes at the pixel (x, y), in plain JavaScript, 0 to 255. */
function plasmaPixel(x: number, y: number, time: number, scale: number): number[] {
  const u = (x + 0.5) * scale;
  const w = (y + 0.5) * scale;
  let v = 0;
  for (let i = 0; i < 4; i++) {
    const k = i + 1;
    v += (Math.sin(u * k + time) * Math.cos(w * k - time)) / k;
  }
  const c = v * 0.5 + 0.5;
  // The target clamps each channel to [0, 1] before it rounds it to 8 bits.
  return [c, c * c, 1 - c, 1].map((x) => Math.min(1, Math.max(0, x)) * 255);
}

// ─── a canvas for Node: one `2d` context whose pixels a test reads ──────────────────────────

class FakeImageData {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(4 * width * height);
  }
}

class FakeCanvas {
  pixels: Uint8ClampedArray | undefined;
  kinds: string[] = [];
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(kind: string): unknown {
    this.kinds.push(kind);
    if (kind !== '2d') return null;
    return {
      createImageData: (w: number, h: number) => new FakeImageData(w, h),
      putImageData: (img: FakeImageData) => {
        this.pixels = img.data;
      },
    };
  }
}

const g = globalThis as Record<string, unknown>;
beforeEach(() => {
  g['OffscreenCanvas'] = FakeCanvas;
  g['ImageData'] = FakeImageData;
});
afterEach(() => {
  delete g['OffscreenCanvas'];
  delete g['ImageData'];
});

// ─── which entries a host can draw ───────────────────────────────────────────────────────────

describe('which fragment entries a host can draw (Rule 8.24)', () => {
  const f = face(`"use typeshade";
class Frame { time: f32; }
declare const frame: uniform<Frame>;
declare const data: storage<array<f32>>;
declare const tex: texture_2d<f32>;
declare const smp: sampler;
class Color { @location(0) color: vec4; }
class Two { @location(0) a: vec4; @location(1) b: vec4; }

@fragment
export function bare(@builtin("position") p: vec4, @builtin("front_facing") ff: bool): vec4 {
  return ff ? vec4(p.xy * frame.time, 0., 1.) : vec4(0.);
}
@fragment
export function inStruct(@builtin("position") p: vec4): Color { return { color: p }; }
@fragment
export function fromVertex(@location(0) uv: vec2): vec4 { return vec4(uv, 0., 1.); }
@fragment
export function twoTargets(@builtin("position") p: vec4): Two { return { a: p, b: p }; }
@fragment
export function stored(@builtin("position") p: vec4): vec4 { return vec4(data[u32(p.x)]); }
@fragment
export function sampled(@builtin("position") p: vec4): vec4 { return textureSample(tex, smp, p.xy); }
@fragment
export function derivative(@builtin("position") p: vec4): vec4 { return vec4(dpdx(p.x)); }
`);

  it('draws an entry that reads its position and writes one @location(0) vec4', () => {
    const bare = fragmentOf(f.exports, 'bare');
    expect(bare.entry.params).toEqual(['position', 'front_facing']);
    expect(bare.entry.out).toBeNull();
    expect(fragmentOf(f.exports, 'inStruct').entry.out).toBe('color');
    expect(bare.entry.gl?.blocks).toEqual({ frame: 'Frame' });
    expect(bare.entry.noCpu).toBeUndefined();
  });

  it('refuses an entry that reads what a vertex entry writes, or writes more than one colour', () => {
    expect(reasonOf(f.exports, 'fromVertex')).toBe(
      'parameter "uv" is what a vertex entry writes, and a draw has no vertex entry but its full-screen triangle; #204, the rendering design, adds a mesh',
    );
    expect(reasonOf(f.exports, 'twoTargets')).toBe(
      'a draw writes one @location(0) vec4 colour, a vec4 result or a struct of that one field',
    );
  });

  it('says which tiers an entry has, and why not the others', () => {
    expect(fragmentOf(f.exports, 'stored').entry.noGl).toBe(
      'it reaches the storage binding "data", and GLSL ES 3.00 has no storage buffer',
    );
    const plain = face(`"use typeshade";
declare const k: uniform<f32>;
@fragment
export function plainUniform(@builtin("position") p: vec4): vec4 { return p * k; }
`);
    expect(fragmentOf(plain.exports, 'plainUniform').entry.noGl).toMatch(
      /^the GLSL backend refuses it: .*uniform binding 'k' must be a struct/,
    );
    const sampled = fragmentOf(f.exports, 'sampled').entry;
    expect(sampled.gl?.samplers).toEqual({ tex: 'smp' });
    expect(sampled.noCpu).toBe(
      'it reaches the texture_2d<f32> "tex", which the CPU tier cannot read',
    );
    const helper = face(`"use typeshade";
declare const tex: texture_2d<f32>;
declare const smp: sampler;
function pick(t: texture_2d<f32>, s: sampler, uv: vec2): vec4 { return textureSample(t, s, uv); }
@fragment
export function throughHelper(@builtin("position") p: vec4): vec4 { return pick(tex, smp, p.xy); }
`);
    expect(fragmentOf(helper.exports, 'throughHelper').entry.noGl).toMatch(
      /^the GLSL backend refuses it: .*standalone sampler/,
    );
    expect(fragmentOf(f.exports, 'derivative').entry.noCpu).toBe(
      'it reaches dpdx(), which only a GPU computes',
    );
  });

  it('generates CPU code only for an entry the CPU tier can draw', () => {
    expect(f.code).toContain('"bare": function');
    expect(f.code).not.toContain('"derivative": function');
    expect(f.code).not.toContain('"sampled": function');
  });
});

// ─── the host view ───────────────────────────────────────────────────────────────────────────

/** The errors plain `tsc` reports for the host file `app.ts` beside the module and its view,
 *  with the DOM library a browser host has. */
function hostErrors(source: string, app: string): string[] {
  const dir = tempDir();
  const f = face(source);
  writeFileSync(join(dir, 'm.shade.ts'), source);
  writeFileSync(join(dir, 'm.shade.typeshade.ts'), f.view);
  writeFileSync(join(dir, 'app.ts'), app);
  const program = ts.createProgram([join(dir, 'app.ts')], {
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
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => `${d.file ? d.file.fileName.split('/').pop() : ''} TS${d.code}`);
}

describe('the host view of a draw', () => {
  it('types the target and the bindings object exactly', () => {
    expect(face(PLASMA).view).toContain(
      'export declare function fs(target: HTMLCanvasElement | OffscreenCanvas, bindings: { readonly frame: { readonly time: number; readonly scale: number } }): Promise<void>;',
    );
  });

  it('type-checks a draw with plain tsc, and a misspelled binding at the host line', () => {
    const draw = (bindings: string): string =>
      `import { fs } from './m.shade.ts';\nconst c = document.createElement('canvas');\nexport const p: Promise<void> = fs(c, ${bindings});\n`;
    expect(hostErrors(PLASMA, draw('{ frame: { time: 1, scale: 0.02 } }'))).toEqual([]);
    expect(hostErrors(PLASMA, draw('{ frame: { time: 1, scael: 0.02 } }'))).toEqual([
      'app.ts TS2561',
    ]);
    expect(
      hostErrors(
        PLASMA,
        `import { fs } from './m.shade.ts';\nfs({}, { frame: { time: 1, scale: 1 } });\n`,
      ),
    ).toEqual(['app.ts TS2345']);
  });
});

// ─── the draw, on the CPU tier ───────────────────────────────────────────────────────────────

describe('the draw, on the CPU tier where there is no WebGPU or WebGL2', () => {
  it('draws plasma into the canvas, each pixel as the reference computes it', async () => {
    const m = await load(PLASMA);
    const fs = m.fs as (c: unknown, b: unknown) => Promise<void>;
    const c = new FakeCanvas(16, 12);
    await fs(c, { frame: { time: 1.25, scale: 0.09 } });
    let worst = 0;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const want = plasmaPixel(x, y, 1.25, 0.09);
        for (let i = 0; i < 4; i++)
          worst = Math.max(worst, Math.abs(c.pixels![4 * (y * c.width + x) + i]! - want[i]!));
      }
    // f32 against the f64 reference, rounded to 8 bits.
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('draws in call order, each with the values it was called with', async () => {
    const m = await load(PLASMA);
    const fs = m.fs as (c: unknown, b: unknown) => Promise<void>;
    const c = new FakeCanvas(4, 4);
    const frame = { time: 0, scale: 0.5 };
    const first = fs(c, frame.time === 0 ? { frame } : {});
    const snapshot = { frame: { ...frame } };
    frame.time = 2; // after the call: the queued frame keeps time 0
    await first;
    const seen = [...c.pixels!];
    await fs(c, snapshot);
    expect([...c.pixels!]).toEqual(seen);
    // The canvas kept the tier its first draw chose: it asked for each context once.
    expect(c.kinds).toEqual(['webgl2', '2d']);
  });

  it('writes a discarded pixel as the clear colour, opaque black', async () => {
    const m = await load(`"use typeshade";
@fragment
export function half(@builtin("position") p: vec4): vec4 {
  if (p.x < 2.) { discard; }
  return vec4(1., 1., 1., 0.5);
}
`);
    const c = new FakeCanvas(4, 1);
    await (m.half as (c: unknown, b: unknown) => Promise<void>)(c, {});
    expect([...c.pixels!]).toEqual([
      0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
    ]);
  });
});

describe('a draw refuses what does not fit, naming the entry and the binding', () => {
  it('refuses the arguments', async () => {
    const m = await load(PLASMA);
    const fs = m.fs as (...a: unknown[]) => Promise<void>;
    const c = new FakeCanvas(2, 2);
    await expect(fs(c)).rejects.toThrow(
      new TypeError('fs() takes 2 arguments, (target, bindings); got 1.'),
    );
    await expect(fs({}, { frame: { time: 0, scale: 1 } })).rejects.toThrow(
      '"target" is an HTMLCanvasElement or an OffscreenCanvas; got an object.',
    );
    await expect(fs(c, {})).rejects.toThrow('binding "frame" (Frame) is missing.');
    await expect(fs(c, { frame: { time: 0 } })).rejects.toThrow(
      'binding "frame" (Frame): at .scale, the field is missing.',
    );
  });

  it('refuses an image and a sampler that do not fit', async () => {
    const m = await load(`"use typeshade";
declare const tex: texture_2d<f32>;
declare const smp: sampler;
@fragment
export function show(@builtin("position") p: vec4): vec4 { return textureSample(tex, smp, p.xy); }
`);
    const show = m.show as (...a: unknown[]) => Promise<void>;
    const c = new FakeCanvas(2, 2);
    await expect(show(c, { tex: [1, 2] })).rejects.toThrow(
      'show(): binding "tex" (texture_2d<f32>): got an array of length 2, not an image source.',
    );
    await expect(show(c, { tex: new FakeImageData(0, 0) })).rejects.toThrow(
      'got a ImageData of no pixels (0x0); an image draws once it has loaded.',
    );
    await expect(
      show(c, { tex: new FakeImageData(1, 1), smp: { filter: 'cubic' } }),
    ).rejects.toThrow(
      `binding "smp" (sampler): got filter the string "cubic"; it is 'nearest' or 'linear'.`,
    );
    // A sampled texture has no CPU tier, and nothing else draws into this canvas.
    await expect(show(c, { tex: new FakeImageData(1, 1) })).rejects.toThrow(
      'show(): nothing can draw it into this canvas: there is no WebGPU; no webgl2 context; no CPU tier (it reaches the texture_2d<f32> "tex", which the CPU tier cannot read).',
    );
  });
});
