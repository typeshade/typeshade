import { describe, expect, it } from 'vitest';
import { compile } from '../../compiler/ts/compile.js';
import { compileModuleJs } from '../cpu-codegen.js';
import { boolT, i32T, type Expr, type ModuleDecl, type Stmt } from '../ir/index.js';
import { eachStmtExpr } from '../ir/visit.js';
import { generateModule } from '../testing/random-ir.js';
import { drawnFunction } from '../testing/draw-harness.js';
import { emitModule } from './wgsl.js';
import { emitGlslModule } from './glsl.js';
import { lowerSwitchContinues } from './glsl-switch-continue.js';

function fixture(source: string): ModuleDecl {
  const result = compile(`"use typeshade";\n${source}`);
  expect(result.diagnostics).toEqual([]);
  return result.module;
}
function agrees(m: ModuleDecl, inputs = [-1, 0, 1, 2, 3, 4, 5]): ModuleDecl {
  const original = JSON.stringify(m);
  const lowered = lowerSwitchContinues(m);
  const before = compileModuleJs(m, { precision: 'f32' });
  const after = compileModuleJs(lowered, { precision: 'f32' });
  for (const input of inputs) expect(after.fns.run!(input)).toEqual(before.fns.run!(input));
  expect(JSON.stringify(m)).toBe(original);
  const visit = (s: Stmt, switches: number): void => {
    if (s.s === 'continue') expect(switches).toBe(0);
    eachStmtExpr(
      s,
      () => {},
      (child) => visit(child, switches + (s.s === 'switch' ? 1 : 0)),
    );
  };
  for (const f of lowered.funcs) for (const s of f.body) visit(s, 0);
  return lowered;
}
const SIMPLE = `export function run(n: i32): i32 {
  let sum: i32 = 0;
  for (let i: i32 = 0; i < n; i++) {
    switch (i % 3) {
      case 0: continue;
      case 1: sum += 2; break;
      default: sum += 3;
    }
    const tail: i32 = i * 2;
    sum += tail;
  }
  return sum;
}`;

