// The kernel proof's corpus (#350, part C of #347). The proof of Rule 8.22 is conservative on
// purpose: it works with no solver and no alias analysis, so a false refusal is a missed
// optimization and not wrong code, and nothing failed when #345 refused a loop it should have
// taken. Other compilers catch that class with a corpus of the loops a vectorizer must take (TSVC)
// and with rewrites that keep a program's meaning and so must keep the compiler's answer (EMI for
// GCC and LLVM, GraphicsFuzz for shader compilers). This file is both, for the loop patterns
// measured on `main` at 22120e7 while answering "what does a Houdini-like tool lack".
//
// Each entry is a kernel function and the answer the proof must give: the GPU with its number of
// loops, or the CPU with its TS8070 warning, read in both halves (the compiler and the editor).
// Each also runs on the CPU tier against a plain JavaScript reference, so a refusal is never
// taken for a wrong result. Each rewrite keeps the entry's meaning, and so must keep its answer,
// the refusal's line and names included: a const is declared on the line it names, and a helper
// follows the kernel, so no line moves. The check is shown to fail first on a rewrite that does
// change the meaning (AGENTS.md#gate-discipline).
//
// Verifies: Rule 8.22 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { hostFace } from './host-face.js';
import { compileModule } from '../../core/oracle.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const module = (body: string): string => `"use typeshade";\n${body}\n`;

/** The proof's answer: the loops the call dispatches on the GPU, or the warnings that keep it on
 *  the CPU, from the compiler and from the editor, which must agree. */
function answerOf(body: string): string {
  const source = module(body);
  const compiled = compile(source, { fileName: 'm.shade.ts' }).diagnostics.map(
    (d) => `${d.category} ${d.code} ${d.message}`,
  );
  const service = createTypeshadeLanguageService();
  service.openDocument('m.shade.ts', source);
  const edited = service
    .getDiagnostics('m.shade.ts')
    .map((d) => `${d.severity} ${String(d.code)} ${d.message}`);
  expect(edited, 'the editor reads the program as the compiler does').toEqual(compiled);
  const face = hostFace(source, { fileName: '/app/m.shade.ts' });
  const kernels = (face.exports ?? []).flatMap((e) => (e.kind === 'kernel' ? [e.face] : []));
  expect(kernels.length, 'one kernel function').toBe(1);
  const gpu = kernels[0]!.gpu;
  if (gpu !== undefined && compiled.length === 0) return `GPU, ${String(gpu.loops.length)} loop`;
  return `CPU: ${compiled.join(' | ')}`;
}

/** Replaces each `from` with its `to`, and fails when one does not occur, so a rewrite with a
 *  typo cannot quietly test the entry against itself. */
function edit(body: string, ...pairs: readonly (readonly [string, string])[]): string {
  let out = body;
  for (const [from, to] of pairs) {
    if (!out.includes(from)) throw new Error(`the rewrite's "${from}" is not in the entry`);
    out = out.replace(from, to);
  }
  return out;
}

const f = Math.fround;
const zeros = (n: number): number[] => new Array<number>(n).fill(0);

interface Entry {
  readonly name: string;
  readonly body: string;
  readonly fn: string;
  readonly answer: string;
  /** Fresh arguments for one call, and what the call leaves in them and returns, computed in
   *  plain JavaScript with each float operation rounded to f32. */
  readonly run: () => {
    readonly args: unknown[];
    readonly want: readonly unknown[];
    readonly result?: number;
  };
  /** Rewrites that keep the meaning: a bound read from a parameter or from another array of the
   *  same length, a subexpression named with `const`, two independent statements swapped, and the
   *  written value computed by a helper. */
  readonly rewrites: Readonly<Record<string, string>>;
}

const STENCIL = `export function blur(src: array<f32>, dst: array<f32>) {
  for (let i: u32 = 1; i < src.length - 1; i++) {
    dst[i] = (src[i - 1] + src[i] + src[i + 1]) / 3.;
  }
}`;

const GATHER = `export function gather(idx: array<u32>, src: array<f32>, dst: array<f32>) {
  for (let i: u32 = 0; i < dst.length; i++) {
    dst[i] = src[idx[i]];
  }
}`;

