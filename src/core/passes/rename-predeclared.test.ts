// A module function named like something its target predeclares is emitted under another name
// (change 0029, Rule 9.5): which functions, which calls, which name, and for which target.
//
// Verifies: Rule 3.2, Rule 9.5 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { isValueConstructor } from '../../compiler/ts/lower/constructors.js';
import type { Expr, ModuleDecl, Stmt } from '../ir/index.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { INTRINSICS, PORTABLE_INTRINSICS, PRE_EMIT_INTRINSICS } from '../intrinsics.js';
import { emitFuncs, emitModule } from '../backends/wgsl.js';
import { emitGlslModule } from '../backends/glsl.js';
import { GLSL_ES300_BUILTIN_FUNCTIONS, WGSL_PREDECLARED } from '../reserved-words.js';
import { f32T, type FuncDecl } from '../ir/index.js';
import {
  predeclaredFunctionNames,
  renamePredeclaredFunctions,
  renameTargetOf,
} from './rename-predeclared.js';

const moduleOf = (source: string): ModuleDecl => {
  const c = compile(source);
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return c.module;
};

/** Every call of `m`, in the order the functions and their statements hold them. */
function callsOf(m: ModuleDecl): { in: string; fn: string; declared: boolean }[] {
  const out: { in: string; fn: string; declared: boolean }[] = [];
  for (const f of m.funcs) {
    const visit = (e: Expr): void =>
      eachExpr(e, (x) => {
        if (x.op === 'call') out.push({ in: f.name, fn: x.fn, declared: x.declRef !== undefined });
      });
    const walk = (s: Stmt): void => eachStmtExpr(s, visit, walk);
    f.body.forEach(walk);
  }
  return out;
}

/** `m` with every `declRef` dropped: what a call made by name, through `externFn`, is. */
function withoutDeclRefs(m: ModuleDecl): ModuleDecl {
  const drop = (e: Expr): Expr => {
    const walked = ((): Expr => {
      switch (e.op) {
        case 'call':
          return { ...e, args: e.args.map(drop) };
        case 'binop':
        case 'compare':
        case 'logical':
          return { ...e, a: drop(e.a), b: drop(e.b) };
        default:
          return e;
      }
    })();
    if (walked.op !== 'call') return walked;
    const { declRef: _declRef, ...rest } = walked;
    return rest as Expr;
  };
  const mapStmt = (s: Stmt): Stmt => {
    if (s.s === 'return' && s.expr !== undefined) return { ...s, expr: drop(s.expr) };
    if (s.s === 'let') return { ...s, expr: drop(s.expr) };
    if (s.s === 'call') return { ...s, expr: drop(s.expr) };
    return s;
  };
  return { ...m, funcs: m.funcs.map((f) => ({ ...f, body: f.body.map(mapStmt) })) };
}

/** `m` with its one entry point named `name`, which the front end would refuse to name it. */
function entryNamed(name: string, m: ModuleDecl): ModuleDecl {
  return { ...m, funcs: m.funcs.map((f) => (f.stage !== undefined ? { ...f, name } : f)) };
}

const FRACT = `"use typeshade";
function fract(x: f32): f32 { return x - floor(x) + 0.5; }
export function g(x: f32): f32 { return fract(x) + random(x); }
`;

