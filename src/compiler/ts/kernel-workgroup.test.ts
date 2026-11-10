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
    // `@workgroup_size([n])` is the language's form of a kernel's size (Rule 8.22, change 0130).
    expect(compiled(module(SCALE))).toEqual([]);
    expect(edited(module(SCALE))).toEqual([]);
    const konst = module(`const TILE: u32 = 128;\n${SCALE.replace('[128]', '[TILE]')}`);
    expect(compiled(konst)).toEqual([]);
    expect(edited(konst)).toEqual([]);
  });

  it('refuses the call form of change 0111 with one TS8028 in both halves (change 0140)', () => {
    const called = module(
      'export const scale = workgroup_size([128], function scale(out: array<f32>, a: array<f32>, k: f32): void {\n' +
        '  for (let i: u32 = 0; i < out.length; i++) {\n    out[i] = a[i] * k;\n  }\n});',
    );
    const refusal = [
      "error TS8028 a kernel's size is an attribute on the function declaration: write " +
        '"@workgroup_size([128]) export function scale(…)", or run "tshc migrate" (change 0130)',
    ];
    expect(compiled(called)).toEqual(refusal);
    expect(edited(called)).toEqual(refusal);
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
      '"total" has a loop that reduces, which always runs in workgroups of 256. Declare "total" without workgroup_size, or put the reduction in a function of its own.',
    ],
    [
      'TS8028, a function that is neither a kernel function nor an entry',
      module(`@workgroup_size([64])\nexport function plain(a: f32): f32 {\n  return a;\n}`),
      TS_CODES.ATTRIBUTE_NAME,
      '"workgroup_size" applies to a kernel function only: an exported function that takes an array with no size (Rule 8.22). Declare "plain" without it.',
    ],
    [
      'TS8028, an entry keeps its refusal and its text',
      module('@compute @workgroup_size(64)\nexport function main(): void {}'),
      TS_CODES.ATTRIBUTE_NAME,
      '"@workgroup_size" is WGSL\'s attribute, written here as @compute\'s argument: @compute([64]) or @compute([8, 8]); on a kernel function, @workgroup_size([n]).',
    ],
    [
      'TS8037, one extent is the grammar: two extents are refused',
      module(SCALE.replace('[128]', '[8, 8]')),
      TS_CODES.WORKGROUP_ARG,
      'workgroup_size takes an array of one whole number, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "[8, 8]" is not one.',
    ],
    [
      'TS8037, a bare number is not an array',
      module(SCALE.replace('[128]', '128')),
      TS_CODES.WORKGROUP_ARG,
      'workgroup_size takes an array of one whole number, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "128" is not one.',
    ],
    [
      'TS8037, an untyped module constant is not one (as @compute)',
      module(`const TILE = 128;\n${SCALE.replace('[128]', '[TILE]')}`),
      TS_CODES.WORKGROUP_ARG,
      'workgroup_size takes an array of one whole number, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "[TILE]" is not one.',
    ],
    [
      'TS8037, an override is not an extent in v1 (decision D2)',
      module(`declare const TILE: override<u32>;\n${SCALE.replace('[128]', '[TILE]')}`),
      TS_CODES.WORKGROUP_ARG,
      'workgroup_size takes an array of one whole number, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "[TILE]" is not one.',
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
      'warning TS8026 workgroup_size shape [512, 1, 1] has x = 512, over maxComputeWorkgroupSizeX (256). WebGPU guarantees no more, so a device requested without raising that limit refuses the pipeline.';
    expect(compiled(src)).toContain(want);
    expect(edited(src)).toContain(want);
  });
});