const HISTOGRAM = `export function histogram(bins: array<u32>, counts: array<u32>) {
  for (let i: u32 = 0; i < bins.length; i++) {
    counts[bins[i]] += 1;
  }
}`;

const SPLAT = `export function splat(cell: array<u32>, w: array<f32>, grid: array<i32>) {
  for (let i: u32 = 0; i < cell.length; i++) {
    grid[cell[i]] += i32(w[i] * 1024.);
  }
}`;

const TOTAL = `export function total(xs: array<f32>): f32 {
  let s = 0.;
  for (let i: u32 = 0; i < xs.length; i++) {
    s += xs[i];
  }
  return s;
}`;

const ADVECT = `export function advect(pos: array<vec3>, vel: array<vec3>, age: array<f32>, dt: f32) {
  for (let i: u32 = 0; i < pos.length; i++) {
    pos[i] = pos[i] + vel[i] * dt;
    age[i] = age[i] + dt;
  }
}`;

const STAGES = `export function stages(a: array<f32>, b: array<f32>) {
  for (let i: u32 = 0; i < a.length; i++) {
    a[i] = a[i] * 2.;
  }
  for (let i: u32 = 0; i < b.length; i++) {
    b[i] = a[i] + 1.;
  }
}`;

const GRID2D = `export function grid2d(w: u32, h: u32, out: array<f32>) {
  for (let y: u32 = 0; y < h; y++) {
    for (let x: u32 = 0; x < w; x++) {
      out[y * w + x] = f32(x + y);
    }
  }
}`;

const GRID3D = `export function grid3d(n: u32, out: array<f32>) {
  for (let i: u32 = 0; i < n * n * n; i++) {
    out[i] = f32(i % n + (i / n) % n + i / (n * n));
  }
}`;

const FILL = `export function fill(out: array<f32>) {
  for (let i: u32 = 0; i < out.length; i++) {
    out[i] = f32(out.length);
  }
}`;

const SMEAR = `export function smear(a: array<f32>) {
  for (let i: u32 = 1; i < a.length; i++) {
    a[i] = (a[i] + a[i - 1]) * 0.5;
  }
}`;

const DEPOSIT = `export function deposit(cell: array<u32>, mass: array<f32>, grid: array<f32>) {
  for (let i: u32 = 0; i < cell.length; i++) {
    grid[cell[i]] += mass[i];
  }
}`;

const COMPACT = `export function compact(xs: array<f32>, out: array<f32>): u32 {
  let k: u32 = 0;
  for (let i: u32 = 0; i < xs.length; i++) {
    if (xs[i] > 0.) {
      out[k] = xs[i];
      k++;
    }
  }
  return k;
}`;

const RELAX = `export function relax(p: array<f32>, q: array<f32>, steps: u32) {
  for (let k: u32 = 0; k < steps; k++) {
    for (let i: u32 = 0; i < q.length; i++) {
      q[i] = p[i] * f32(k);
    }
  }
}`;

const PREFIX = `export function prefix(a: array<f32>) {
  for (let i: u32 = 1; i < a.length; i++) {
    a[i] = a[i] + a[i - 1];
  }
}`;

const WHERE = (line: number, what: string, why: string, remedy: string): string =>
  `CPU: warning TS8070 This loop runs on the CPU because line ${String(line)} ${what}, ${why}. ${remedy}`;
const SHARED = (line: number, what: string, from: string): string =>
  WHERE(
    line,
    `writes "${what}"`,
    'an element two iterations can share',
    `Write at an index made from "${from}".`,
  );
const READS = (line: number, what: string): string =>
  WHERE(
    line,
    `reads "${what}"`,
    'which another iteration writes',
    'Read from an array the loop does not write.',
  );