describe('which name a function is emitted under', () => {
  it('is the same object for a module with no such function', () => {
    const m = moduleOf(`"use typeshade";\nexport function g(x: f32): f32 { return sin(x); }\n`);
    expect(renamePredeclaredFunctions(m, 'wgsl')).toBe(m);
    expect(renamePredeclaredFunctions(m, 'glsl')).toBe(m);
  });

  it('is `name_`, on both targets, for a function named like a builtin', () => {
    const m = moduleOf(FRACT);
    for (const target of ['wgsl', 'glsl'] as const) {
      const r = renamePredeclaredFunctions(m, target);
      expect(
        r.funcs.map((f) => f.name),
        target,
      ).toEqual(['fract_', 'g']);
    }
  });

  it('is `name_1` when `name_` is taken, by a function, a constant or a local', () => {
    const cases: [string, string][] = [
      ['a function', 'function fract_(x: f32): f32 { return x; }'],
      ['a constant', 'const fract_ = 2.;'],
      [
        'a local of another function',
        'function other(x: f32): f32 { const fract_ = x; return fract_; }',
      ],
    ];
    for (const [what, decl] of cases) {
      const m = moduleOf(`"use typeshade";
${decl}
function fract(x: f32): f32 { return x; }
export function g(x: f32): f32 { return fract(x); }
`);
      const r = renamePredeclaredFunctions(m, 'wgsl');
      expect(
        r.funcs.map((f) => f.name),
        what,
      ).toContain('fract_1');
      // Each spelling is taken, so the second is the first free one, and the taken name is
      // untouched: the function that held it keeps it.
      expect(callsOf(r).find((c) => c.in === 'g')?.fn, what).toBe('fract_1');
    }
  });

  it('renames each of several, none of them onto another', () => {
    const m = moduleOf(`"use typeshade";
function fract(x: f32): f32 { return x; }
function fract_(x: f32): f32 { return x; }
function min(a: f32, b: f32): f32 { return a; }
export function g(x: f32): f32 { return fract(x) + fract_(x) + min(x, x); }
`);
    const r = renamePredeclaredFunctions(m, 'wgsl');
    expect(r.funcs.map((f) => f.name)).toEqual(['fract_1', 'fract_', 'min_', 'g']);
    expect(callsOf(r).map((c) => c.fn)).toEqual(['fract_1', 'fract_', 'min_']);
  });

  it('leaves an entry point its name, which the host creates the pipeline by', () => {
    // The front end refuses an entry of this name where the WGSL uses it (TS8068,
    // `declared-builtin-names.test.ts`); the IR is renamed by hand, as a module built with `fn()`
    // can name one.
    const m = entryNamed(
      'min',
      moduleOf(`"use typeshade";
declare const out: storage<array<f32>, "read_write">;
@compute([1])
export function main() { out[0] = 1.; }
`),
    );
    expect(renamePredeclaredFunctions(m, 'wgsl')).toBe(m);
    expect(renamePredeclaredFunctions(m, 'glsl')).toBe(m);
  });

  it('renames a call that carries a declRef, and leaves one that carries none the builtin', () => {
    const m = moduleOf(FRACT);
    const r = renamePredeclaredFunctions(m, 'wgsl');
    // The author's call, through the declaration, and the compiler's own, in random's expansion.
    expect(callsOf(r)).toEqual([
      { in: 'fract_', fn: 'floor', declared: false },
      { in: 'g', fn: 'fract_', declared: true },
      { in: 'g', fn: 'fract', declared: false },
      { in: 'g', fn: 'sin', declared: false },
    ]);
    // A call made by name has no declaration to reach: it is the builtin, and only the
    // declaration is renamed.
    const byName = renamePredeclaredFunctions(withoutDeclRefs(m), 'wgsl');
    expect(byName.funcs.map((f) => f.name)).toEqual(['fract_', 'g']);
    expect(callsOf(byName).map((c) => c.fn)).toEqual(['floor', 'fract', 'fract', 'sin']);
  });

  it('is idempotent', () => {
    for (const target of ['wgsl', 'glsl'] as const) {
      const once = renamePredeclaredFunctions(moduleOf(FRACT), target);
      const twice = renamePredeclaredFunctions(once, target);
      expect(twice, target).toBe(once);
    }
  });
});

