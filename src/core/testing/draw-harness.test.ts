// The draw harness of the GPU differential's GLSL arm (#349): its entry adds nothing to what a
// generated function computes, and its taint marks the inputs GLSL ES 3.00 leaves undefined and
// changes no value.
//
// `scripts/gpu-differential.ts` draws each function of the exact corpus through `drawnFunction`
// on WebGL2 and compares every pixel with the function on the f32 oracle. The comparison says
// something about the function only if the entry computes the bits of the function's result and
// nothing else, and only if the pixels it leaves out are exactly the runs that reach an input
// GLSL leaves undefined (#382). Both are facts about the CPU side, held here where there is no
// GPU.

import { describe, expect, it } from 'vitest';
import type { CpuValue } from '../cpu-runtime.js';
import { emitGlslModule } from '../backends/glsl.js';
import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt } from '../ir/index.js';
import { f32T, i32T, u32T } from '../ir/index.js';
import { compileModule } from '../oracle.js';
import { determinismReport } from '../passes/determinism.js';
import {
  DRAW_TABLE,
  drawnFunction,
  pixelValue,
  tableValue,
  tableWords,
  taintGlslUndefined,
  taintedName,
} from './draw-harness.js';
import { generateModule, mulberry32 } from './random-ir.js';

const W = 8;
const H = 4;
const SEEDS = 8;

/** A value of `t` from the pools the gate draws its arguments from. */
function argOf(t: ShaderType, rnd: () => number): CpuValue {
  const scalar = (s: string): number => {
    const pick = (xs: readonly number[]): number => xs[Math.floor(rnd() * xs.length)]!;
    if (s === 'i32') return pick([0, 1, -1, 2, -2147483648, 2147483647, 255, -7]);
    if (s === 'u32') return pick([0, 1, 2, 4294967295, 2147483648, 255]);
    return pick([0, -0, 1, -1, 0.5, 2, 1000, -1000, 12.375, -99.875]);
  };
  if (t.kind === 'vec') return Array.from({ length: t.n }, () => scalar(t.elem));
  return scalar(t.kind === 'scalar' ? t.scalar : 'f32');
}

/** A value's bits as text, so -0 and NaN compare as themselves. */
const bits = (v: CpuValue | undefined): string =>
  JSON.stringify(v, (_, x: unknown) =>
    Object.is(x, -0) ? '-0' : typeof x === 'number' && Number.isNaN(x) ? 'NaN' : x,
  );