const CORPUS: readonly Entry[] = [
  {
    name: 'a stencil: neighbours of an input, into an output',
    body: STENCIL,
    fn: 'blur',
    answer: 'GPU, 1 loop',
    run: () => {
      const src = [1, 2, 4, 8, 16];
      const dst = zeros(5);
      const want = zeros(5);
      for (let i = 1; i < 4; i++) want[i] = f(f(f(src[i - 1]! + src[i]!) + src[i + 1]!) / 3);
      return { args: [src, dst], want: [src, want] };
    },
    rewrites: {
      'the bound from a parameter': edit(
        STENCIL,
        ['(src: ', '(n: u32, src: '],
        ['i < src.length - 1', 'i < n - 1'],
      ),
      'the bound from the written array': edit(STENCIL, [
        'i < src.length - 1',
        'i < dst.length - 1',
      ]),
      'a subexpression named with const': edit(STENCIL, [
        'dst[i] = (src[i - 1] + src[i] + src[i + 1]) / 3.;',
        'const sum = src[i - 1] + src[i] + src[i + 1]; dst[i] = sum / 3.;',
      ]),
      'the value from a helper': `${edit(STENCIL, [
        '(src[i - 1] + src[i] + src[i + 1]) / 3.',
        'avg3(src[i - 1], src[i], src[i + 1])',
      ])}
function avg3(a: f32, b: f32, c: f32): f32 {
  return (a + b + c) / 3.;
}`,
    },
  },
  {
    name: 'a gather through an index array',
    body: GATHER,
    fn: 'gather',
    answer: 'GPU, 1 loop',
    run: () => {
      const idx = [3, 0, 2, 1];
      const src = [10, 20, 30, 40];
      return { args: [idx, src, zeros(4)], want: [idx, src, [40, 10, 30, 20]] };
    },
    rewrites: {
      'the bound from a parameter': edit(
        GATHER,
        ['(idx: ', '(n: u32, idx: '],
        ['i < dst.length', 'i < n'],
      ),
      'the bound from another array of the same length': edit(GATHER, [
        'i < dst.length',
        'i < idx.length',
      ]),
      'a subexpression named with const': edit(GATHER, [
        'dst[i] = src[idx[i]];',
        'const j = idx[i]; dst[i] = src[j];',
      ]),
      'the value from a helper': `${edit(GATHER, ['dst[i] = src[idx[i]];', 'dst[i] = same(src[idx[i]]);'])}
function same(x: f32): f32 {
  return x;
}`,
    },
  },
  {
    name: 'an integer scatter, bins[k] += 1',
    body: HISTOGRAM,
    fn: 'histogram',
    answer: 'GPU, 1 loop',
    run: () => {
      const bins = [0, 1, 1, 3, 0, 1];
      return { args: [bins, zeros(4)], want: [bins, [2, 3, 0, 1]] };
    },
    rewrites: {
      'the bound from a parameter': edit(
        HISTOGRAM,
        ['(bins: ', '(n: u32, bins: '],
        ['i < bins.length', 'i < n'],
      ),
      'a subexpression named with const': edit(HISTOGRAM, [
        'counts[bins[i]] += 1;',
        'const b = bins[i]; counts[b] += 1;',
      ]),
    },
  },
  {
    name: 'a fixed-point scatter into an i32 grid',
    body: SPLAT,
    fn: 'splat',
    answer: 'GPU, 1 loop',
    run: () => {
      const cell = [0, 2, 0, 1];
      const w = [0.5, 0.25, 1.5, 2];
      return { args: [cell, w, zeros(3)], want: [cell, w, [2048, 2048, 256]] };
    },
    rewrites: {
      'the bound from a parameter': edit(
        SPLAT,
        ['(cell: ', '(n: u32, cell: '],
        ['i < cell.length', 'i < n'],
      ),
      'the bound from another array of the same length': edit(SPLAT, [
        'i < cell.length',
        'i < w.length',
      ]),
      'a subexpression named with const': edit(SPLAT, [
        'grid[cell[i]] += i32(w[i] * 1024.);',
        'const q = i32(w[i] * 1024.); grid[cell[i]] += q;',
      ]),
      'the value from a helper': `${edit(SPLAT, ['i32(w[i] * 1024.)', 'fixed(w[i])'])}
function fixed(x: f32): i32 {
  return i32(x * 1024.);
}`,
    },
  },
  {
    name: 'a sum reduction',
    body: TOTAL,
    fn: 'total',
    answer: 'GPU, 1 loop',
    run: () => {
      const xs = [1, 2, 3, 4, 5];
      return { args: [xs], want: [xs], result: 15 };
    },
    rewrites: {
      'the bound from a parameter': edit(
        TOTAL,
        ['(xs: ', '(n: u32, xs: '],
        ['i < xs.length', 'i < n'],
      ),
      'a subexpression named with const': edit(TOTAL, ['s += xs[i];', 'const x = xs[i]; s += x;']),
      'the value from a helper': `${edit(TOTAL, ['s += xs[i];', 's += same(xs[i]);'])}
function same(x: f32): f32 {
  return x;
}`,
    },
  },
  {
    name: 'a structure of arrays with vec3 attributes',
    body: ADVECT,
    fn: 'advect',
    answer: 'GPU, 1 loop',
    run: () => {
      const pos = [
        [0, 0, 0],
        [1, 1, 1],
      ];
      const vel = [
        [1, 2, 3],
        [-1, 0.5, 2],
      ];
      const age = [0, 1];
      const want = [
        [0.5, 1, 1.5],
        [0.5, 1.25, 2],
      ];
      return { args: [pos, vel, age, 0.5], want: [want, vel, [0.5, 1.5], 0.5] };
    },
    rewrites: {
      'the bound from a parameter': edit(
        ADVECT,
        ['(pos: ', '(n: u32, pos: '],
        ['i < pos.length', 'i < n'],
      ),
      'the bound from another array of the same length': edit(ADVECT, [
        'i < pos.length',
        'i < age.length',
      ]),
      'a subexpression named with const': edit(ADVECT, [
        'pos[i] = pos[i] + vel[i] * dt;',
        'const step = vel[i] * dt; pos[i] = pos[i] + step;',
      ]),
      'two independent statements in the other order': edit(ADVECT, [
        '    pos[i] = pos[i] + vel[i] * dt;\n    age[i] = age[i] + dt;',
        '    age[i] = age[i] + dt;\n    pos[i] = pos[i] + vel[i] * dt;',
      ]),
      'the value from a helper': `${edit(ADVECT, ['pos[i] + vel[i] * dt', 'moved(pos[i], vel[i], dt)'])}
function moved(p: vec3, v: vec3, dt: f32): vec3 {
  return p + v * dt;
}`,
    },
  },
  {
    name: 'two stages in one call',
    body: STAGES,
    fn: 'stages',
    answer: 'GPU, 2 loop',
    run: () => ({
      args: [[1, 2, 3], zeros(3)],
      want: [
        [2, 4, 6],
        [3, 5, 7],
      ],
    }),
    rewrites: {
      'the bound from a parameter': edit(
        STAGES,
        ['(a: ', '(n: u32, a: '],
        ['i < a.length', 'i < n'],
        ['i < b.length', 'i < n'],
      ),
      'the bound from another array of the same length': edit(STAGES, [
        'i < a.length',
        'i < b.length',
      ]),
      'a subexpression named with const': edit(STAGES, [
        'b[i] = a[i] + 1.;',
        'const x = a[i]; b[i] = x + 1.;',
      ]),
    },
  },
  {
    name: 'nested loops over a 2D grid: one invocation per row (below)',
    body: GRID2D,
    fn: 'grid2d',
    answer: 'GPU, 1 loop',
    run: () => ({ args: [3, 2, zeros(6)], want: [3, 2, [0, 1, 2, 1, 2, 3]] }),
    rewrites: {
      'a subexpression named with const': edit(GRID2D, [
        'out[y * w + x] = f32(x + y);',
        'const at = y * w + x; out[at] = f32(x + y);',
      ]),
      'the row named with const in the outer loop': edit(
        GRID2D,
        [
          'for (let y: u32 = 0; y < h; y++) {',
          'for (let y: u32 = 0; y < h; y++) { const row = y * w;',
        ],
        ['out[y * w + x]', 'out[row + x]'],
      ),
    },
  },
  {
    name: 'a 3D grid as one flat loop',
    body: GRID3D,
    fn: 'grid3d',
    answer: 'GPU, 1 loop',
    run: () => ({ args: [2, zeros(8)], want: [2, [0, 1, 1, 2, 1, 2, 2, 3]] }),
    rewrites: {
      'a subexpression named with const': edit(GRID3D, [
        'out[i] = f32(i % n + (i / n) % n + i / (n * n));',
        'const z = i / (n * n); out[i] = f32(i % n + (i / n) % n + z);',
      ]),
    },
  },
  {
    name: 'a body that reads the length of the array it writes (#345)',
    body: FILL,
    fn: 'fill',
    answer: 'GPU, 1 loop',
    run: () => ({ args: [zeros(3)], want: [[3, 3, 3]] }),
    rewrites: {
      'the bound from a parameter': edit(
        FILL,
        ['(out: ', '(n: u32, out: '],
        ['i < out.length', 'i < n'],
      ),
      'a subexpression named with const': edit(FILL, [
        'out[i] = f32(out.length);',
        'const n = out.length; out[i] = f32(n);',
      ]),
    },
  },
  {
    name: 'a read of a neighbour of the array being written',
    body: SMEAR,
    fn: 'smear',
    answer: READS(4, 'a[i - 1]'),
    run: () => ({ args: [[1, 3, 5, 7]], want: [[1, 2, 3.5, 5.25]] }),
    rewrites: {
      'the bound from a parameter': edit(
        SMEAR,
        ['(a: ', '(n: u32, a: '],
        ['i < a.length', 'i < n'],
      ),
      'a subexpression named with const': edit(SMEAR, [
        'a[i] = (a[i] + a[i - 1]) * 0.5;',
        'const m = a[i] + a[i - 1]; a[i] = m * 0.5;',
      ]),
      'the value from a helper': `${edit(SMEAR, ['(a[i] + a[i - 1]) * 0.5', 'mid(a[i], a[i - 1])'])}
function mid(x: f32, y: f32): f32 {
  return (x + y) * 0.5;
}`,
    },
  },
  {
    name: 'a float scatter, particle to grid',
    body: DEPOSIT,
    fn: 'deposit',
    answer: SHARED(4, 'grid[cell[i]]', 'i'),
    run: () => {
      const cell = [0, 2, 0, 1];
      const mass = [0.5, 0.25, 1.5, 2];
      return { args: [cell, mass, zeros(3)], want: [cell, mass, [2, 2, 0.25]] };
    },
    rewrites: {
      'the bound from a parameter': edit(
        DEPOSIT,
        ['(cell: ', '(n: u32, cell: '],
        ['i < cell.length', 'i < n'],
      ),
      'the bound from another array of the same length': edit(DEPOSIT, [
        'i < cell.length',
        'i < mass.length',
      ]),
      'a subexpression named with const': edit(DEPOSIT, [
        'grid[cell[i]] += mass[i];',
        'const m = mass[i]; grid[cell[i]] += m;',
      ]),
    },
  },
  {
    name: 'an append through a counter',
    body: COMPACT,
    fn: 'compact',
    answer: SHARED(6, 'out[k]', 'i'),
    run: () => {
      const xs = [1, -2, 3, 0, 5];
      return { args: [xs, zeros(5)], want: [xs, [1, 3, 5, 0, 0]], result: 3 };
    },
    rewrites: {
      'the bound from a parameter': edit(
        COMPACT,
        ['(xs: ', '(n: u32, xs: '],
        ['i < xs.length', 'i < n'],
      ),
      'the bound from another array of the same length': edit(COMPACT, [
        'i < xs.length',
        'i < out.length',
      ]),
      'a subexpression named with const': edit(COMPACT, [
        'out[k] = xs[i];',
        'const x = xs[i]; out[k] = x;',
      ]),
    },
  },
  {
    name: 'an outer iteration loop around a parallel loop',
    body: RELAX,
    fn: 'relax',
    answer: SHARED(5, 'q[i]', 'k'),
    run: () => {
      const p = [1, 2];
      return { args: [p, zeros(2), 3], want: [p, [2, 4], 3] };
    },
    rewrites: {
      'the bound from a parameter': edit(
        RELAX,
        ['(p: ', '(n: u32, p: '],
        ['i < q.length', 'i < n'],
      ),
      'the bound from another array of the same length': edit(RELAX, [
        'i < q.length',
        'i < p.length',
      ]),
      'a subexpression named with const': edit(RELAX, [
        'q[i] = p[i] * f32(k);',
        'const s = f32(k); q[i] = p[i] * s;',
      ]),
    },
  },
  {
    name: 'a prefix sum',
    body: PREFIX,
    fn: 'prefix',
    answer: READS(4, 'a[i - 1]'),
    run: () => ({ args: [[1, 2, 3, 4]], want: [[1, 3, 6, 10]] }),
    rewrites: {
      'the bound from a parameter': edit(
        PREFIX,
        ['(a: ', '(n: u32, a: '],
        ['i < a.length', 'i < n'],
      ),
      'a subexpression named with const': edit(PREFIX, [
        'a[i] = a[i] + a[i - 1];',
        'const before = a[i - 1]; a[i] = a[i] + before;',
      ]),
      'the value from a helper': `${edit(PREFIX, ['a[i] + a[i - 1]', 'add(a[i], a[i - 1])'])}
function add(x: f32, y: f32): f32 {
  return x + y;
}`,
    },
  },
];

