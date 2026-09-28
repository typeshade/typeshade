// compile() emitted constant expressions Tint refuses (#368). Each program below compiled with
// no diagnostic, and Tint refused the WGSL it was given for it: a divisor or a shift amount the
// optimizer made a constant, `clamp` bounds it made constants that cross, and an operation over
// the author's constants whose value WGSL's constant evaluation will not produce. The tests read
// the compiler's half only through the optimizer's own folds and the front end's refusals, and
// no test handed a folded divisor to Tint; the editor's half accepted each program, as it should.
//
// Both halves on each source: compile()'s diagnostics and its WGSL at the default level and at
// O0 and O1; the language service's diagnostics; and the value the CPU oracle computes, which the
// WGSL now spells. Tint's text for each refused spelling is at the head of
// `src/core/passes/const-expr.ts`. The last test is #370, found while measuring these: the
// optimizer folded an integer vector to a zero no target can spell, and compile() failed.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { emitModuleAt } from '../../core/backends/wgsl.js';
import { compileModule } from '../../core/oracle.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

const I32_MIN = -2147483648;

interface Case {
  readonly name: string;
  readonly type: 'u32' | 'i32';
  /** Module constants, and statements before the `return`. */
  readonly consts?: string;
  readonly stmts?: string;
  readonly ret: string;
  /** The `return` line compile() writes. */
  readonly wgsl: string;
  /** Spellings Tint refused, which no level may write. */
  readonly refused: readonly string[];
  /** `f(x)` as the oracle computes it. */
  readonly value: (x: number) => number;
}

const CASES: readonly Case[] = [
  {
    name: 'a divisor the optimizer folds to zero: x - x',
    type: 'u32',
    ret: '7 / (x - x)',
    wgsl: 'return 7u;',
    refused: ['/ 0u'],
    value: () => 7,
  },
  {
    name: 'a remainder by x ^ x',
    type: 'u32',
    ret: '7 % (x ^ x)',
    wgsl: 'return 0u;',
    refused: ['% 0u'],
    value: () => 0,
  },
  {
    name: 'a divisor x * 0',
    type: 'i32',
    ret: 'x / (x * 0)',
    wgsl: 'return x;',
    refused: ['/ 0)'],
    value: (x) => x,
  },
  {
    name: 'a module constant shifted into its sign bit',
    type: 'i32',
    consts: 'const S: i32 = 3;',
    ret: 'x + (S << 31)',
    wgsl: 'return (x + -2147483648);',
    refused: ['S << 31u'],
    value: (x) => (x + I32_MIN) | 0,
  },
  {
    name: 'a shift amount the optimizer folds past 31',
    type: 'u32',
    ret: 'x << ((x - x) + 33)',
    wgsl: 'return (x << 1u);',
    refused: ['<< 33u'],
    value: (x) => (x << 1) >>> 0,
  },
  {
    name: 'clamp bounds the optimizer folds to constants that cross',
    type: 'u32',
    ret: 'clamp(x, (x - x) + 5, (x - x) + 2)',
    wgsl: 'return min(max(x, 5u), 2u);',
    refused: ['clamp(x, 5u, 2u)'],
    value: () => 2,
  },
  {
    name: 'a select on a literal between constants, as a divisor',
    type: 'u32',
    ret: 'x / (true ? u32(0) : u32(1))',
    wgsl: 'return x;',
    refused: ['select(1u, 0u, true)'],
    value: (x) => x,
  },
  {
    name: 'a sum of i32 literals past the type',
    type: 'i32',
    ret: 'x + (i32(2147483647) + i32(1))',
    wgsl: 'return (x + -2147483648);',
    refused: ['2147483647 + 1'],
    value: (x) => (x + I32_MIN) | 0,
  },
  {
    name: "a float constant's conversion to u32, moved into a divisor by const-prop",
    type: 'u32',
    stmts: 'const k: f32 = -0.25;',
    ret: 'x / u32(k)',
    wgsl: 'return x;',
    refused: ['u32(-0.25)'],
    value: (x) => x,
  },
  {
    name: "a module float constant's conversion to u32, as a divisor",
    type: 'u32',
    consts: 'const K: f32 = 0.5;',
    ret: 'x % u32(K)',
    wgsl: 'return 0u;',
    refused: ['% u32(K)'],
    value: () => 0,
  },
  {
    name: 'a negative i32 constant converted to u32',
    type: 'u32',
    stmts: 'const n: i32 = -1;',
    ret: 'x + u32(n)',
    wgsl: 'return (x + 4294967295u);',
    refused: ['u32(-1)'],
    value: (x) => (x + 4294967295) >>> 0,
  },
];

