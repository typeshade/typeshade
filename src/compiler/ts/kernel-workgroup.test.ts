// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 6.7 (docs/language-design.md; traced in reqs/).
// Verifies: Rule 11.13 (docs/language-design.md; traced in reqs/).
//
// A kernel function's `@workgroup_size([n])` (proposal 0067): one extent, read as `@compute`'s is,
// that sets the workgroup of each loop the function lowers, and is refused where it does not apply
// (`TS8028`), where its argument is not one extent (`TS8037`), where a loop reduces (`TS8077`) and
// over WebGPU's default limit (`TS8026`, a warning). Each form and each refusal is read twice, as
// every program an author writes is (CLAUDE.md "A test reads both halves"): `compile()` gives the
// diagnostic with its text, and the language service's `getDiagnostics` gives the same code and
// text on the same source.

import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { compile } from './compile.js';
import { hostFace } from './host-face.js';
import { TS_CODES } from './codes.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const RUNTIME = resolve(__dirname, '../../core/host-runtime.ts');

const module = (body: string): string => `"use typeshade";\n${body}\n`;

/** The face the host export of kernel function `name` carries. */
const kernelFace = (exports: ReturnType<typeof hostFace>['exports'], name: string) => {
  const e = (exports ?? []).find((x) => x.kind === 'kernel' && x.name === name);
  if (e?.kind !== 'kernel') throw new Error(`no kernel export "${name}"`);
  return e.face;
};

/** The compiler's diagnostics as `severity code text`. */
const compiled = (src: string): string[] =>
  compile(src, { fileName: 'm.shade.ts' }).diagnostics.map(
    (d) => `${d.category} ${d.code} ${d.message}`,
  );

/** The language service's diagnostics for the same source, in the same form. */
const edited = (src: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('m.shade.ts', src);
  return service
    .getDiagnostics('m.shade.ts')
    .map((d) => `${d.severity} ${String(d.code)} ${d.message}`);
};

const SCALE = `@workgroup_size([128])
export function scale(out: array<f32>, a: array<f32>, k: f32): void {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = a[i] * k;
  }
}`;

const TOTAL = `@workgroup_size([128])
export function total(xs: array<f32>): f32 {
  let s: f32 = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}`;