describe('which target renames what', () => {
  // Every name is declared, and each is called that a call reaches: a value constructor keeps its
  // precedence over a declaration (Rule 9.5), so a call of `array` is the constructor.
  const declaring = (names: readonly string[]): ModuleDecl =>
    moduleOf(
      `"use typeshade";\n${names.map((n) => `function ${n}(x: f32): f32 { return x; }`).join('\n')}\n` +
        `export function g(x: f32): f32 { return ${['x', ...names.filter((n) => !isValueConstructor(n)).map((n) => `${n}(x)`)].join(' + ')}; }\n`,
    );
  const renamed = (m: ModuleDecl, target: 'wgsl' | 'glsl'): string[] =>
    renamePredeclaredFunctions(m, target)
      .funcs.map((f) => f.name)
      .filter((n) => n.endsWith('_') || /_\d+$/.test(n));

  it('renames a WGSL type, a generator, an alias and an enumerant, which WGSL would hide', () => {
    const m = declaring(['array', 'atomic', 'vec3f', 'read', 'storage', 'rgba8unorm', 'fract']);
    expect(renamed(m, 'wgsl')).toEqual([
      'array_',
      'atomic_',
      'vec3f_',
      'read_',
      'storage_',
      'rgba8unorm_',
      'fract_',
    ]);
    // GLSL ES 3.00 predeclares only its built-in functions: `fract`. (Its keywords and type names
    // are `sanitizeReservedIdents`'s, after this.)
    expect(renamed(m, 'glsl')).toEqual(['fract_']);
  });

  it('renames what GLSL ES 3.00 predeclares and WGSL does not', () => {
    const m = declaring(['inversesqrt', 'dFdx', 'texelFetch', 'lessThan', 'roundEven']);
    expect(renamed(m, 'glsl')).toEqual([
      'inversesqrt_',
      'dFdx_',
      'texelFetch_',
      'lessThan_',
      'roundEven_',
    ]);
    expect(renamed(m, 'wgsl')).toEqual([]);
  });

  it('renames the id of a builtin the IR carries even where the target has no such name', () => {
    // GLSL ES 3.00 has no `atan2`, `saturate` or `f64`, and a call of each is still the builtin
    // (`atan(y, x)`, `clamp(x, 0.0, 1.0)`), so a function of that name must not be mistaken for
    // it, or the builtin for the function, by a pass that reads a call by its name.
    const m = declaring(['atan2', 'saturate', 'f64']);
    expect(renamed(m, 'glsl')).toEqual(['atan2_', 'saturate_', 'f64_']);
    expect(GLSL_ES300_BUILTIN_FUNCTIONS.has('atan2')).toBe(false);
    expect(WGSL_PREDECLARED.has('f64')).toBe(false);
  });

  it('knows the target of a backend by its id, and no other', () => {
    expect(renameTargetOf('wgsl')).toBe('wgsl');
    expect(renameTargetOf('glsl-es300')).toBe('glsl');
    expect(renameTargetOf('spirv')).toBeUndefined();
  });

  it('holds every builtin id of the IR, and what its own target predeclares', () => {
    for (const target of ['wgsl', 'glsl'] as const) {
      const names = predeclaredFunctionNames(target);
      for (const id of [
        ...Object.keys(INTRINSICS),
        ...PORTABLE_INTRINSICS,
        ...PRE_EMIT_INTRINSICS,
      ]) {
        expect(names.has(id), `${target}: ${id}`).toBe(true);
      }
    }
    for (const n of WGSL_PREDECLARED) expect(predeclaredFunctionNames('wgsl').has(n), n).toBe(true);
    for (const n of GLSL_ES300_BUILTIN_FUNCTIONS) {
      expect(predeclaredFunctionNames('glsl').has(n), n).toBe(true);
    }
  });
});