describe('the kernel proof gives each loop of the corpus its answer (#350)', () => {
  it.each(CORPUS.map((e) => [e.name, e] as const))('%s', (_name, entry) => {
    expect(answerOf(entry.body)).toBe(entry.answer);
    // The CPU tier computes what the loop means, on the GPU or not.
    const r = compile(module(entry.body), { fileName: 'm.shade.ts' });
    const cpu = compileModule(r.module, { precision: 'f32' });
    const { args, want, result } = entry.run();
    const got = cpu.fns[entry.fn]!(...(args as never[]));
    expect(args).toEqual(want);
    if (result !== undefined) expect(got).toBe(result);
  });
});

describe('a rewrite that keeps the meaning keeps the answer (#350)', () => {
  const cases = CORPUS.flatMap((e) =>
    Object.entries(e.rewrites).map(
      ([what, body]) => [`${e.name}: ${what}`, body, e.answer] as const,
    ),
  );
  it.each(cases)('%s', (_name, body, answer) => {
    expect(answerOf(body)).toBe(answer);
  });

  it('is a check that can fail: a rewrite that changes the meaning changes the answer', () => {
    // Reading `dst[i + 1]` of the array the loop writes makes one iteration read what another
    // writes. Were the answer computed from something the rewrite does not reach, this would
    // still read "GPU, 1 loop", and every metamorphic case above would pass for nothing.
    const changed = edit(GATHER, ['dst[i] = src[idx[i]];', 'dst[i] = src[idx[i]] + dst[i + 1];']);
    expect(answerOf(GATHER)).toBe('GPU, 1 loop');
    expect(answerOf(changed)).toBe(READS(4, 'dst[i + 1]'));
  });
});