describe('the draw harness (#349, the GLSL arm)', () => {
  it('draws each generated function: every pixel writes the bits of its own call', () => {
    let pixels = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = generateModule(seed, { exact: true });
      const f32 = compileModule(c.module, { precision: 'f32' });
      for (const f of c.module.funcs) {
        const d = drawnFunction(c.module, f.name, W, H);
        // The entry adds nothing the report lists, and the GLSL writer spells it.
        expect(determinismReport(d.module)).toEqual([]);
        expect(emitGlslModule(d.module, 'fragment')).toContain('out uvec4');
        const rnd = mulberry32(seed * 131 + f.name.length);
        const args = Array.from({ length: W * H }, () => f.params.map((p) => argOf(p.type, rnd)));
        const drawn = compileModule(d.module, { precision: 'f32' });
        drawn.setBinding(DRAW_TABLE, tableValue(tableWords(d, args)));
        for (let p = 0; p < W * H; p++) {
          const pos = [(p % W) + 0.5, Math.floor(p / W) + 0.5, 0, 1];
          const got = pixelValue(f.ret, drawn.fns[d.entry]!(pos) as number[]);
          expect(bits(got), `seed ${String(seed)} ${f.name} pixel ${String(p)}`).toBe(
            bits(f32.fns[f.name]!(...args[p]!)),
          );
          pixels += 1;
        }
      }
    }
    expect(pixels).toBe(SEEDS * 6 * W * H);
  });

  // One function per operation the taint routes, each over its own parameters.
  const p = (name: string, type: ShaderType): Expr => ({ op: 'param', type, name });
  const fn = (
    name: string,
    params: readonly [string, ShaderType][],
    ret: ShaderType,
    body: Stmt[],
  ): FuncDecl => ({
    name,
    params: params.map(([n, type]) => ({ name: n, type })),
    ret,
    attrs: [],
    body,
  });
  const bin = (bop: '/' | '%', t: ShaderType): Stmt[] => [
    { s: 'return', expr: { op: 'binop', type: t, bop, a: p('a', t), b: p('b', t) } },
  ];
  const to = (t: ShaderType): Stmt[] => [
    {
      s: 'return',
      expr: { op: 'call', type: t, fn: t === i32T ? 'i32' : 'u32', args: [p('x', f32T)] },
    },
  ];
  const OPS: ModuleDecl = {
    consts: [],
    structs: [],
    bindings: [],
    funcs: [
      fn(
        'divI',
        [
          ['a', i32T],
          ['b', i32T],
        ],
        i32T,
        bin('/', i32T),
      ),
      fn(
        'remI',
        [
          ['a', i32T],
          ['b', i32T],
        ],
        i32T,
        bin('%', i32T),
      ),
      fn(
        'divU',
        [
          ['a', u32T],
          ['b', u32T],
        ],
        u32T,
        bin('/', u32T),
      ),
      fn(
        'remU',
        [
          ['a', u32T],
          ['b', u32T],
        ],
        u32T,
        bin('%', u32T),
      ),
      fn('toI', [['x', f32T]], i32T, to(i32T)),
      fn('toU', [['x', f32T]], u32T, to(u32T)),
      // A compound assignment divides as the operator does.
      fn(
        'divAssign',
        [
          ['a', i32T],
          ['b', i32T],
        ],
        i32T,
        [
          { s: 'var', name: 'r', type: i32T, init: p('a', i32T) },
          {
            s: 'assignOp',
            target: { op: 'varref', type: i32T, name: 'r' },
            bop: '/',
            expr: p('b', i32T),
          },
          { s: 'return', expr: { op: 'varref', type: i32T, name: 'r' } },
        ],
      ),
    ],
  };

  // `[function, arguments, whether GLSL ES 3.00 leaves the run undefined]`.
  const ROWS: readonly (readonly [string, readonly number[], 0 | 1])[] = [
    ['divI', [7, 0], 1],
    ['divI', [-2147483648, -1], 1],
    ['divI', [7, 2], 0],
    ['divI', [-7, 2], 0],
    ['remI', [7, 0], 1],
    ['remI', [-7, 3], 1],
    ['remI', [7, -3], 1],
    ['remI', [7, 3], 0],
    ['divU', [7, 0], 1],
    ['divU', [7, 2], 0],
    ['remU', [7, 0], 1],
    ['remU', [4294967295, 3], 0],
    ['toI', [3e9], 1],
    ['toI', [2147483648], 1],
    ['toI', [NaN], 1],
    ['toI', [-2147483648], 0],
    ['toI', [-1.5], 0],
    ['toU', [-0.5], 1],
    ['toU', [4294967296], 1],
    ['toU', [-0], 0],
    ['toU', [3e9], 0],
    ['divAssign', [7, 0], 1],
    ['divAssign', [7, 2], 0],
  ];

  it('taints exactly the inputs GLSL ES 3.00 leaves undefined, and computes what it did', () => {
    const plain = compileModule(OPS, { precision: 'f32' });
    const tainted = compileModule(taintGlslUndefined(OPS), { precision: 'f32' });
    for (const [name, args, undef] of ROWS) {
      expect(tainted.fns[taintedName(name)]!(...args), `${name}(${args.join(', ')})`).toBe(undef);
      expect(bits(tainted.fns[name]!(...args))).toBe(bits(plain.fns[name]!(...args)));
    }
  });

  it('changes no value a generated function computes, and marks some runs and not others', () => {
    const marked = [0, 0];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const c = generateModule(seed, { exact: true });
      const plain = compileModule(c.module, { precision: 'f32' });
      const tainted = compileModule(taintGlslUndefined(c.module), { precision: 'f32' });
      const rnd = mulberry32(seed);
      for (const f of c.module.funcs)
        for (let k = 0; k < 16; k++) {
          const args = f.params.map((q) => argOf(q.type, rnd));
          expect(bits(tainted.fns[f.name]!(...args))).toBe(bits(plain.fns[f.name]!(...args)));
          marked[tainted.fns[taintedName(f.name)]!(...args) as 0 | 1] += 1;
        }
    }
    expect(marked[0]).toBeGreaterThan(0);
    expect(marked[1]).toBeGreaterThan(0);
  });
});