describe('what a writer emits', () => {
  it('spells the declaration and the calls through it alike on both targets', () => {
    const m = moduleOf(`"use typeshade";
function fract(x: f32): f32 { return x - floor(x) + 0.5; }
export function g(x: f32): f32 { return fract(x) + random(x); }
class Color {
  @location(0) color: vec4;
}
@fragment
export function fs(@builtin("position") p: vec4): Color {
  const v = g(p.x);
  return { color: vec4(v, v, v, 1.) };
}
`);
    const wgsl = emitModule(m);
    const glsl = emitGlslModule(m, 'fragment');
    for (const text of [wgsl, glsl]) {
      expect(text).toMatch(/(fn|float) fract_\(/);
      expect(text).toContain('fract_(x) + fract((sin(x) * 43758.5453123))');
    }
  });

  it('renames in a list of functions as it does in a module, so the text matches', () => {
    const m = moduleOf(`"use typeshade";
function fract(x: f32): f32 { return x - floor(x) + 0.5; }
export function g(x: f32): f32 { return fract(x); }
`);
    const listed = emitFuncs(m.funcs);
    expect(listed).toContain('fn fract_(x: f32) -> f32 {');
    expect(listed).toContain('return fract_(x);');
    expect(emitModule(m)).toContain(listed);
  });

  it('does not rename what an entry point calls by name, through no declaration', () => {
    const m = withoutDeclRefs(moduleOf(FRACT));
    const wgsl = emitModule(m);
    // The declaration is `fract_` and no call reaches it: each `fract(x)` is the builtin, the one
    // the author's call became when the module lost its `declRef`s.
    expect(wgsl).toContain('fn fract_(');
    expect(wgsl).not.toContain('fract_(x)');
    expect(wgsl).toMatch(/\bfract\(x\)/);
  });
});

describe('what the pass keeps of the module it is given', () => {
  // `autoVars` runs after this pass, and pairs an assignment's target with the reads of it by
  // object identity: `const acc = fract(v); acc.assign(acc + 1)` holds ONE expression object as
  // the assignment's target and inside its value. A rename that copied that object once per
  // place split it into two, and the WGSL read the declaration's result again on each assignment
  // instead of the variable.
  const fractDecl: FuncDecl = {
    name: 'fract',
    params: [{ name: 'x', type: f32T }],
    ret: f32T,
    body: [{ s: 'return', expr: { op: 'param', type: f32T, name: 'x' } }],
  };
  const v: Expr = { op: 'param', type: f32T, name: 'v' };
  const acc: Expr = { op: 'call', type: f32T, fn: 'fract', args: [v], declRef: fractDecl };
  const shared: Expr = { op: 'call', type: f32T, fn: 'sin', args: [v] };
  const g: FuncDecl = {
    name: 'g',
    params: [{ name: 'v', type: f32T }],
    ret: f32T,
    body: [
      {
        s: 'assign',
        target: acc,
        expr: { op: 'binop', type: f32T, bop: '+', a: acc, b: shared },
      },
      { s: 'return', expr: { op: 'binop', type: f32T, bop: '+', a: acc, b: shared } },
    ],
  };
  const untouched: FuncDecl = {
    name: 'h',
    params: [{ name: 'v', type: f32T }],
    ret: f32T,
    body: [{ s: 'return', expr: shared }],
  };
  const m: ModuleDecl = { consts: [], structs: [], bindings: [], funcs: [fractDecl, g, untouched] };

  it('rebuilds a shared expression once, and an untouched one not at all', () => {
    const r = renamePredeclaredFunctions(m, 'wgsl');
    const [, rg, rh] = r.funcs;
    expect(rh).toBe(untouched);
    const assign = rg!.body[0]! as Extract<Stmt, { s: 'assign' }>;
    const ret = rg!.body[1]! as Extract<Stmt, { s: 'return' }>;
    const value = assign.expr as Extract<Expr, { op: 'binop' }>;
    const returned = ret.expr as Extract<Expr, { op: 'binop' }>;
    expect(assign.target).toMatchObject({ op: 'call', fn: 'fract_' });
    expect(value.a).toBe(assign.target);
    expect(returned.a).toBe(assign.target);
    // `sin(v)` reaches no renamed call: it is the object the module held.
    expect(value.b).toBe(shared);
    expect(returned.b).toBe(shared);
  });

  it('leaves autoVars one variable, read where the author read the value', () => {
    const wgsl = emitModule(m);
    expect(wgsl).toContain('var _av0: f32 = fract_(v);');
    expect(wgsl).toMatch(/_av0 = \(_av0 \+ \w+\);/);
    expect(wgsl).toMatch(/return \(_av0 \+ \w+\);/);
    expect(wgsl).not.toMatch(/fract_\(v\) \+/);
  });
});

describe('an entry point named like a builtin (Rule 3.2)', () => {
  // The front end refuses one whose name the WGSL uses (TS8068, `declared-builtin-names.test.ts`),
  // because WGSL hides the builtin beside a module-scope `fn fract` and an entry keeps the name
  // written. The writers
  // are held here on IR that names one anyway, as a module built with `fn()` can: neither
  // renames the entry, and GLSL ES 3.00, which spells an entry `main`, still calls the builtin.
  const m = entryNamed(
    'fract',
    moduleOf(`"use typeshade";
class Color {
  @location(0) color: vec4;
}
@fragment
export function fs(@builtin("position") p: vec4): Color {
  return { color: vec4(fract(p.x), random(p.y), 0., 1.) };
}
`),
  );

  it('keeps its name in WGSL, which is why the front end refuses it', () => {
    expect(emitModule(m)).toMatch(/@fragment\s+fn fract\(/);
  });

  it('is main() in GLSL ES 3.00, and the builtin is called by its own name', () => {
    const glsl = emitGlslModule(m, 'fragment');
    expect(glsl).toContain('void main()');
    expect(glsl).not.toContain('fract_');
    expect(glsl).toMatch(/[^_]fract\(p\.x\)/);
  });
});
