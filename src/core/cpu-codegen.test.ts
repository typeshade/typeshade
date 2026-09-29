// ═══ compileModuleJs — differential + microbench gate (X-GIS #1162) ═══
//
// GATE A1 (keystone): the js-source backend is BIT-IDENTICAL to the tree-walk
// interpreter over the SAME IR. Every fn below is swept over seeded-random +
// boundary inputs and asserted Object.is-equal (per element) between
// compileModuleJs(m).fns.f and compileModule(m).fns.f. Same op tree ⇒ bit-equal;
// any epsilon means the codegen diverged. Constructs the PROJECTION_MODULE does
// NOT use (for / switch / matchExpr / struct / array-index / assignOp / discard /
// break / continue / overrides / bit-ops) are hand-built here so the codegen's
// every branch is gated; the map package gates the real projection graph.
//
// GATE A2: a microbench (logged, not asserted) — N=100k calls of a representative
// vector fn, interpreter vs codegen.

import { describe, it, expect } from 'vitest';
import type { Expr, Stmt, ModuleDecl, ShaderType, BinOp, CmpOp } from './ir/index.js';
import {
  f32T,
  f64T,
  i32T,
  u32T,
  boolT,
  vec2fT,
  vec3fT,
  vec4fT,
  vec2uT,
  vec3uT,
  vec3iT,
  vec3bT,
  vec3f64T,
  structT,
  arrayT,
  matT,
  voidT,
} from './ir/index.js';
import { compileModule, type CpuPrecision } from './oracle.js';
import { compileModuleJs, generateModuleJs } from './cpu-codegen.js';
import { COMPONENTWISE, type CpuValue } from './cpu-runtime.js';

// ── Hand-built IR constructors (explicit Stmt/Expr shapes) ──
const lit = (v: number | boolean, type: ShaderType = f32T): Expr => ({ op: 'lit', type, value: v });
const param = (name: string, type: ShaderType = f32T): Expr => ({ op: 'param', type, name });
const vref = (name: string, type: ShaderType = f32T): Expr => ({ op: 'varref', type, name });
const cref = (name: string, type: ShaderType = f32T): Expr => ({ op: 'constref', type, name });
const oref = (name: string, type: ShaderType = f32T): Expr => ({ op: 'overrideref', type, name });
const bin = (bop: BinOp, a: Expr, b: Expr, type: ShaderType = f32T): Expr => ({
  op: 'binop',
  type,
  bop,
  a,
  b,
});
const neg = (a: Expr, type: ShaderType = f32T): Expr => ({ op: 'unop', type, a });
const cmp = (cop: CmpOp, a: Expr, b: Expr): Expr => ({ op: 'compare', type: boolT, cop, a, b });
const logical = (lop: '&&' | '||', a: Expr, b: Expr): Expr => ({
  op: 'logical',
  type: boolT,
  lop,
  a,
  b,
});
const call = (fn: string, args: Expr[], type: ShaderType = f32T): Expr => ({
  op: 'call',
  type,
  fn,
  args,
});
const member = (base: Expr, field: string, type: ShaderType = f32T): Expr => ({
  op: 'member',
  type,
  base,
  field,
});
const construct = (type: ShaderType, args: Expr[]): Expr => ({ op: 'construct', type, args });
const sel = (cond: Expr, ifTrue: Expr, ifFalse: Expr, type: ShaderType = f32T): Expr => ({
  op: 'select',
  type,
  cond,
  ifTrue,
  ifFalse,
});
const index = (base: Expr, idx: Expr, type: ShaderType = f32T): Expr => ({
  op: 'index',
  type,
  base,
  idx,
});
const matchE = (
  scrutinee: Expr,
  cases: ReadonlyArray<readonly [number, Expr]>,
  dflt: Expr,
  type: ShaderType = f32T,
): Expr => ({ op: 'matchExpr', type, scrutinee, cases, default: dflt });

const ret = (expr?: Expr): Stmt => ({ s: 'return', expr });
const letS = (name: string, expr: Expr): Stmt => ({ s: 'let', name, expr });
const varS = (name: string, type: ShaderType, init?: Expr): Stmt => ({
  s: 'var',
  name,
  type,
  init,
});
const assign = (target: Expr, expr: Expr): Stmt => ({ s: 'assign', target, expr });
const assignOp = (target: Expr, bop: BinOp, expr: Expr): Stmt => ({
  s: 'assignOp',
  target,
  bop,
  expr,
});
const ifS = (arms: ReadonlyArray<{ cond: Expr; body: Stmt[] }>, elseBody?: Stmt[]): Stmt => ({
  s: 'if',
  arms,
  elseBody,
});
const forS = (init: Stmt, cond: Expr, update: Stmt, body: Stmt[]): Stmt => ({
  s: 'for',
  init,
  cond,
  update,
  body,
});
const switchS = (
  scrut: Expr,
  cases: ReadonlyArray<{ values: number[]; body: Stmt[] }>,
  defaultBody?: Stmt[],
): Stmt => ({ s: 'switch', scrut, cases, defaultBody });

type P = { name: string; type: ShaderType; mode?: 'inout' };
const func = (name: string, params: P[], retType: ShaderType, body: Stmt[]) => ({
  name,
  params,
  ret: retType,
  body,
});

// ── The module under test ──
const P_STRUCT = {
  name: 'P',
  fields: [
    { name: 'a', type: f32T },
    { name: 'b', type: f32T },
  ],
};