// Change 0130, amendment A1 (the owner's decision of 2026-11-10). Two `@workgroup_size([n])` on
// one kernel function compiled with no diagnostic in both halves, and the first one set the
// size. The attribute never reaches WGSL twice (the lowering writes one), so no Tint refusal
// stands behind this one (Rule 12.6 does not apply).
describe('a function takes at most one @workgroup_size (Rule 8.22, change 0130, amendment A1)', () => {
  /** Both halves on one source: severity, code, text and the text the diagnostic covers. */
  const ranged = (src: string): { compiler: string[][]; editor: string[][] } => {
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', src);
    return {
      compiler: compile(src, { fileName: 'm.shade.ts' }).diagnostics.map((d) => [
        d.category,
        String(d.code),
        d.message,
        src.slice(d.start, d.start + d.length),
      ]),
      editor: service
        .getDiagnostics('m.shade.ts')
        .map((d) => [
          d.severity,
          String(d.code),
          d.message,
          src.slice(d.span.start, d.span.start + d.span.length),
        ]),
    };
  };
  /** The `TS8028` row of a further attribute `second`, written after `first`, on `name`. */
  const further = (second: string, first: string, name = 'scale'): string[] => [
    'error',
    'TS8028',
    `"${second}" is a second "@workgroup_size" on "${name}", after "${first}": a function takes ` +
      `at most one "@workgroup_size([n])"; delete "${second}" (Rule 8.22).`,
    second,
  ];
  /** `scale` under the attributes `attrs`, each as written. */
  const scaled = (attrs: string): string => module(SCALE.replace('@workgroup_size([128])', attrs));
  /** The workgroup of each loop of `scale`, and the WGSL its face carries. */
  const sized = (src: string): { wg: number[]; wgsl: string } => {
    const g = hostFace(src, { fileName: '/app/m.shade.ts', runtime: RUNTIME, fuse: true });
    expect(g.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    const face = kernelFace(g.exports, 'scale') as {
      gpu?: { loops: { wg: number }[]; wgsl: string };
    };
    return { wg: face.gpu!.loops.map((l) => l.wg), wgsl: face.gpu!.wgsl };
  };

  it('refuses a second one at its own attribute, once, with the same text in both halves', () => {
    for (const [first, second] of [
      // The same size, and another size: the refusal does not depend on what the second says.
      ['@workgroup_size([8])', '@workgroup_size([8])'],
      ['@workgroup_size([8])', '@workgroup_size([16])'],
      // An argument the second one could not take is not reported beside the refusal.
      ['@workgroup_size([8])', '@workgroup_size()'],
      ['@workgroup_size([8])', '@workgroup_size([8, 8])'],
    ] as const) {
      const src = scaled(`${first} ${second}`);
      const want = [further(second, first)];
      expect(ranged(src), src).toEqual({ compiler: want, editor: want });
      expect(compile(src, { fileName: 'm.shade.ts' }).wgsl, src).toBeUndefined();
      // The sentence names what to delete (Rule 12.5). With the covered range deleted, the
      // program compiles with no diagnostic in either half, at the first attribute's size, with
      // the WGSL of the function written with that one attribute.
      const [d] = compile(src, { fileName: 'm.shade.ts' }).diagnostics;
      expect(d!.message).toContain(`delete "${src.slice(d!.start, d!.start + d!.length)}"`);
      const fixed = src.slice(0, d!.start) + src.slice(d!.start + d!.length);
      expect(ranged(fixed), fixed).toEqual({ compiler: [], editor: [] });
      expect(sized(fixed).wg).toEqual([8]);
      expect(sized(fixed).wgsl).toBe(sized(scaled(first)).wgsl);
    }
  });

  it('refuses each further one: a third gets its own diagnostic at its own attribute', () => {
    // One attribute is one mistake (Rule 12.4): each further attribute is one to delete, so each
    // is reported where it is written, as each further stage attribute is. One diagnostic for
    // all of them would leave the third to be refused after the second is deleted.
    const src = scaled('@workgroup_size([8]) @workgroup_size([16])\n@workgroup_size([32])');
    const want = [
      further('@workgroup_size([16])', '@workgroup_size([8])'),
      further('@workgroup_size([32])', '@workgroup_size([8])'),
    ];
    expect(ranged(src)).toEqual({ compiler: want, editor: want });
  });

  it('keeps one diagnostic on an attribute another refusal already covers', () => {
    // A type argument on the second one is the decorator that is not a name (Rule 6.7), alone.
    const typed = scaled('@workgroup_size([8]) @workgroup_size<f32>([8])');
    const notApplied = [
      [
        'error',
        'TS8028',
        '"@workgroup_size<f32>([8])" is not applied: an attribute is written "@name" or "@name(...)". Remove it.',
        '@workgroup_size<f32>([8])',
      ],
    ];
    expect(ranged(typed)).toEqual({ compiler: notApplied, editor: notApplied });
    // On an entry, each `@workgroup_size` keeps the refusal it had: it is WGSL's attribute there,
    // and the size is `@compute`'s argument.
    const wgsl =
      '"@workgroup_size" is WGSL\'s attribute, written here as @compute\'s argument: @compute([64]) or @compute([8, 8]); on a kernel function, @workgroup_size([n]).';
    const entry = module('@compute([8]) @workgroup_size([8])\nexport function main(): void {}');
    const one = [['error', 'TS8028', wgsl, '@workgroup_size([8])']];
    expect(ranged(entry)).toEqual({ compiler: one, editor: one });
    const twice = module(
      '@compute([8]) @workgroup_size([8]) @workgroup_size([16])\nexport function main(): void {}',
    );
    const two = [
      ['error', 'TS8028', wgsl, '@workgroup_size([8])'],
      ['error', 'TS8028', wgsl, '@workgroup_size([16])'],
    ];
    expect(ranged(twice)).toEqual({ compiler: two, editor: two });
  });

  it('reports a first one with a bad argument for that, and the second one as the second', () => {
    // Two attributes, two mistakes, one diagnostic each: the first one's argument (`TS8037`),
    // and the further attribute.
    const badFirst = scaled('@workgroup_size() @workgroup_size([16])');
    const bad = [
      [
        'error',
        'TS8037',
        'workgroup_size takes an array of one whole number, as "@workgroup_size([64])", or a module constant in it, as "@workgroup_size([TILE])"; "@workgroup_size()" is not one.',
        '@workgroup_size()',
      ],
      further('@workgroup_size([16])', '@workgroup_size()'),
    ];
    expect(ranged(badFirst)).toEqual({ compiler: bad, editor: bad });
  });

  it('refuses each one on a function that takes none, for that reason, at its own attribute', () => {
    // A function that is no kernel function takes no `@workgroup_size`, so "a second one" is not
    // what is wrong with the second: each is refused as the first is, as each is on an entry.
    const text =
      '"workgroup_size" applies to a kernel function only: an exported function that takes an array with no size (Rule 8.22). Declare "plain" without it.';
    const plain = module(
      '@workgroup_size([64]) @workgroup_size([32])\nexport function plain(a: f32): f32 {\n  return a;\n}',
    );
    const notKernel = [
      ['error', 'TS8028', text, '@workgroup_size([64])'],
      ['error', 'TS8028', text, '@workgroup_size([32])'],
    ];
    expect(ranged(plain)).toEqual({ compiler: notKernel, editor: notKernel });
  });

  it('still reads one attribute, with no diagnostic and the same size and WGSL', () => {
    for (const [attrs, wg] of [
      ['@workgroup_size([8])', 8],
      ['@workgroup_size([128])', 128],
    ] as const) {
      const src = scaled(attrs);
      expect(ranged(src), src).toEqual({ compiler: [], editor: [] });
      expect(sized(src).wg).toEqual([wg]);
      expect(sized(src).wgsl).toContain(`@compute @workgroup_size(${wg})`);
    }
    // No attribute at all keeps the default.
    const none = module(SCALE.replace('@workgroup_size([128])\n', ''));
    expect(ranged(none)).toEqual({ compiler: [], editor: [] });
    expect(sized(none).wg).toEqual([64]);
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
    expect(hover).toContain('@workgroup_size([128]) export function scale');
  });
});