describe('GLSL switch continues', () => {
  it('skips the case and loop suffix, resets each iteration, and keeps zero-trip loops', () => {
    const m = fixture(SIMPLE);
    const lowered = agrees(m);
    const loops = (mod: ModuleDecl): Extract<Stmt, { s: 'for' }>[] => {
      const out: Extract<Stmt, { s: 'for' }>[] = [];
      const scan = (s: Stmt): void => {
        if (s.s === 'for') out.push(s);
        eachStmtExpr(s, () => {}, scan);
      };
      for (const f of mod.funcs) for (const s of f.body) scan(s);
      return out;
    };
    const [a] = loops(m),
      [b] = loops(lowered);
    expect(b!.init).toBe(a!.init);
    expect(b!.cond).toBe(a!.cond);
    expect(b!.update).toBe(a!.update);
    expect(b!.body[0]!.s).toBe('var');
    const guard = b!.body.at(-1)!;
    expect(guard.s).toBe('if');
    if (guard.s !== 'if') throw Error('Expected guarded loop suffix');
    expect(guard.arms[0]!.cond).toMatchObject({
      op: 'compare',
      cop: '==',
      type: { kind: 'scalar', scalar: 'bool' },
      a: { op: 'varref', type: { kind: 'scalar', scalar: 'bool' } },
      b: { op: 'lit', type: { kind: 'scalar', scalar: 'bool' }, value: false },
    });
  });

  it('preserves loop-condition, update and else-if condition side effects', () => {
    const m = fixture(`let trace: i32 = 0;
function loopCondition(i: i32, n: i32): bool { trace += 1; return i < n; }
function advanceLoopCounter(i: i32): i32 { trace += 100; return i + 1; }
function arm(i: i32): bool { trace += 10000; return i == 2; }
export function run(n: i32): i32 {
  trace = 0;
  let sum: i32 = 0;
  for (let i: i32 = 0; i < n; i++) {
    switch (i) {
      case 0: if (n > 1) { continue; } else if (arm(i)) { sum += 20; } break;
      case 2: if (arm(i)) { continue; } else { sum += 30; } break;
      default: sum += 2;
    }
    sum += 10;
  }
  return trace + sum;
}`);
    // The frontend deliberately restricts authored for updates. Test the private
    // lowering's general IR contract without relaxing that authoring rule.
    const run = m.funcs.find((f) => f.name === 'run')!;
    const conditionHelper = m.funcs.find((f) => f.name === 'loopCondition')!;
    const updateHelper = m.funcs.find((f) => f.name === 'advanceLoopCounter')!;
    const originalLoop = run.body.find((s): s is Extract<Stmt, { s: 'for' }> => s.s === 'for')!;
    const oldUpdate = originalLoop.update;
    if (oldUpdate.s !== 'assign' && oldUpdate.s !== 'assignOp') throw Error('Expected loop update');
    const update: Stmt = {
      s: 'assign',
      target: oldUpdate.target,
      expr: {
        op: 'call',
        fn: updateHelper.name,
        declRef: updateHelper,
        type: i32T,
        args: [oldUpdate.target],
      },
    };
    const condition: Expr = {
      op: 'call',
      fn: conditionHelper.name,
      declRef: conditionHelper,
      type: boolT,
      args: [oldUpdate.target, { op: 'param', name: 'n', type: i32T }],
    };
    expect(condition.op === 'call' && condition.declRef).toBe(conditionHelper);
    expect(update.s === 'assign' && update.expr.op === 'call' && update.expr.declRef).toBe(
      updateHelper,
    );
    const loop: Extract<Stmt, { s: 'for' }> = { ...originalLoop, cond: condition, update };
    const withEffectfulHeader: ModuleDecl = {
      ...m,
      funcs: m.funcs.map((f) =>
        f !== run
          ? f
          : {
              ...f,
              body: f.body.map((s) => (s === originalLoop ? loop : s)),
            },
      ),
    };
    const lowered = agrees(withEffectfulHeader);
    const loweredLoop = lowered.funcs
      .find((f) => f.name === 'run')!
      .body.find((s) => s.s === 'for')!;
    if (loweredLoop.s !== 'for') throw Error('Expected lowered loop');
    expect(loweredLoop.init).toBe(loop.init);
    expect(loweredLoop.cond).toBe(loop.cond);
    expect(loweredLoop.update).toBe(update);
    const result = compileModuleJs(lowered, { precision: 'f32' });
    expect([0, 1, 2, 3].map((n) => result.fns.run!(n))).toEqual([1, 10112, 215, 10316]);
  });

  it('preserves nested switch/default breaks and consecutive switches', () => {
    agrees(
      fixture(`export function run(n: i32): i32 {
  let sum: i32 = 0;
  for (let i: i32 = 0; i < n; i++) {
    switch (i % 2) {
      case 0:
        switch (i) { case 0: continue; default: sum += 2; break; }
        sum += 3; break;
      default:
        switch (i) { case 1: sum += 5; break; default: continue; }
        sum += 7;
    }
    switch (i) { case 2: continue; default: sum += 11; }
    sum += 13;
  }
  return sum;
}`),
    );
  });

  it('gives an inner loop inside a switch its own flag and preserves each break owner', () => {
    const lowered = agrees(
      fixture(`export function run(n: i32): i32 {
  let sum: i32 = 0;
  for (let i: i32 = 0; i < n; i++) {
    switch (i % 2) {
      case 0:
        for (let j: i32 = 0; j < 4; j++) {
          if (j == 0) { continue; }
          switch (j) { case 1: continue; case 2: break; default: sum += 2; }
          if (j == 2) { break; }
          sum += 3;
        }
        sum += 5; break;
      default: continue;
    }
    sum += 7;
  }
  return sum;
}`),
    );
    const flags = JSON.stringify(lowered).match(/"name":"_switchContinue\d+"/g)!;
    expect(new Set(flags).size).toBe(2);
  });

  it('preserves early return and discard, including a discard in a guarded suffix', () => {
    const m = fixture(`export function run(n: i32): i32 {
  for (let i: i32 = 0; i < 3; i++) {
    switch (i) { case 0: if (n == 0) { continue; } break; default: return i + n; }
    return n;
  }
  return 9;
}`);
    const f = m.funcs.find((fn) => fn.name === 'run')!;
    const loop = f.body.find((s): s is Extract<Stmt, { s: 'for' }> => s.s === 'for')!;
    const variant: ModuleDecl = {
      ...m,
      funcs: m.funcs.map((fn) =>
        fn !== f
          ? fn
          : {
              ...fn,
              body: fn.body.map((s) =>
                s !== loop
                  ? s
                  : {
                      ...loop,
                      body: [
                        loop.body[0]!,
                        {
                          s: 'if',
                          arms: [
                            {
                              cond: {
                                op: 'compare',
                                cop: '<',
                                type: { kind: 'scalar', scalar: 'bool' },
                                a: { op: 'param', name: 'n', type: i32T },
                                b: { op: 'lit', type: i32T, value: 0 },
                              },
                              body: [{ s: 'discard' }],
                            },
                          ],
                        },
                        ...loop.body.slice(1),
                      ],
                    },
              ),
            },
      ),
    };
    agrees(m);
    agrees(variant);
  });

  it('avoids module, parameter, local and raw-text names and preserves raw functions', () => {
    const m = fixture(`let _switchContinue0: i32 = 1;
${SIMPLE.replace('run(n: i32)', 'run(_switchContinue1: i32)').replace('i < n', 'i < _switchContinue1')}`);
    const raw = {
      name: 'raw',
      params: [],
      ret: i32T,
      body: [
        {
          s: 'raw' as const,
          wgsl: 'return 0;',
          glsl: 'int _switchContinue2 = 0; return _switchContinue2;',
        },
      ],
    };
    const withRaw: ModuleDecl = { ...m, funcs: [...m.funcs, raw] };
    const lowered = lowerSwitchContinues(withRaw);
    expect(lowered.funcs.at(-1)).toBe(raw);
    expect(JSON.stringify(lowered.funcs[0])).toContain('_switchContinue3');
    expect(lowerSwitchContinues(lowered)).toBe(lowered);
  });

  it('leaves modules without affected continues identical and never changes WGSL', () => {
    const plain = fixture(
      'export function run(n: i32): i32 { for (let i: i32 = 0; i < n; i++) { if (i == 0) continue; } return n; }',
    );
    expect(lowerSwitchContinues(plain)).toBe(plain);
    const m = fixture(SIMPLE);
    const wgsl = emitModule(m);
    const first = emitGlslModule(m);
    expect(first).toContain('_switchContinue');
    expect(emitGlslModule(m)).toBe(first);
    expect(emitModule(m)).toBe(wgsl);
    expect(wgsl).not.toContain('_switchContinue');
  });

  it('legalizes actual seed 1 f1 and f4 without changing their f32 oracle results', () => {
    const generated = generateModule(1, { exact: true }).module;
    const lowered = lowerSwitchContinues(generated);
    const a = compileModuleJs(generated, { precision: 'f32' });
    const b = compileModuleJs(lowered, { precision: 'f32' });
    for (const x of [-1000, -0.5, -0, 0, 0.5, 3.5, 1000]) {
      expect(b.fns.f1!([x, 0.5, -1000, 1])).toEqual(a.fns.f1!([x, 0.5, -1000, 1]));
      expect(b.fns.f4!(x, [x, 0.5, -1000])).toEqual(a.fns.f4!(x, [x, 0.5, -1000]));
    }
    const glsl = emitGlslModule(drawnFunction(generated, 'f1', 16, 8).module, 'fragment');
    expect(glsl).toContain('_switchContinue');
    expect(glsl).not.toContain('continue;');
  });
});