function buildModule(): ModuleDecl {
  return {
    consts: [
      { name: 'K', type: f32T, wgslValue: 3.14159265, cpuValue: Math.PI },
      { name: 'HALF', type: f32T, wgslValue: 0.5, cpuValue: 0.5 },
      // valueExpr const (vec2) computed through the same op tree.
      {
        name: 'VC',
        type: vec2fT,
        wgslValue: 0,
        cpuValue: 0,
        valueExpr: construct(vec2fT, [lit(1.25), bin('*', cref('HALF'), lit(4))]),
      },
    ],
    structs: [P_STRUCT],
    bindings: [],
    overrides: [{ name: 'OV', type: f32T, default: 7.5 }],
    funcs: [
      // scalar arithmetic: + - * / % + nested calls (floor/sqrt/sin/cos/atan2/abs/sign/min/max)
      func(
        'arith',
        [
          { name: 'a', type: f32T },
          { name: 'b', type: f32T },
          { name: 'c', type: f32T },
        ],
        f32T,
        [
          letS('s', bin('+', bin('*', param('a'), param('b')), bin('-', param('c'), lit(2)))),
          letS('d', bin('/', vref('s'), bin('%', param('a'), lit(3)))),
          ret(
            call('atan2', [
              call('floor', [call('abs', [vref('d')])]),
              bin('+', call('sqrt', [call('abs', [param('a')])]), call('sign', [param('c')])),
            ]),
          ),
        ],
      ),
      // scalar sin/cos/min/max/clamp/mix/mod/radians/degrees
      func(
        'trig',
        [
          { name: 'x', type: f32T },
          { name: 'y', type: f32T },
        ],
        f32T,
        [
          ret(
            call('mix', [
              call('min', [
                call('sin', [call('radians', [param('x')])]),
                call('cos', [param('y')]),
              ]),
              call('max', [call('degrees', [param('x')]), call('mod', [param('y'), lit(2)])]),
              cref('HALF'),
            ]),
          ),
        ],
      ),
      // u32 bit-ops (& | ^ << >>logical)
      func(
        'bits',
        [
          { name: 'a', type: u32T },
          { name: 'b', type: u32T },
        ],
        u32T,
        [
          letS('x', bin('&', param('a', u32T), param('b', u32T), u32T)),
          letS(
            'y',
            bin('|', vref('x', u32T), bin('<<', param('b', u32T), lit(2, u32T), u32T), u32T),
          ),
          letS(
            'z',
            bin('^', vref('y', u32T), bin('>>', param('a', u32T), lit(1, u32T), u32T), u32T),
          ),
          ret(vref('z', u32T)),
        ],
      ),
      // i32 arithmetic shift (>> sign-preserving)
      func(
        'ishift',
        [
          { name: 'a', type: i32T },
          { name: 'b', type: i32T },
        ],
        i32T,
        [ret(bin('>>', param('a', i32T), param('b', i32T), i32T))],
      ),
      // vector component-wise + broadcast + clamp/mix/mod/min/max + normalize/cross
      func(
        'vecops',
        [
          { name: 'p', type: vec3fT },
          { name: 'q', type: vec3fT },
        ],
        vec3fT,
        [
          letS(
            'r',
            bin('+', param('p', vec3fT), bin('*', param('q', vec3fT), lit(2), vec3fT), vec3fT),
          ),
          letS(
            'c',
            call(
              'clamp',
              [vref('r', vec3fT), construct(vec3fT, [lit(-1)]), construct(vec3fT, [lit(1)])],
              vec3fT,
            ),
          ),
          letS(
            'm',
            call(
              'mix',
              [vref('c', vec3fT), call('mod', [param('p', vec3fT), lit(2)], vec3fT), cref('HALF')],
              vec3fT,
            ),
          ),
          ret(
            call(
              'normalize',
              [
                call(
                  'cross',
                  [
                    vref('m', vec3fT),
                    call('max', [param('q', vec3fT), construct(vec3fT, [lit(0.1)])], vec3fT),
                  ],
                  vec3fT,
                ),
              ],
              vec3fT,
            ),
          ),
        ],
      ),
      // scalar reductions: dot / length / distance
      func(
        'reduce',
        [
          { name: 'p', type: vec3fT },
          { name: 'q', type: vec3fT },
        ],
        f32T,
        [
          ret(
            bin(
              '+',
              call('dot', [param('p', vec3fT), param('q', vec3fT)]),
              bin(
                '*',
                call('length', [param('p', vec3fT)]),
                call('distance', [param('p', vec3fT), param('q', vec3fT)]),
              ),
            ),
          ),
        ],
      ),
      // member swizzle (single + multi) and vec construct/splat
      func('swz', [{ name: 'v', type: vec4fT }], vec4fT, [
        letS('xy', member(param('v', vec4fT), 'xy', vec2fT)),
        letS('zw', member(param('v', vec4fT), 'zw', vec2fT)),
        ret(
          construct(vec4fT, [
            member(vref('xy', vec2fT), 'x'),
            member(vref('zw', vec2fT), 'y'),
            member(param('v', vec4fT), 'w'),
            member(param('v', vec4fT), 'z'),
          ]),
        ),
      ]),
      // vecN(scalar) splat + unop (vec + scalar negate)
      func('splatneg', [{ name: 'a', type: f32T }], vec3fT, [
        letS('s', construct(vec3fT, [param('a')])),
        ret(
          bin(
            '+',
            neg(vref('s', vec3fT), vec3fT),
            construct(vec3fT, [neg(param('a')), param('a'), lit(0)]),
            vec3fT,
          ),
        ),
      ]),
      // compare (f32 fround ==) + select + logical short-circuit
      func(
        'cmp',
        [
          { name: 'a', type: f32T },
          { name: 'b', type: f32T },
        ],
        f32T,
        [
          letS('eq', sel(cmp('==', param('a'), param('b')), lit(1), lit(0))),
          letS(
            'ord',
            sel(
              logical('&&', cmp('>', param('a'), lit(0)), cmp('<', param('b'), lit(10))),
              lit(2),
              lit(3),
            ),
          ),
          letS(
            'or',
            sel(
              logical('||', cmp('<=', param('a'), lit(-5)), cmp('>=', param('b'), lit(5))),
              lit(4),
              lit(5),
            ),
          ),
          ret(bin('+', vref('eq'), bin('+', vref('ord'), vref('or')))),
        ],
      ),
      // if / elif / else chain
      func('ctrl', [{ name: 's', type: f32T }], f32T, [
        ifS(
          [
            { cond: cmp('<', param('s'), lit(0)), body: [ret(neg(param('s')))] },
            { cond: cmp('<', param('s'), lit(1)), body: [ret(bin('*', param('s'), lit(10)))] },
          ],
          [ret(bin('+', param('s'), lit(100)))],
        ),
      ]),
      // for-loop with var accumulator + assignOp (scalar)
      func('loopsum', [{ name: 'x', type: f32T }], f32T, [
        varS('acc', f32T, lit(0)),
        forS(
          varS('i', i32T, lit(0, i32T)),
          cmp('<', vref('i', i32T), lit(6, i32T)),
          assignOp(vref('i', i32T), '+', lit(1, i32T)),
          [assignOp(vref('acc'), '+', bin('*', param('x'), call('f32', [vref('i', i32T)])))],
        ),
        ret(vref('acc')),
      ]),
      // for-loop with break + continue
      func('loopbc', [{ name: 'n', type: f32T }], f32T, [
        varS('acc', f32T, lit(0)),
        forS(
          varS('i', i32T, lit(0, i32T)),
          cmp('<', vref('i', i32T), lit(10, i32T)),
          assignOp(vref('i', i32T), '+', lit(1, i32T)),
          [
            ifS([{ cond: cmp('==', vref('i', i32T), lit(1, i32T)), body: [{ s: 'continue' }] }]),
            ifS([{ cond: cmp('==', vref('i', i32T), lit(4, i32T)), body: [{ s: 'break' }] }]),
            assignOp(vref('acc'), '+', bin('+', param('n'), call('f32', [vref('i', i32T)]))),
          ],
        ),
        ret(vref('acc')),
      ]),
      // switch (i32 scrutinee) + default; a case with a mid-body break
      func('sw', [{ name: 's', type: i32T }], f32T, [
        varS('r', f32T, lit(-1)),
        switchS(
          param('s', i32T),
          [
            { values: [0], body: [assign(vref('r'), lit(10)), { s: 'break' }] },
            { values: [1], body: [assign(vref('r'), lit(20))] },
            { values: [2], body: [ret(lit(222))] },
          ],
          [assign(vref('r'), lit(99))],
        ),
        ret(vref('r')),
      ]),
      // switch INSIDE a for-loop (X-GIS #2275): a `continue` raised in a case body must reach
      // the loop (skips one increment → 3), and a `break` must exit the switch only (→ 4).
      func('swcont', [{ name: 'n', type: i32T }], f32T, [
        varS('acc', f32T, lit(0)),
        forS(
          varS('i', i32T, lit(0, i32T)),
          cmp('<', vref('i', i32T), param('n', i32T)),
          assignOp(vref('i', i32T), '+', lit(1, i32T)),
          [
            switchS(vref('i', i32T), [{ values: [1], body: [{ s: 'continue' }] }], []),
            assignOp(vref('acc'), '+', lit(1)),
          ],
        ),
        ret(vref('acc')),
      ]),
      func('swbrk', [{ name: 'n', type: i32T }], f32T, [
        varS('acc', f32T, lit(0)),
        forS(
          varS('i', i32T, lit(0, i32T)),
          cmp('<', vref('i', i32T), param('n', i32T)),
          assignOp(vref('i', i32T), '+', lit(1, i32T)),
          [
            switchS(vref('i', i32T), [{ values: [1], body: [{ s: 'break' }] }], []),
            assignOp(vref('acc'), '+', lit(1)),
          ],
        ),
        ret(vref('acc')),
      ]),
      // matchExpr
      func('matchfn', [{ name: 's', type: i32T }], f32T, [
        ret(
          matchE(
            param('s', i32T),
            [
              [0, lit(1.5)],
              [1, cref('K')],
              [2, bin('*', cref('HALF'), lit(8))],
            ],
            lit(-9),
          ),
        ),
      ]),
      // struct construct + member
      func(
        'structfn',
        [
          { name: 'a', type: f32T },
          { name: 'b', type: f32T },
        ],
        f32T,
        [
          letS('p', construct(structT('P'), [param('a'), bin('+', param('b'), lit(1))])),
          ret(bin('*', member(vref('p', structT('P')), 'a'), member(vref('p', structT('P')), 'b'))),
        ],
      ),
      // array construct + dynamic index
      func('arridx', [{ name: 'i', type: i32T }], f32T, [
        letS('arr', construct(arrayT(f32T, 4), [lit(10), lit(20), lit(30), lit(40)])),
        ret(index(vref('arr', arrayT(f32T, 4)), param('i', i32T))),
      ]),
      // assignOp on a VECTOR target (component-wise) + member-assign aliasing
      func('vecmut', [{ name: 'p', type: vec3fT }], vec3fT, [
        varS('v', vec3fT, param('p', vec3fT)),
        assignOp(vref('v', vec3fT), '+', construct(vec3fT, [lit(1), lit(2), lit(3)])),
        assign(member(vref('v', vec3fT), 'x'), bin('*', member(vref('v', vec3fT), 'x'), lit(2))),
        ret(vref('v', vec3fT)),
      ]),
      // consts (scalar + vec valueExpr) + override
      func('constsfn', [{ name: 'a', type: f32T }], vec2fT, [
        ret(
          bin(
            '+',
            cref('VC', vec2fT),
            construct(vec2fT, [bin('*', cref('K'), param('a')), oref('OV')]),
            vec2fT,
          ),
        ),
      ]),
      // discard (conditional) → undefined, else a value
      func('disc', [{ name: 's', type: f32T }], f32T, [
        ifS([{ cond: cmp('<', param('s'), lit(0)), body: [{ s: 'discard' }] }]),
        ret(bin('+', param('s'), lit(5))),
      ]),
    ],
  };
}

// ── seeded RNG + input generation ──
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCALAR_BOUNDARIES = [
  0,
  1,
  -1,
  0.5,
  -0.5,
  2,
  -2,
  3,
  90,
  -90,
  180,
  -180,
  85.051129,
  -85.051129,
  45,
  1e-7,
  -1e-7,
  1e7,
  100,
  0.25,
  Math.PI,
  -Math.PI,
];
const INT_BOUNDARIES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, -1, -2, 15, 31];