describe('a kernel function declares its workgroup size (proposal 0067)', () => {
  it('accepts a literal, and a typed module constant, with no diagnostic in either half', () => {
    expect(compiled(module(SCALE))).toEqual([]);
    expect(edited(module(SCALE))).toEqual([]);
    const konst = module(`const TILE: u32 = 128;\n${SCALE.replace('[128]', '[TILE]')}`);
    expect(compiled(konst)).toEqual([]);
    expect(edited(konst)).toEqual([]);
  });

  it('gives the function a face whose loop runs at the declared size, and says the size is declared', () => {
    const g = hostFace(module(SCALE), {
      fileName: '/app/m.shade.ts',
      runtime: RUNTIME,
      fuse: true,
    });
    expect(g.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const face = kernelFace(g.exports, 'scale') as {
      gpu?: { loops: { wg: number }[]; wgsl: string };
      fuse?: { facts: { wg: number; declared?: boolean }[] };
    };
    expect(face.gpu!.loops.map((l) => l.wg)).toEqual([128]);
    expect(face.fuse!.facts.map((f) => [f.wg, f.declared])).toEqual([[128, true]]);
    // The lowered entry is written at the size: its attribute and its invocation index.
    expect(face.gpu!.wgsl).toContain('@compute @workgroup_size(128)');
    expect(face.gpu!.wgsl).not.toMatch(/workgroup_size\(64\)/);
    expect(face.gpu!.wgsl).toContain('128u');
  });

  it('gives a kernel function with no attribute the default of 64, and no declared size', () => {
    const plain = module(SCALE.replace('@workgroup_size([128])\n', ''));
    const g = hostFace(plain, { fileName: '/app/m.shade.ts', runtime: RUNTIME, fuse: true });
    const face = kernelFace(g.exports, 'scale') as {
      gpu?: { loops: { wg: number }[] };
      fuse?: { facts: { declared?: boolean }[] };
    };
    expect(face.gpu!.loops.map((l) => l.wg)).toEqual([64]);
    expect(face.fuse!.facts[0]!.declared).toBeUndefined();
  });
});

describe('a refusal of @workgroup_size reads the same in compile() and the language service', () => {
  const rows: readonly (readonly [string, string, string, string])[] = [
    [
      'TS8077, a kernel function whose loop reduces',
      module(TOTAL),
      TS_CODES.KERNEL_WORKGROUP_REDUCES,
      '"total" has a loop that reduces, which always runs in workgroups of 256. Remove @workgroup_size from "total", or put the reduction in a function of its own.',
    ],
    [
      'TS8028, a function that is neither a kernel function nor an entry',
      module(`@workgroup_size([64])\nexport function plain(a: f32): f32 {\n  return a;\n}`),
      TS_CODES.ATTRIBUTE_NAME,
      '"@workgroup_size" applies to a kernel function only: an exported function that takes an array with no size (Rule 8.22). Remove it from "plain".',
    ],
    [
      'TS8028, an entry keeps its refusal and its text',
      module('@compute @workgroup_size(64)\nexport function main(): void {}'),
      TS_CODES.ATTRIBUTE_NAME,
      '"@workgroup_size" is WGSL\'s attribute, written here as @compute\'s argument: @compute([64]) or @compute([8, 8]).',
    ],
    [
      'TS8037, one extent is the grammar: two extents are refused',
      module(SCALE.replace('[128]', '[8, 8]')),
      TS_CODES.WORKGROUP_ARG,
      '@workgroup_size takes an array of one whole number on a kernel function, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "@workgroup_size([8, 8])" is not one.',
    ],
    [
      'TS8037, a bare number is not an array',
      module(SCALE.replace('[128]', '128')),
      TS_CODES.WORKGROUP_ARG,
      '@workgroup_size takes an array of one whole number on a kernel function, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "@workgroup_size(128)" is not one.',
    ],
    [
      'TS8037, an untyped module constant is not one (as @compute)',
      module(`const TILE = 128;\n${SCALE.replace('[128]', '[TILE]')}`),
      TS_CODES.WORKGROUP_ARG,
      '@workgroup_size takes an array of one whole number on a kernel function, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "@workgroup_size([TILE])" is not one.',
    ],
    [
      'TS8037, an override is not an extent in v1 (decision D2)',
      module(`declare const TILE: override<u32>;\n${SCALE.replace('[128]', '[TILE]')}`),
      TS_CODES.WORKGROUP_ARG,
      '@workgroup_size takes an array of one whole number on a kernel function, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "@workgroup_size([TILE])" is not one.',
    ],
  ];

  it.each(rows)('%s', (_name, src, code, text) => {
    const want = `error ${code} ${text}`;
    expect(compiled(src)).toContain(want);
    expect(edited(src)).toContain(want);
  });

  it("warns TS8026 on an extent over WebGPU's default limit, in both halves", () => {
    const src = module(SCALE.replace('[128]', '[512]'));
    const want =
      'warning TS8026 @workgroup_size shape [512, 1, 1] has x = 512, over maxComputeWorkgroupSizeX (256). WebGPU guarantees no more, so a device requested without raising that limit refuses the pipeline.';
    expect(compiled(src)).toContain(want);
    expect(edited(src)).toContain(want);
  });
});

describe('the editor shows the declared shape (Rule 12.7)', () => {
  it('shows the attribute on a kernel function, with its extent, where the editor hovers it', () => {
    const src = module(SCALE);
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', src);
    const at = service.positionAt('m.shade.ts', src.indexOf('workgroup_size') + 2);
    const hover = service.getHover('m.shade.ts', at)?.contents ?? '';
    expect(hover).toContain('workgroup_size');
    expect(hover).toContain('@workgroup_size([128])');
  });
});