const sourceOf = (c: Case): string => `"use typeshade";
${c.consts ?? ''}
export function f(x: ${c.type}): ${c.type} {
  ${c.stmts ?? ''}
  return ${c.ret};
}
`;

const returnLine = (wgsl: string): string =>
  wgsl
    .split('\n')
    .find((l) => l.includes('return'))!
    .trim();

const INPUTS = { u32: [0, 1, 7, 4294967295], i32: [0, 1, -7, I32_MIN, 2147483647] };

describe('compile() emits no constant expression Tint refuses (#368)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const source = sourceOf(c);
      const r = compile(source, { fileName: 'm.shade.ts' });
      expect(r.diagnostics).toEqual([]);
      expect(returnLine(r.wgsl!)).toBe(c.wgsl);
      for (const level of ['O0', 'O1', 'O2'] as const) {
        const wgsl = emitModuleAt(r.module, level);
        for (const spelling of c.refused) expect(wgsl, level).not.toContain(spelling);
      }
      const f = compileModule(r.module).fns.f!;
      for (const x of INPUTS[c.type]) expect(f(x as never), `f(${x})`).toBe(c.value(x));

      const service = createTypeshadeLanguageService();
      service.openDocument('m.shade.ts', source);
      expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
    });
  }

  it('the neighbours Tint accepts keep their spelling', () => {
    // A concrete i32 constant's sum and product wrap, and so do its negation and its
    // conversion; -1 << 31 and 1u << 31 lose no bit.
    const kept = [
      ['i32', 'const S: i32 = 2147483647;', 'x + (S + 1)', 'return (x + (S + 1));'],
      ['i32', 'const S: i32 = 3;', 'x + S * 1000000000', 'return (x + (S * 1000000000));'],
      ['i32', 'const S: i32 = -1;', 'x + (S << 31)', 'return (x + (S << 31u));'],
      ['u32', 'const S: u32 = 1;', 'x + (S << 31)', 'return (x + (S << 31u));'],
      ['u32', 'const N: i32 = -1;', 'x + u32(N)', 'return (x + u32(N));'],
    ] as const;
    for (const [type, consts, ret, line] of kept) {
      const r = compile(
        sourceOf({ name: '', type, consts, ret, wgsl: '', refused: [], value: () => 0 }),
        {
          fileName: 'm.shade.ts',
        },
      );
      expect(r.diagnostics).toEqual([]);
      for (const level of ['O0', 'O1', 'O2'] as const)
        expect(returnLine(emitModuleAt(r.module, level)), `${ret} at ${level}`).toBe(line);
    }
  });

  it('a fragment entry: both targets get the run-time answer', () => {
    // ANGLE compiled the GLSL this wrote before with `WARNING: '/' : Divide by zero error
    // during constant folding` and a value of its choosing (measured, Chromium on SwiftShader).
    const source = `"use typeshade";
class P { k: u32; s: i32; }
declare const p: uniform<P>;
const S: i32 = 3;
@fragment
export function fs(): vec4 {
  const k = p.k;
  const a = 7 / (k - k);
  const b = p.s + (S << 31);
  return vec4(f32(a), f32(b), f32(clamp(k, (k - k) + 5, (k - k) + 2)), 1.);
}
`;
    const r = compile(source, { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    for (const text of [r.wgsl!, r.glsl!.fragment]) {
      expect(text).toContain(' a = 7u;');
      expect(text).toContain(' b = (p.s + -2147483648);');
      expect(text).toContain('min(max(k, 5u), 2u)');
    }
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
  });
});

describe('an integer vector the optimizer folds to zero (#370)', () => {
  it('is a constructor of zeros both targets spell, and the editor accepts the program', () => {
    const source = `"use typeshade";
declare const data: storage<array<u32>, "read_write">;
@compute([1, 1, 1])
export function main(): void {
  const v = vec2u(data[0], data[2]);
  data[1] = (v - v).x + (v ^ v).y + (v * 0).x;
}
`;
    const r = compile(source, { fileName: 'm.shade.ts' });
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('vec2<u32>(0u, 0u)');
    const service = createTypeshadeLanguageService();
    service.openDocument('m.shade.ts', source);
    expect(service.getDiagnostics('m.shade.ts')).toEqual([]);
  });
});