function scalarKind(t: ShaderType): 'f32' | 'i32' | 'u32' | 'other' {
  if (t.kind === 'scalar') return t.scalar === 'bool' ? 'other' : t.scalar;
  return 'other';
}

function genScalar(t: ShaderType, rng: () => number, useBoundary: boolean): number {
  const kind = scalarKind(t);
  if (kind === 'i32') {
    return useBoundary
      ? INT_BOUNDARIES[Math.floor(rng() * INT_BOUNDARIES.length)]!
      : Math.floor((rng() - 0.5) * 64);
  }
  if (kind === 'u32') {
    return useBoundary
      ? Math.abs(INT_BOUNDARIES[Math.floor(rng() * INT_BOUNDARIES.length)]!)
      : Math.floor(rng() * 256);
  }
  // f32 / f64
  if (useBoundary) return SCALAR_BOUNDARIES[Math.floor(rng() * SCALAR_BOUNDARIES.length)]!;
  return (rng() - 0.5) * 400;
}

function genArg(t: ShaderType, rng: () => number, useBoundary: boolean): number | number[] {
  if (t.kind === 'vec' || t.kind === 'vec64')
    return Array.from({ length: t.n }, () => genScalar(f32T, rng, useBoundary));
  return genScalar(t, rng, useBoundary);
}

function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => clone(x)) as unknown as T;
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object)) o[k] = clone((v as Record<string, unknown>)[k]);
    return o as T;
  }
  return v;
}

function bitEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!bitEqual(a[i], b[i])) return false;
    return true;
  }
  const ao = a && typeof a === 'object' && !Array.isArray(a);
  const bo = b && typeof b === 'object' && !Array.isArray(b);
  if (ao && bo) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    for (const k of ka)
      if (!bitEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
        return false;
    return true;
  }
  return Object.is(a, b);
}

describe('compileModuleJs — differential vs interpreter (GATE A1)', () => {
  const m = buildModule();
  const jsMod = compileModuleJs(m);
  const interpMod = compileModule(m);

  // Both precisions: the f32 one is what the Vite plugin's CPU tier runs, and the generated code
  // takes its own paths there (a rounding per operation, parameters rounded at entry, #410).
  it.each(['f64', 'f32'] as const)(
    'every fn is bit-identical over boundary + seeded-random sweeps (Object.is per element), %s',
    (precision) => {
      const PER_FN = 400;
      const js = precision === 'f64' ? jsMod : compileModuleJs(m, { precision });
      const interp = precision === 'f64' ? interpMod : compileModule(m, { precision });
      let fnCount = 0;
      let inputCount = 0;
      const divergences: string[] = [];

      for (const f of m.funcs) {
        fnCount++;
        const jsFn = js.fns[f.name]!;
        const interpFn = interp.fns[f.name]!;
        const rng = mulberry32(
          0x9e3779b9 ^ f.name.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7),
        );
        for (let k = 0; k < PER_FN; k++) {
          const useBoundary = k < PER_FN / 2;
          const args = f.params.map((p) => genArg(p.type, rng, useBoundary));
          const a = jsFn(...(clone(args) as never[]));
          const b = interpFn(...(clone(args) as never[]));
          inputCount++;
          if (!bitEqual(a, b)) {
            divergences.push(
              `${f.name}(${JSON.stringify(args)}): js=${JSON.stringify(a)} interp=${JSON.stringify(b)}`,
            );
            if (divergences.length > 10) break;
          }
        }
      }

      console.log(
        `[GATE A1 ${precision}] ${fnCount} fns × ${inputCount / fnCount} inputs = ${inputCount} exact-equality checks`,
      );
      expect(divergences).toEqual([]);
      expect(fnCount).toBe(m.funcs.length);
    },
  );

  it('the js backend runs the SAME preamble (validate + autoVars) and shares CpuModule shape', () => {
    // setBinding is a no-op here (no bindings) but must exist + not throw.
    expect(() => jsMod.setBinding('unused', 0)).not.toThrow();
    expect(Object.keys(jsMod.fns).sort()).toEqual(Object.keys(interpMod.fns).sort());
  });

  it('hybrid fallback: a fn with a raw/placeholder Stmt falls back to the interpreter, rest compile', () => {
    const hybrid: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        func('ok', [{ name: 'a', type: f32T }], f32T, [ret(bin('*', param('a'), lit(3)))]),
        // a raw WGSL Stmt has no CPU form → this fn must fall back (and throw at call,
        // exactly as the interpreter does), while `ok` still runs compiled.
        func('bad', [{ name: 'a', type: f32T }], f32T, [
          { s: 'raw', wgsl: 'return a;' },
          ret(param('a')),
        ]),
      ],
    };
    const jm = compileModuleJs(hybrid);
    const im = compileModule(hybrid);
    expect(jm.fns.ok!(4)).toBe(12);
    // `bad` fell back to the interpreter twin → its raw-Stmt throw matches.
    let jThrew = false;
    let iThrew = false;
    try {
      jm.fns.bad!(1);
    } catch {
      jThrew = true;
    }
    try {
      im.fns.bad!(1);
    } catch {
      iThrew = true;
    }
    expect(jThrew).toBe(true);
    expect(iThrew).toBe(true);
  });
});

describe('compileModuleJs — microbench (GATE A2, logged not asserted)', () => {
  it('N=100k calls: interpreter vs codegen (representative vector fn)', () => {
    const m = buildModule();
    const jsFn = compileModuleJs(m).fns.vecops!;
    const interpFn = compileModule(m).fns.vecops!;
    const N = 100_000;
    const p = [0.3, -0.7, 1.2];
    const q = [-0.4, 0.9, 0.1];

    // warm up (JIT both)
    for (let i = 0; i < 2000; i++) {
      jsFn([...p], [...q]);
      interpFn([...p], [...q]);
    }

    const t0 = performance.now();
    for (let i = 0; i < N; i++) interpFn([...p], [...q]);
    const tInterp = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < N; i++) jsFn([...p], [...q]);
    const tCodegen = performance.now() - t1;

    console.log(
      `[GATE A2] vecops ×${N}: interpreter ${tInterp.toFixed(1)}ms · codegen ${tCodegen.toFixed(1)}ms · speedup ${(tInterp / tCodegen).toFixed(2)}×`,
    );
    expect(tCodegen).toBeGreaterThan(0);
  });
});

// ═══ The type-directed paths (#410) ═══
//
// The generator writes a vector operation of a known width one component at a time, calls the
// per-component builtins through `COMPONENTWISE`, writes `dot`, `length`, `distance`,
// `normalize` and `cross` out term by term, rounds an f32 parameter once at entry, and keeps a
// value it has just built without copying it. Each is held to the interpreter here, in both
// precisions, over the values where the arithmetic has corners (NaN, ±0, ±Infinity, a
// subnormal, values past f32's range, integers at the wrap), with vector arguments sometimes
// passed as one shared array, and with calls that write an operand between the operands.

const v2 = vec2fT;
const v3 = vec3fT;
const v4 = vec4fT;
const vcmp = (cop: CmpOp, a: Expr, b: Expr, type: ShaderType): Expr => ({
  op: 'compare',
  type,
  cop,
  a,
  b,
});
/** Every builtin of `COMPONENTWISE` that takes one argument. */
const LANE_UNARY = Object.entries(COMPONENTWISE)
  .filter(([, c]) => c.lane.length === 1)
  .map(([name]) => name);
const PAIR = structT('Pair');