describe('nested loops run the inner loop inside each invocation (#350)', () => {
  const loopEntry = (body: string): string => {
    const face = hostFace(module(body), { fileName: '/app/m.shade.ts' });
    const kernel = face.exports?.find((e) => e.kind === 'kernel');
    const gpu = kernel?.kind === 'kernel' ? kernel.face.gpu : undefined;
    const entry = gpu?.loops[0]?.entry ?? '';
    const wgsl = gpu?.wgsl ?? '';
    return wgsl.slice(wgsl.indexOf(`fn ${entry}(`));
  };

  it('dispatches the outer loop of a 2D grid, one invocation per row', () => {
    // R3 takes `out[y * w + x]` over a nested loop of `x`: the dispatch is the outer loop's, and
    // each invocation runs its whole row. Correct, and 1,024 invocations for a 1,024 by 1,024 grid.
    expect(loopEntry(GRID2D)).toMatch(/for \(var x: u32/);
  });

  it('dispatches every cell of a grid written as one flat loop', () => {
    const flat = `export function grid(w: u32, h: u32, out: array<f32>) {
  for (let i: u32 = 0; i < w * h; i++) {
    const x = i % w;
    const y = i / w;
    out[i] = f32(x + y);
  }
}`;
    expect(answerOf(flat)).toBe('GPU, 1 loop');
    expect(loopEntry(flat)).not.toMatch(/for \(/);
  });
});