function buildLaneModule(): ModuleDecl {
  const p = (name: string, type: ShaderType = f32T): Expr => param(name, type);
  return {
    consts: [
      { name: 'K', type: f32T, wgslValue: 0.1, cpuValue: 0.1 },
      {
        name: 'KV',
        type: v3,
        wgslValue: 0,
        cpuValue: 0,
        valueExpr: construct(v3, [lit(0.1), lit(-0.5), bin('*', cref('K'), lit(3))]),
      },
    ],
    structs: [
      {
        name: 'Pair',
        fields: [
          { name: 'a', type: v3 },
          { name: 'b', type: v3 },
        ],
      },
    ],
    bindings: [],
    vars: [
      { name: 'w', space: 'private', type: v3, init: construct(v3, [lit(1), lit(2), lit(3)]) },
    ],
    funcs: [
      // A scalar broadcast on either side, a constant vector, a quotient by a scalar sum.
      func(
        'bcast',
        [
          { name: 'p', type: v3 },
          { name: 's', type: f32T },
        ],
        v3,
        [
          letS('a', bin('*', p('p', v3), p('s'), v3)),
          letS('b', bin('-', p('s'), p('p', v3), v3)),
          ret(
            bin(
              '+',
              bin('/', vref('a', v3), bin('+', p('s'), lit(1)), v3),
              bin('*', vref('b', v3), cref('KV', v3), v3),
              v3,
            ),
          ),
        ],
      ),
      // Swizzles: a component picked twice, a swizzle of an expression, one component of one,
      // and a constant index.
      func('swz2', [{ name: 'v', type: v4 }], v4, [
        letS('s', bin('+', member(p('v', v4), 'wzyx', v4), member(p('v', v4), 'xxyy', v4), v4)),
        letS('e', member(bin('*', vref('s', v4), lit(0.5), v4), 'zx', v2)),
        ret(
          construct(v4, [
            vref('e', v2),
            member(bin('-', vref('s', v4), p('v', v4), v4), 'y'),
            index(vref('s', v4), lit(3, i32T)),
          ]),
        ),
      ]),
      // Vector comparisons, a per-component select, and f32 `==` / `!=`, which round first.
      func(
        'cmpsel',
        [
          { name: 'a', type: v3 },
          { name: 'b', type: v3 },
        ],
        v3,
        [
          letS('lt', sel(vcmp('<', p('a', v3), p('b', v3), vec3bT), p('b', v3), p('a', v3), v3)),
          letS(
            'eq',
            sel(
              vcmp('==', p('a', v3), bin('*', p('b', v3), cref('K'), v3), vec3bT),
              construct(v3, [lit(1)]),
              construct(v3, [lit(0)]),
              v3,
            ),
          ),
          letS(
            'mixed',
            sel(
              construct(vec3bT, [
                cmp('>=', member(p('a', v3), 'x'), lit(0)),
                cmp('!=', member(p('b', v3), 'y'), cref('K')),
                lit(true, boolT),
              ]),
              vref('eq', v3),
              neg(vref('lt', v3), v3),
              v3,
            ),
          ),
          ret(
            bin(
              '+',
              vref('mixed', v3),
              sel(
                vcmp('!=', p('a', v3), p('b', v3), vec3bT),
                vref('eq', v3),
                neg(vref('eq', v3), v3),
                v3,
              ),
              v3,
            ),
          ),
        ],
      ),
      // Integer vectors: the wrap, WGSL's `/` and `%` (by zero too), a negation that wraps,
      // shifts, and per-component builtins whose result wraps.
      func(
        'ivec',
        [
          { name: 'a', type: vec3iT },
          { name: 'b', type: vec3iT },
        ],
        vec3iT,
        [
          letS('s', bin('+', p('a', vec3iT), p('b', vec3iT), vec3iT)),
          letS('m', bin('*', vref('s', vec3iT), p('b', vec3iT), vec3iT)),
          letS('d', bin('/', vref('m', vec3iT), p('a', vec3iT), vec3iT)),
          letS('r', bin('%', vref('d', vec3iT), p('b', vec3iT), vec3iT)),
          letS('n', neg(bin('-', vref('r', vec3iT), p('a', vec3iT), vec3iT), vec3iT)),
          letS('sh', bin('>>', vref('n', vec3iT), construct(vec3uT, [lit(3, u32T)]), vec3iT)),
          ret(
            call(
              'clamp',
              [
                bin('^', vref('sh', vec3iT), call('abs', [p('a', vec3iT)], vec3iT), vec3iT),
                construct(vec3iT, [lit(-100000, i32T)]),
                lit(100000, i32T),
              ],
              vec3iT,
            ),
          ),
        ],
      ),
      func(
        'uvec',
        [
          { name: 'a', type: vec2uT },
          { name: 'b', type: vec2uT },
        ],
        vec2uT,
        [
          letS('x', bin('-', p('a', vec2uT), p('b', vec2uT), vec2uT)),
          letS('y', bin('<<', vref('x', vec2uT), lit(31, u32T), vec2uT)),
          letS(
            'z',
            bin('%', bin('+', vref('y', vec2uT), p('a', vec2uT), vec2uT), p('b', vec2uT), vec2uT),
          ),
          ret(
            call(
              'max',
              [
                bin('|', vref('z', vec2uT), p('a', vec2uT), vec2uT),
                call('min', [p('b', vec2uT), lit(7, u32T)], vec2uT),
              ],
              vec2uT,
            ),
          ),
        ],
      ),
      // Element-converting constructors (saturating from f32, reinterpreting between the
      // integers), a constructor of a swizzle and scalars, `-(-1)`, and a splat of an expression.
      func(
        'cvts',
        [
          { name: 'v', type: v3 },
          { name: 's', type: f32T },
        ],
        arrayT(v4, 2),
        [
          letS('i', construct(vec3iT, [p('v', v3)])),
          letS('u', construct(vec3uT, [vref('i', vec3iT)])),
          letS('f', construct(v4, [member(p('v', v3), 'xy', v2), neg(lit(-1)), p('s')])),
          letS('g', construct(v3, [bin('*', p('s'), lit(2))])),
          ret(
            construct(arrayT(v4, 2), [
              bin(
                '+',
                vref('f', v4),
                construct(v4, [vref('g', v3), call('f32', [member(vref('u', vec3uT), 'x', u32T)])]),
                v4,
              ),
              construct(v4, [
                construct(v3, [vref('i', vec3iT)]),
                call('f32', [member(vref('u', vec3uT), 'z', u32T)]),
              ]),
            ]),
          ),
        ],
      ),
      // Every one-argument per-component builtin, on a vector and on a scalar.
      func('unary', [{ name: 'v', type: v3 }], arrayT(v3, LANE_UNARY.length), [
        ret(
          construct(
            arrayT(v3, LANE_UNARY.length),
            LANE_UNARY.map((fn) => call(fn, [p('v', v3)], v3)),
          ),
        ),
      ]),
      func('unaryS', [{ name: 'x', type: f32T }], arrayT(f32T, LANE_UNARY.length), [
        ret(
          construct(
            arrayT(f32T, LANE_UNARY.length),
            LANE_UNARY.map((fn) => call(fn, [p('x')])),
          ),
        ),
      ]),
      // The others, with vector arguments and with a scalar in each place the entry
      // broadcasts one.
      func(
        'nary',
        [
          { name: 'v', type: v3 },
          { name: 'w', type: v3 },
          { name: 't', type: f32T },
        ],
        arrayT(v3, 22),
        [
          ret(
            construct(arrayT(v3, 22), [
              call('atan2', [p('v', v3), p('w', v3)], v3),
              call('atan2', [p('v', v3), p('t')], v3),
              call('mod', [p('v', v3), p('w', v3)], v3),
              call('mod', [p('v', v3), p('t')], v3),
              call('pow', [p('v', v3), p('w', v3)], v3),
              call('pow', [p('v', v3), p('t')], v3),
              call(
                'ldexp',
                [p('v', v3), construct(vec3iT, [lit(2, i32T), lit(-3, i32T), lit(40, i32T)])],
                v3,
              ),
              call('fma', [p('v', v3), p('w', v3), p('v', v3)], v3),
              call('fma', [p('v', v3), p('t'), p('t')], v3),
              call('min', [p('v', v3), p('w', v3)], v3),
              call('min', [p('v', v3), p('t')], v3),
              call('min', [p('t'), p('w', v3)], v3),
              call('max', [p('t'), p('v', v3)], v3),
              call('clamp', [p('v', v3), p('w', v3), bin('+', p('w', v3), lit(1), v3)], v3),
              call('clamp', [p('v', v3), lit(0), lit(1)], v3),
              call('mix', [p('v', v3), p('w', v3), p('t')], v3),
              call('mix', [p('v', v3), p('w', v3), p('w', v3)], v3),
              call('mix', [p('t'), lit(2), p('v', v3)], v3),
              call('smoothstep', [p('v', v3), p('w', v3), p('v', v3)], v3),
              call('smoothstep', [lit(0), lit(1), p('v', v3)], v3),
              call('step', [p('v', v3), p('w', v3)], v3),
              call('step', [p('t'), p('w', v3)], v3),
            ]),
          ),
        ],
      ),
      // The reductions, over vec4, vec3 and vec2, one of an operand built per component, and
      // the scalar `length`, which goes through the table.
      func(
        'reds',
        [
          { name: 'a', type: v4 },
          { name: 'b', type: v4 },
          { name: 'c', type: v3 },
          { name: 'd', type: v2 },
        ],
        arrayT(f32T, 7),
        [
          ret(
            construct(arrayT(f32T, 7), [
              call('dot', [p('a', v4), p('b', v4)]),
              call('length', [p('a', v4)]),
              call('distance', [p('a', v4), p('b', v4)]),
              call('dot', [p('c', v3), bin('*', p('c', v3), lit(2), v3)]),
              call('length', [bin('-', p('c', v3), cref('KV', v3), v3)]),
              call('distance', [p('d', v2), member(p('a', v4), 'wz', v2)]),
              call('length', [member(p('b', v4), 'x')]),
            ]),
          ),
        ],
      ),
      func(
        'geo',
        [
          { name: 'a', type: v3 },
          { name: 'b', type: v3 },
        ],
        arrayT(v3, 3),
        [
          ret(
            construct(arrayT(v3, 3), [
              call('normalize', [p('a', v3)], v3),
              call('cross', [p('a', v3), p('b', v3)], v3),
              call(
                'normalize',
                [call('cross', [bin('+', p('a', v3), p('b', v3), v3), p('b', v3)], v3)],
                v3,
              ),
            ]),
          ),
        ],
      ),
      // A call that writes an operand's variable through `inout` between the operands: in
      // place (`p.x += 1`) and whole (`p = …`), before and after the operand is read.
      func('bumpIn', [{ name: 'p', type: v3, mode: 'inout' }], f32T, [
        assign(member(p('p', v3), 'x'), bin('+', member(p('p', v3), 'x'), lit(1))),
        ret(member(p('p', v3), 'x')),
      ]),
      func('swapIn', [{ name: 'p', type: v3, mode: 'inout' }], f32T, [
        assign(p('p', v3), construct(v3, [lit(9)])),
        ret(lit(0.5)),
      ]),
      func('order', [{ name: 'q', type: v3 }], arrayT(v3, 6), [
        varS('v', v3, p('q', v3)),
        letS('r1', bin('+', vref('v', v3), construct(v3, [call('bumpIn', [vref('v', v3)])]), v3)),
        letS('r2', bin('+', construct(v3, [call('bumpIn', [vref('v', v3)])]), vref('v', v3), v3)),
        letS('r3', bin('*', vref('v', v3), construct(v3, [call('swapIn', [vref('v', v3)])]), v3)),
        assign(vref('v', v3), p('q', v3)),
        letS('r4', bin('-', construct(v3, [call('swapIn', [vref('v', v3)])]), vref('v', v3), v3)),
        assign(vref('v', v3), p('q', v3)),
        letS(
          'r5',
          call(
            'normalize',
            [bin('+', vref('v', v3), construct(v3, [call('bumpIn', [vref('v', v3)])]), v3)],
            v3,
          ),
        ),
        letS(
          'r6',
          member(
            bin('+', vref('v', v3), construct(v3, [call('bumpIn', [vref('v', v3)])]), v3),
            'zy',
            v2,
          ),
        ),
        ret(
          construct(arrayT(v3, 6), [
            vref('r1', v3),
            vref('r2', v3),
            vref('r3', v3),
            vref('r4', v3),
            vref('r5', v3),
            construct(v3, [vref('r6', v2), member(vref('v', v3), 'x')]),
          ]),
        ),
      ]),
      // A parameter the caller passes a module variable to, which the function then writes:
      // what the parameter holds is what it held on entry.
      func('touchW', [{ name: 'p', type: v3 }], v3, [
        assign(member(vref('w', v3), 'x'), lit(100)),
        ret(bin('+', p('p', v3), vref('w', v3), v3)),
      ]),
      func('viaW', [{ name: 's', type: f32T }], v3, [
        ret(bin('*', call('touchW', [vref('w', v3)], v3), p('s'), v3)),
      ]),
      // Stores: a value built here is kept as it is, a shared one is copied, so a write through
      // one name never reaches another.
      func('fresh', [{ name: 'p', type: v3 }], arrayT(v3, 4), [
        varS('v', v3, bin('*', p('p', v3), lit(2), v3)),
        varS('s', PAIR, construct(PAIR, [vref('v', v3), bin('+', vref('v', v3), lit(1), v3)])),
        assign(member(member(vref('s', PAIR), 'a', v3), 'x'), lit(-7)),
        assign(member(member(vref('s', PAIR), 'b', v3), 'y'), lit(-8)),
        varS('t', v3, vref('v', v3)),
        assign(member(vref('t', v3), 'z'), lit(-9)),
        varS('u', v3, p('p', v3)),
        assign(member(vref('u', v3), 'y'), lit(-10)),
        ret(
          construct(arrayT(v3, 4), [
            vref('v', v3),
            member(vref('s', PAIR), 'a', v3),
            member(vref('s', PAIR), 'b', v3),
            bin('+', vref('u', v3), p('p', v3), v3),
          ]),
        ),
      ]),
      // A parameter rounded at entry, passed on, stored, written through the copy and read again.
      func(
        'passes',
        [
          { name: 'p', type: v3 },
          { name: 'x', type: f32T },
        ],
        v3,
        [
          letS('k', call('bcast', [p('p', v3), p('x')], v3)),
          varS('c', v3, p('p', v3)),
          assign(member(vref('c', v3), 'x'), p('x')),
          ret(bin('+', vref('k', v3), bin('+', vref('c', v3), p('p', v3), v3), v3)),
        ],
      ),
      // A vector select on a scalar condition (one arm evaluated) and a match of vectors.
      func(
        'pick',
        [
          { name: 'k', type: i32T },
          { name: 'v', type: v3 },
        ],
        v3,
        [
          letS(
            'a',
            sel(
              cmp('>', p('k', i32T), lit(0, i32T)),
              bin('*', p('v', v3), lit(2), v3),
              neg(p('v', v3), v3),
              v3,
            ),
          ),
          ret(
            bin(
              '+',
              vref('a', v3),
              matchE(
                p('k', i32T),
                [
                  [0, construct(v3, [lit(1)])],
                  [1, p('v', v3)],
                ],
                construct(v3, [lit(0.5), lit(0.25), lit(0.125)]),
                v3,
              ),
              v3,
            ),
          ),
        ],
      ),
      // Compound assignments on vectors, by a vector, by a scalar, on one component, and on
      // an integer vector.
      func(
        'ops',
        [
          { name: 'v', type: v3 },
          { name: 'w', type: v3 },
          { name: 's', type: f32T },
          { name: 'iv', type: vec3iT },
        ],
        v3,
        [
          varS('a', v3, p('v', v3)),
          assignOp(vref('a', v3), '+', p('w', v3)),
          assignOp(vref('a', v3), '*', p('s')),
          assignOp(member(vref('a', v3), 'y'), '-', p('s')),
          varS('b', vec3iT, p('iv', vec3iT)),
          assignOp(vref('b', vec3iT), '*', p('iv', vec3iT)),
          assignOp(vref('b', vec3iT), '/', lit(3, i32T)),
          ret(bin('+', vref('a', v3), construct(v3, [vref('b', vec3iT)]), v3)),
        ],
      ),
      // The emulated-double vector, held as a flat list like the others.
      func(
        'v64',
        [
          { name: 'a', type: vec3f64T },
          { name: 'b', type: vec3f64T },
        ],
        f64T,
        [ret(call('length', [bin('-', p('a', vec3f64T), p('b', vec3f64T), vec3f64T)], f64T))],
      ),
    ],
  };
}

/** The values the arithmetic has corners at, of each scalar kind. */
const CORNERS: Record<'f32' | 'i32' | 'u32', readonly number[]> = {
  f32: [
    0, -0, 1, -1, 0.5, -2.5, 0.1, 3, 1e-38, -1e-38, 1e-45, 3.4e38, -3.4e38, 3.5e38, 16777217,
  ].concat([NaN, Infinity, -Infinity, Math.PI]),
  i32: [0, 1, -1, 2, -2, 3, 7, -7, 31, 32, 65535, 2147483647, -2147483648],
  u32: [0, 1, 2, 3, 7, 31, 32, 65535, 2147483648, 4294967295],
};

function laneScalar(kind: 'f32' | 'i32' | 'u32', rng: () => number, corner: boolean): number {
  const pool = CORNERS[kind];
  if (corner) return pool[Math.floor(rng() * pool.length)]!;
  if (kind === 'i32') return (Math.floor(rng() * 4294967296) - 2147483648) | 0;
  if (kind === 'u32') return Math.floor(rng() * 4294967296) >>> 0;
  return rng() < 0.5 ? (rng() - 0.5) * 400 : (rng() - 0.5) * 2 ** (rng() * 200 - 100);
}

function laneArg(t: ShaderType, rng: () => number, corner: boolean): CpuValue {
  const kindOf = (e: string): 'f32' | 'i32' | 'u32' => (e === 'i32' || e === 'u32' ? e : 'f32');
  if (t.kind === 'vec')
    return Array.from({ length: t.n }, () => laneScalar(kindOf(t.elem), rng, corner));
  if (t.kind === 'vec64') return Array.from({ length: t.n }, () => laneScalar('f32', rng, corner));
  return laneScalar(t.kind === 'scalar' ? kindOf(t.scalar) : 'f32', rng, corner);
}

describe('compileModuleJs — the type-directed paths (#410)', () => {
  const m = buildLaneModule();

  it.each(['f64', 'f32'] as const)(
    'every fn is bit-identical to the interpreter at the corners, %s',
    (precision: CpuPrecision) => {
      const js = compileModuleJs(m, { precision });
      const interp = compileModule(m, { precision });
      const PER_FN = 300;
      const divergences: string[] = [];
      let checks = 0;
      let aliased = 0;
      for (const f of m.funcs) {
        if (f.params.some((q) => q.mode === 'inout')) continue;
        const rng = mulberry32(
          0x51ed270b ^ f.name.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7),
        );
        for (let k = 0; k < PER_FN; k++) {
          const args = f.params.map((q) => laneArg(q.type, rng, k % 2 === 0));
          // Now and then one array for every vector parameter of one type, as a caller may pass
          // it: a copy the function makes, or does not make, shows here.
          const share = rng() < 0.3;
          const run = (fn: (...a: CpuValue[]) => CpuValue): CpuValue => {
            const mine = clone(args);
            if (share) {
              f.params.forEach((q, i) => {
                const j = f.params.findIndex((r) => r.type === q.type);
                if (j !== i && Array.isArray(mine[j])) mine[i] = mine[j]!;
              });
            }
            return fn(...mine);
          };
          if (share) aliased++;
          const a = run(js.fns[f.name]!);
          const b = run(interp.fns[f.name]!);
          checks++;
          if (!bitEqual(a, b) && divergences.length < 10)
            divergences.push(
              `${f.name}(${JSON.stringify(args)}): js=${JSON.stringify(a)} interp=${JSON.stringify(b)}`,
            );
        }
      }
      console.log(`[#410 ${precision}] ${checks} checks, ${aliased} with shared arrays`);
      expect(divergences).toEqual([]);
      expect(checks).toBeGreaterThan(4000);
      expect(aliased).toBeGreaterThan(500);
    },
  );

  it('an operand another operand writes is read where the interpreter reads it', () => {
    // The instrument: each of `order`'s results differs from what reading `v` at the other
    // point would give, so a reordering could not pass unseen (AGENTS.md#gate-discipline).
    for (const precision of ['f64', 'f32'] as const) {
      const got = compileModuleJs(m, { precision }).fns.order!([1, 2, 3]);
      expect(got).toEqual(compileModule(m, { precision }).fns.order!([1, 2, 3]));
      expect((got as unknown as number[][]).slice(0, 4)).toEqual([
        [4, 4, 5], // v read as the array the call then writes in place: [2, 2, 3] + 2
        [6, 5, 6], // v read after the call: 3 + [3, 2, 3]
        [1.5, 1, 1.5], // v read before the call replaced it: [3, 2, 3] * 0.5
        [-8.5, -8.5, -8.5], // v read after the call replaced it: 0.5 - 9
      ]);
    }
  });

  it('a reduction sums from 0, as its builtin does, so a sum of -0 terms is +0', () => {
    // Only `dot` of products that are all -0 tells `0 + x` from `x`, and a random sweep almost
    // never draws one; so the case is named here, and shown to be +0, not -0.
    const args: CpuValue[] = [
      [-0, -0, -0, -0],
      [1, 2, 3, 4],
      [-0, 0, -1],
      [-0, -0],
    ];
    for (const precision of ['f64', 'f32'] as const) {
      const got = compileModuleJs(m, { precision }).fns.reds!(...clone(args)) as number[];
      expect(bitEqual(got, compileModule(m, { precision }).fns.reds!(...clone(args)))).toBe(true);
      expect(Object.is(got[0], 0)).toBe(true);
    }
  });

  it('a vector function reads nothing off the runtime in its body, and rounds each parameter once', () => {
    // `photoCell` from #410, the shape the issue measured.
    const q = param('q', v3);
    const k = param('k', v4);
    const g = param('grid', v4);
    const photo: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        func(
          'photoCell',
          [
            { name: 'q', type: v3 },
            { name: 'k', type: v4 },
            { name: 'grid', type: v4 },
          ],
          v3,
          [
            letS(
              'cell',
              call(
                'floor',
                [
                  bin(
                    '/',
                    bin('-', member(q, 'xy', v2), member(g, 'xy', v2), v2),
                    member(g, 'zw', v2),
                    v2,
                  ),
                ],
                v2,
              ),
            ),
            letS('d', call('max', [bin('*', member(q, 'z'), member(k, 'w')), lit(1e-4)])),
            ret(
              construct(v3, [
                bin('+', member(vref('cell', v2), 'x'), bin('*', member(k, 'x'), vref('d'))),
                bin('+', member(vref('cell', v2), 'y'), bin('*', member(k, 'y'), vref('d'))),
                bin('*', vref('d'), member(k, 'z')),
              ]),
            ),
          ],
        ),
      ],
    };
    const gen = generateModuleJs(photo, { precision: 'f32' });
    const body = gen.fns.find((s) => s.startsWith('"photoCell"'))!;
    // No helper looked up per call, no array for a swizzle, no copy of a value built here.
    expect(body).not.toMatch(/\$\./);
    expect(gen.decls).toContain('const $fr = Math.fround;');
    // Each component of each parameter is rounded once, on entry.
    for (const [i, n] of [
      [0, 3],
      [1, 4],
      [2, 4],
    ] as const)
      for (let c = 0; c < n; c++)
        expect(body.split(`$p${i}_${c} = $fr($a${i}[${c}]);`).length - 1).toBe(1);
    // And it computes what the interpreter computes.
    const args: CpuValue[] = [
      [0.3, 0.7, 2.5],
      [0.1, 0.2, 0.3, 0.9],
      [0, 0, 0.01, 0.01],
    ];
    expect(compileModuleJs(photo, { precision: 'f32' }).fns.photoCell!(...clone(args))).toEqual(
      compileModule(photo, { precision: 'f32' }).fns.photoCell!(...clone(args)),
    );
  });
});

// ═══ An operand that may be missing (#410) ═══
//
// A vector-typed expression is not always a vector at run time. A function that reaches a
// `discard` returns nothing (the interpreter's discard signal leaves the function as
// `undefined`), an element read past the end of an array is `undefined`, and a column read past
// a matrix's last is an empty list. The runtime helpers take such an operand as it comes, as a
// scalar (`applyBin` of `undefined` and 2 is NaN, and of two scalars is a scalar), and so does
// the interpreter. The per-component code reads `t[i]` of every operand the IR types as a
// vector, which throws for `undefined` and reads NaN from an empty list, so it is written only
// for an operand no such value can reach; a call of a function that may return nothing, an
// element read, and every name, field and parameter one is stored into or passed to keep the
// helper. Each function below is held to the interpreter in both precisions, on inputs that
// reach a missing operand and on ones that do not. The first cut of #410 threw a `TypeError` on
// two of them: a helper that discards feeding a vector operation, and `arr[i] + v` with `i`
// out of range.

const SHADED = structT('Shaded');
const BODY = structT('Body');
const ARR3 = arrayT(v3, 3);
const SHADED2 = arrayT(SHADED, 2);
const M33 = matT(3, 3);
const callS = (expr: Expr): Stmt => ({ s: 'call', expr });
const discardS: Stmt = { s: 'discard' };
const vecOf = (t: ShaderType, ...xs: number[]): Expr =>
  construct(
    t,
    xs.map((x) => lit(x)),
  );

function buildMissingModule(): ModuleDecl {
  const p = param('p', v2);
  const k = param('k', f32T);
  const s = param('s', i32T);
  const arr = param('arr', ARR3);
  const i = param('i', i32T);
  const v = param('v', v3);
  const shade = (a: Expr = p): Expr => call('shadeOrNothing', [a], v4);
  const plain = (a: Expr = p): Expr => call('plainColor', [a], v4);
  const twice = (e: Expr): Expr => bin('*', e, lit(2), v4);
  const P: P = { name: 'p', type: v2 };
  const K: P = { name: 'k', type: f32T };
  const S: P = { name: 's', type: i32T };
  const ARR: P = { name: 'arr', type: ARR3 };
  const I: P = { name: 'i', type: i32T };
  const V: P = { name: 'v', type: v3 };
  return {
    consts: [],
    structs: [
      { name: 'Shaded', fields: [{ name: 'color', type: v4 }] },
      {
        name: 'Body',
        fields: [
          { name: 'pos', type: v3 },
          { name: 'vel', type: v3 },
        ],
      },
    ],
    bindings: [
      { group: 0, binding: 0, name: 'pos', space: 'storage', access: 'read', type: arrayT(v3) },
      {
        group: 0,
        binding: 1,
        name: 'bodies',
        space: 'storage',
        access: 'read',
        type: arrayT(BODY),
      },
    ],
    vars: [{ name: 'held', space: 'private', type: v4 }],
    funcs: [
      // A function that reaches a `discard` returns nothing; one that does not returns a vector.
      func('shadeOrNothing', [P], v4, [
        ifS([{ cond: cmp('<', member(p, 'x'), lit(2)), body: [discardS] }]),
        ret(vecOf(v4, 1, 1, 1, 0.5)),
      ]),
      func('plainColor', [P], v4, [
        ret(construct(v4, [member(p, 'x'), member(p, 'y'), lit(0), lit(1)])),
      ]),
      // Two functions that double a vector, one handed a value that may be missing, one not.
      func('twiceOf', [{ name: 'c', type: v4 }], v4, [ret(twice(param('c', v4)))]),
      func('doubled', [{ name: 'c', type: v4 }], v4, [ret(twice(param('c', v4)))]),
      func('takesShaded', [{ name: 'q', type: SHADED }], v4, [
        ret(twice(member(param('q', SHADED), 'color', v4))),
      ]),

      // The missing value, used as it comes: returned, built into a struct, stored in a local
      // and in a variable assigned twice, passed on, stored into a field, written through an
      // `inout` parameter and into a module variable, returned through another function, and
      // picked by a select and by a match.
      func('viaReturn', [P], v4, [ret(shade())]),
      func('viaStruct', [P], SHADED, [ret(construct(SHADED, [shade()]))]),
      func('viaLocal', [P], v4, [letS('c', shade()), ret(twice(vref('c', v4)))]),
      func('viaReassigned', [P], v4, [
        varS('c', v4, plain()),
        assign(vref('c', v4), shade()),
        ret(bin('+', vref('c', v4), vref('c', v4), v4)),
      ]),
      func('viaArgument', [P], v4, [ret(call('twiceOf', [shade()], v4))]),
      func('viaStructArgument', [P], v4, [
        ret(call('takesShaded', [construct(SHADED, [shade()])], v4)),
      ]),
      // A struct whose field is missing, kept in an array and read back from it as a whole.
      func('viaStructArray', [P], v4, [
        letS(
          'list',
          construct(SHADED2, [construct(SHADED, [shade()]), construct(SHADED, [plain()])]),
        ),
        letS('q', index(vref('list', SHADED2), lit(0, i32T), SHADED)),
        ret(twice(member(vref('q', SHADED), 'color', v4))),
      ]),
      func('viaField', [P], v4, [
        varS('q', SHADED, construct(SHADED, [plain()])),
        assign(member(vref('q', SHADED), 'color', v4), shade()),
        ret(twice(member(vref('q', SHADED), 'color', v4))),
      ]),
      func('blank', [{ name: 'c', type: v4, mode: 'inout' }, P], voidT, [
        assign(param('c', v4), shade()),
      ]),
      func('viaInout', [P], v4, [
        varS('c', v4, plain()),
        callS(call('blank', [vref('c', v4), p], voidT)),
        ret(twice(vref('c', v4))),
      ]),
      func('hold', [P], voidT, [assign(vref('held', v4), shade())]),
      func('viaModuleVar', [P], v4, [
        callS(call('hold', [p], voidT)),
        ret(twice(vref('held', v4))),
      ]),
      func('passOn', [P], v4, [ret(shade())]),
      func('viaResult', [P], v4, [ret(twice(call('passOn', [p], v4)))]),
      func('viaSelect', [P, K], v4, [ret(twice(sel(cmp('>', k, lit(0)), shade(), plain(), v4)))]),
      func('viaMatch', [P, S], v4, [
        ret(
          twice(
            matchE(
              s,
              [
                [0, shade()],
                [1, plain()],
              ],
              plain(),
              v4,
            ),
          ),
        ),
      ]),
      func('viaSelectElse', [P, K], v4, [
        ret(twice(sel(cmp('>', k, lit(0)), plain(), shade(), v4))),
      ]),

      // What an operation makes of a missing operand is no vector either: `2. * nothing` is the
      // scalar NaN, which `normalize` throws at (`dot` and `cross` too), where a component read
      // of it answers NaN. An operation on the result of one is left to the helper too.
      func('viaScale', [P, K], v4, [ret(call('normalize', [bin('*', k, shade(), v4)], v4))]),

      // A function that ends without a value on some path: a `return` past a `break`, which
      // `all-paths-return` (it reads the last statement of a body) accepts, and a `discard`
      // inside a switch.
      func('afterBreak', [P, S], v4, [
        switchS(s, [{ values: [0], body: [{ s: 'break' }, ret(plain())] }], [ret(plain())]),
      ]),
      func('viaBreak', [P, S], v4, [ret(twice(call('afterBreak', [p, s], v4)))]),
      func('discardsInSwitch', [P, S], v4, [
        switchS(s, [{ values: [0], body: [discardS] }], []),
        ret(plain()),
      ]),
      func('viaSwitch', [P, S], v4, [ret(twice(call('discardsInSwitch', [p, s], v4)))]),

      // A `return` with no value, in a function that has one, returns nothing as well.
      func('bareReturn', [P, K], v4, [
        ifS([{ cond: cmp('<', k, lit(0)), body: [ret()] }]),
        ret(plain()),
      ]),
      func('viaBareReturn', [P, K], v4, [ret(twice(call('bareReturn', [p, k], v4)))]),

      // A function that returns a vector on every path is a vector where it is called.
      func('pickColor', [P, K], v4, [
        ifS([{ cond: cmp('>', k, lit(0)), body: [ret(plain())] }], [ret(twice(plain()))]),
      ]),
      func('switchColor', [P, S], v4, [
        switchS(s, [{ values: [0], body: [ret(plain())] }], [ret(twice(plain()))]),
      ]),
      func('usePicked', [P, K], v4, [
        letS('c', call('pickColor', [p, k], v4)),
        ret(bin('+', twice(vref('c', v4)), vref('c', v4), v4)),
      ]),
      func('useSwitched', [P, S], v4, [ret(twice(call('switchColor', [p, s], v4)))]),
      func('usePlain', [P], v4, [
        letS('c', plain()),
        ret(bin('+', twice(vref('c', v4)), vref('c', v4), v4)),
      ]),
      func('usePlainArgument', [P], v4, [ret(call('doubled', [plain()], v4))]),

      // An element read past the end of an array, a column past a matrix's last, a binding's.
      func('readOob', [ARR, I, V], v3, [ret(bin('+', index(arr, i, v3), v, v3))]),
      func('scaleOob', [ARR, I], v3, [ret(bin('*', index(arr, i, v3), lit(2), v3))]),
      func('lengthOob', [ARR, I], f32T, [ret(call('length', [index(arr, i, v3)]))]),
      func('accumulateOob', [ARR, I, V], v3, [
        varS('a', v3, index(arr, i, v3)),
        assignOp(vref('a', v3), '+', v),
        ret(vref('a', v3)),
      ]),
      // A missing element passed to a function, which reads it as a parameter: the parameter is
      // not read component by component as the function is entered.
      func('twiceOf3', [{ name: 'c', type: v3 }], v3, [ret(bin('*', param('c', v3), lit(2), v3))]),
      func('viaElement', [ARR, I], v3, [ret(call('twiceOf3', [index(arr, i, v3)], v3))]),
      // `dot` of what `arr[i] * 2.` makes of a missing element is a `TypeError` on the
      // interpreter, where per-component reads of it would answer NaN.
      func('dotOob', [ARR, I, V], f32T, [
        ret(call('dot', [bin('*', index(arr, i, v3), lit(2), v3), v])),
      ]),
      func('columnOob', [{ name: 'm', type: M33 }, { name: 'j', type: i32T }, V], v3, [
        ret(bin('*', index(param('m', M33), param('j', i32T), v3), v, v3)),
      ]),
      func('binding', [{ name: 'n', type: u32T }], v3, [
        ret(bin('*', index(vref('pos', arrayT(v3)), param('n', u32T), v3), lit(2), v3)),
      ]),
      // A struct read from an array holds vectors, and is not missing where its element is.
      func('stepOne', [{ name: 'n', type: u32T }, K], v3, [
        letS('b', index(vref('bodies', arrayT(BODY)), param('n', u32T), BODY)),
        ret(
          bin(
            '+',
            member(vref('b', BODY), 'pos', v3),
            bin('*', member(vref('b', BODY), 'vel', v3), k, v3),
            v3,
          ),
        ),
      ]),
    ],
  };
}

interface Case {
  readonly args: CpuValue[];
  /** Whether the call reaches an operand that is missing. */
  readonly missing: boolean;
}
const at = (missing: boolean, ...args: CpuValue[]): Case => ({ args, missing });

const P_OUT = [1, 0.5]; // `shadeOrNothing` discards
const P_IN = [3, 0.5];
const COLOR = [0.25, 0.5, 0.75, 1];
// An array of vectors is a list of lists on the CPU tier; `CpuValue` has no name for one.
const POSITIONS = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
] as unknown as CpuValue;
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const THIRD = [0.5, -1, 2];
const BODIES = [
  { pos: [1, 2, 3], vel: [0.5, 0, -1] },
  { pos: [4, 5, 6], vel: [0, 1, 0] },
];
const shaded = (): Case[] => [at(true, P_OUT), at(false, P_IN)];
const READS: Case[] = [
  at(false, POSITIONS, 0, THIRD),
  at(false, POSITIONS, 2, THIRD),
  at(true, POSITIONS, 3, THIRD),
  at(true, POSITIONS, 5, THIRD),
  at(true, POSITIONS, -1, THIRD),
  at(true, POSITIONS, 1e9, THIRD),
];

const MISSING_CASES: Record<string, Case[]> = {
  shadeOrNothing: shaded(),
  plainColor: [at(false, P_IN)],
  twiceOf: [at(false, COLOR)],
  doubled: [at(false, COLOR)],
  takesShaded: [at(false, { color: COLOR })],
  viaReturn: shaded(),
  viaStruct: shaded(),
  viaLocal: shaded(),
  viaReassigned: shaded(),
  viaArgument: shaded(),
  viaStructArgument: shaded(),
  viaStructArray: shaded(),
  viaField: shaded(),
  blank: [at(false, COLOR, P_IN), at(false, COLOR, P_OUT)],
  viaInout: shaded(),
  hold: shaded(),
  viaModuleVar: shaded(),
  passOn: shaded(),
  viaResult: shaded(),
  viaSelect: [at(true, P_OUT, 1), at(false, P_OUT, -1), at(false, P_IN, 1)],
  viaMatch: [at(true, P_OUT, 0), at(false, P_OUT, 1), at(false, P_OUT, 5), at(false, P_IN, 0)],
  viaSelectElse: [at(true, P_OUT, -1), at(false, P_OUT, 1), at(false, P_IN, -1)],
  viaScale: [at(true, P_OUT, 2), at(false, P_IN, 2)],
  afterBreak: [at(true, P_IN, 0), at(false, P_IN, 1)],
  viaBreak: [at(true, P_IN, 0), at(false, P_IN, 1)],
  discardsInSwitch: [at(true, P_IN, 0), at(false, P_IN, 1)],
  viaSwitch: [at(true, P_IN, 0), at(false, P_IN, 1)],
  bareReturn: [at(true, P_IN, -1), at(false, P_IN, 1)],
  viaBareReturn: [at(true, P_IN, -1), at(false, P_IN, 1)],
  pickColor: [at(false, P_IN, 1), at(false, P_IN, -1)],
  switchColor: [at(false, P_IN, 0), at(false, P_IN, 1)],
  usePicked: [at(false, P_IN, 1), at(false, P_IN, -1)],
  useSwitched: [at(false, P_IN, 0), at(false, P_IN, 1)],
  usePlain: [at(false, P_IN)],
  usePlainArgument: [at(false, P_IN)],
  readOob: READS,
  twiceOf3: [at(false, THIRD)],
  viaElement: READS.map((c) => at(c.missing, c.args[0]!, c.args[1]!)),
  dotOob: READS,
  scaleOob: READS,
  lengthOob: READS,
  accumulateOob: READS,
  columnOob: [
    at(false, ROWS, 0, THIRD),
    at(false, ROWS, 2, THIRD),
    at(true, ROWS, 3, THIRD),
    at(true, ROWS, -1, THIRD),
  ],
  binding: [at(false, 0), at(false, 2), at(true, 3), at(true, 7)],
  stepOne: [at(false, 0, 0.5), at(false, 1, 2)],
};

/** Whether `v` shows a value was missing on the way: `undefined`, NaN, or an empty list. */
function hasGap(v: unknown): boolean {
  if (v === undefined) return true;
  if (typeof v === 'number') return Number.isNaN(v);
  if (Array.isArray(v)) return v.length === 0 || v.some(hasGap);
  if (v !== null && typeof v === 'object') return Object.values(v).some(hasGap);
  return false;
}

type Outcome = { readonly value: CpuValue } | { readonly threw: string };
function outcomeOf(fn: (...a: CpuValue[]) => CpuValue, args: CpuValue[]): Outcome {
  try {
    return { value: fn(...clone(args)) };
  } catch (e) {
    return { threw: e instanceof Error ? e.constructor.name : String(e) };
  }
}
const sameOutcome = (a: Outcome, b: Outcome): boolean =>
  'threw' in a || 'threw' in b
    ? 'threw' in a && 'threw' in b && a.threw === b.threw
    : bitEqual(a.value, b.value);
const showOutcome = (o: Outcome): string =>
  'threw' in o ? `throws ${o.threw}` : JSON.stringify(o.value);

describe('compileModuleJs — an operand that may be missing keeps the helper (#410)', () => {
  const m = buildMissingModule();
  const build = (precision: CpuPrecision) => {
    const js = compileModuleJs(m, { precision });
    const interp = compileModule(m, { precision });
    for (const e of [js, interp]) {
      e.setBinding('pos', clone(POSITIONS) as unknown as CpuValue);
      e.setBinding('bodies', clone(BODIES) as unknown as CpuValue);
    }
    return { js, interp };
  };

  it('has a case for every function, and each case that says it reaches a missing operand does', () => {
    // The instrument (AGENTS.md#gate-discipline): a differential over inputs that never reach
    // the operand passes on any generator, so each case is shown, on the interpreter, to reach
    // it or not, and every function has cases.
    expect(Object.keys(MISSING_CASES).sort()).toEqual(m.funcs.map((f) => f.name).sort());
    for (const precision of ['f64', 'f32'] as const) {
      const { interp } = build(precision);
      let missing = 0;
      for (const [name, cases] of Object.entries(MISSING_CASES))
        for (const c of cases) {
          // A function with no result has none to show a gap in.
          if (m.funcs.find((f) => f.name === name)!.ret.kind === 'void') continue;
          const got = outcomeOf(interp.fns[name]!, c.args);
          const reached = 'threw' in got || hasGap(got.value);
          expect(
            reached,
            `${name}(${JSON.stringify(c.args)}) [${precision}]: ${showOutcome(got)}`,
          ).toBe(c.missing);
          if (c.missing) missing++;
        }
      expect(missing).toBeGreaterThan(30);
    }
  });

  it.each(['f64', 'f32'] as const)(
    'every function equals the interpreter, where an operand is missing and where it is not, %s',
    (precision) => {
      const { js, interp } = build(precision);
      const divergences: string[] = [];
      let checks = 0;
      for (const [name, cases] of Object.entries(MISSING_CASES))
        for (const c of cases) {
          const a = outcomeOf(js.fns[name]!, c.args);
          const b = outcomeOf(interp.fns[name]!, c.args);
          checks++;
          if (!sameOutcome(a, b))
            divergences.push(
              `${name}(${JSON.stringify(c.args)}): js ${showOutcome(a)}, interpreter ${showOutcome(b)}`,
            );
        }
      expect(divergences).toEqual([]);
      expect(checks).toBeGreaterThan(80);
    },
  );

  it('an element read past the end of an array is missing to `+` and `*`, as the interpreter has it', () => {
    for (const precision of ['f64', 'f32'] as const) {
      const { js } = build(precision);
      const read = (name: string, i: number): unknown =>
        js.fns[name]!(clone(POSITIONS) as unknown as CpuValue, i, [1, 1, 1]);
      // The missing operand is a scalar NaN, so `arr[i] + v` is NaN in each component and
      // `arr[i] * 2.` is one NaN, not a vector of them.
      expect(read('readOob', 5)).toEqual([NaN, NaN, NaN]);
      expect(read('scaleOob', 5)).toBeNaN();
      expect(read('lengthOob', 5)).toBeNaN();
      expect(read('readOob', 1)).toEqual([5, 6, 7]);
    }
  });

  it('a helper that discards is a missing value to the operation it feeds', () => {
    // In f64 nothing reads a component of what `viaReturn` returns, so it stays `undefined`;
    // in f32 the precision pass rounds it, which makes a scalar NaN of it.
    expect(build('f64').js.fns.viaReturn!(P_OUT)).toBeUndefined();
    expect(build('f32').js.fns.viaReturn!(P_OUT)).toBeNaN();
    for (const precision of ['f64', 'f32'] as const) {
      const { js } = build(precision);
      expect(js.fns.viaLocal!(P_OUT)).toBeNaN();
      expect(js.fns.viaLocal!(P_IN)).toEqual([2, 2, 2, 1]);
    }
  });

  it('the source keeps the helper where an operand may be missing, and not where it cannot be', () => {
    const gen = generateModuleJs(m, { precision: 'f32' });
    const idOf = (rhs: string): string => {
      for (const d of gen.decls) {
        const hit = d.match(/^const (\$h\d+) = (.*);$/);
        if (hit !== null && hit[2] === rhs) return hit[1]!;
      }
      throw new Error(`no binding of ${rhs}`);
    };
    const applyBin = idOf('$.applyBin');
    const body = (name: string): string => gen.fns.find((f) => f.startsWith(`"${name}"`))!;
    const callsHelper = (name: string): boolean => body(name).includes(`${applyBin}(`);
    // The instrument: the helper is bound, so a function that calls it is seen to.
    expect(callsHelper('viaLocal')).toBe(true);
    for (const name of [
      'viaLocal',
      'viaReassigned',
      'viaStructArray',
      'twiceOf',
      'takesShaded',
      'viaField',
      'viaInout',
      'viaModuleVar',
      'viaResult',
      'viaSelect',
      'viaSelectElse',
      'viaMatch',
      'viaScale',
      'twiceOf3',
      'viaBreak',
      'viaSwitch',
      'viaBareReturn',
      'readOob',
      'scaleOob',
      'accumulateOob',
      'columnOob',
      'binding',
    ])
      expect(callsHelper(name), `${name} calls applyBin`).toBe(true);
    // The per-component code, `$fr` being the rounding it writes, stays where nothing can be
    // missing: a function's own vector, a result that every path returns, a struct read from an
    // array, a parameter only a whole vector is passed.
    for (const name of [
      'usePlain',
      'usePicked',
      'useSwitched',
      'doubled',
      'usePlainArgument',
      'stepOne',
    ]) {
      expect(callsHelper(name), `${name} calls applyBin`).toBe(false);
      expect(body(name), `${name} rounds per component`).toContain('$fr(');
    }
  });
});
