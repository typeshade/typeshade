import { describe, expect, it } from 'vitest';
import { compile } from '../../../compiler/ts/compile.js';
import { compileModule } from '../../oracle.js';
import type { ModuleDecl, Stmt } from '../../ir/index.js';
import { licm } from './licm.js';

function fixture(body = 'const value: f32 = sin(fixed); acc += value;', bound = '4') {
  const result = compile(`"use typeshade";
    export function f(x: f32, n: i32): f32 {
      let fixed: f32 = x * 2.;
      let acc: f32 = 0.;
      for (let i: i32 = 0; i < ${bound}; i++) { ${body} }
      return acc;
    }`);
  expect(result.diagnostics).toEqual([]);
  return result.module;
}

function bodyOf(m: ModuleDecl): readonly Stmt[] {
  return m.funcs.find((f) => f.name === 'f')!.body;
}

function localHoists(body: readonly Stmt[]): readonly Stmt[] {
  return body.filter(
    (s) => s.s === 'let' && s.name.startsWith('_licm') && JSON.stringify(s).includes('fixed'),
  );
}

describe('LICM with local inputs at the loop preheader', () => {
  it('retains fp64 renormalization and its opaque guard, once before the loop', () => {
    const { wgsl, diagnostics } = compile(`"use typeshade";
      export function f(x: f64): f64 {
        let acc: f64 = x;
        const fixed: f64 = x * 2;
        for (let i: u32 = 0; i < 12; i++) {
          const value: f64 = acc - fixed;
          acc = value * 0.5;
        }
        return acc;
      }`);
    expect(diagnostics).toEqual([]);
    if (wgsl === undefined) throw new Error('Expected successful WGSL emission');
    const body = wgsl.slice(wgsl.indexOf('fn f('), wgsl.indexOf('\nfn df64_'));
    const loop = body.indexOf('for (');
    expect(loop).toBeGreaterThan(0);
    expect(body.slice(0, loop)).toMatch(/df64_add\(fixed, \w+, _fp64_g\)/);
    expect(body.slice(0, loop)).toContain('textureLoad(_fp64');
    expect(body.slice(0, loop)).toContain('bitcast<f32>(bitcast<u32>(0.0))');
    expect(body.slice(loop)).not.toContain('df64_add(fixed,');
    expect(body.slice(loop)).toContain('df64_add(acc,');
  });

  it('moves an invariant after its local declaration, and preserves values across iterations', () => {
    const m = fixture();
    const out = licm(m);
    const body = bodyOf(out);
    expect(localHoists(body)).toHaveLength(1);
    const loop = body.find((s) => s.s === 'for')!;
    expect(loop.s).toBe('for');
    expect(JSON.stringify(loop)).not.toContain('"fn":"sin"');
    expect(body.indexOf(localHoists(body)[0]!)).toBeGreaterThan(
      body.findIndex((s) => s.s === 'var' && s.name === 'fixed'),
    );
    expect(body.indexOf(localHoists(body)[0]!)).toBeLessThan(body.indexOf(loop));
    const before = compileModule(m).fns.f!;
    const after = compileModule(out).fns.f!;
    for (const x of [-2, -0.1, 0, 0.5, 3]) expect(after(x, 4)).toBe(before(x, 4));
    expect(licm(out)).toEqual(out);
  });

  it.each(['0', 'n'])('does not speculate across a loop with bound %s', (bound) => {
    expect(localHoists(bodyOf(licm(fixture(undefined, bound))))).toHaveLength(0);
  });

  it.each([
    'const value: f32 = sin(fixed); fixed += 1.; acc += value;',
    'const value: f32 = sin(fixed); if (i > 1) { fixed += 1.; } acc += value;',
    'const value: f32 = sin(fixed); for (let j: i32 = 0; j < 2; j++) { fixed += 1.; } acc += value;',
    'const fixed: f32 = f32(i); const value: f32 = sin(fixed); acc += value;',
    'if (i > 1) { break; } const value: f32 = sin(fixed); acc += value;',
    'if (i > 1) { const value: f32 = sin(fixed); acc += value; }',
    'continue; const value: f32 = sin(fixed); acc += value;',
    'acc += 1.; const value: f32 = sin(fixed); acc += value;',
    'const value: f32 = sin(fixed); workgroupBarrier(); acc += value;',
    'const take: bool = i > 0 && sin(fixed) > 0.; if (take) { acc += 1.; }',
    'const value: f32 = i > 0 ? sin(fixed) : 0.; acc += value;',
  ])('leaves a variant or guarded local calculation in place: %s', (body) => {
    expect(localHoists(bodyOf(licm(fixture(body))))).toHaveLength(0);
  });

  it('accounts for writes in the continuing statement', () => {
    const m = fixture();
    const f = m.funcs[0]!;
    const fixed = { op: 'varref', name: 'fixed', type: { kind: 'scalar', scalar: 'f32' } } as const;
    const changed: ModuleDecl = {
      ...m,
      funcs: [
        {
          ...f,
          body: f.body.map((s) =>
            s.s !== 'for'
              ? s
              : {
                  ...s,
                  update: {
                    s: 'assignOp',
                    target: fixed,
                    bop: '+',
                    expr: { op: 'lit', type: fixed.type, value: 1 },
                  },
                },
          ),
        },
      ],
    };
    expect(localHoists(bodyOf(licm(changed)))).toHaveLength(0);
  });

  it('keeps a preheader in its enclosing branch', () => {
    const m = fixture();
    const f = m.funcs[0]!;
    const changed: ModuleDecl = {
      ...m,
      funcs: [
        {
          ...f,
          body: f.body.map((s) =>
            s.s !== 'for'
              ? s
              : {
                  s: 'if',
                  arms: [
                    {
                      cond: { op: 'lit', type: { kind: 'scalar', scalar: 'bool' }, value: true },
                      body: [s],
                    },
                  ],
                },
          ),
        },
      ],
    };
    const body = bodyOf(licm(changed));
    expect(localHoists(body)).toHaveLength(0);
    const branch = body.find((s) => s.s === 'if')!;
    expect(branch.s === 'if' && localHoists(branch.arms[0]!.body).length).toBe(1);
  });

  it('does not move a helper that reads a global written by the loop', () => {
    const { module: m, diagnostics } = compile(`"use typeshade";
      let gp: f32 = 1.;
      function read(q: f32): f32 { return gp * q; }
      export function f(x: f32): f32 {
        const fixed: f32 = x * 2.;
        let acc: f32 = 0.;
        for (let i: i32 = 0; i < 4; i++) {
          const value: f32 = read(fixed);
          gp += 1.; acc += value;
        }
        return acc;
      }`);
    expect(diagnostics).toEqual([]);
    expect(localHoists(bodyOf(licm(m)))).toHaveLength(0);
    expect(compileModule(licm(m)).fns.f!(0.5)).toBe(compileModule(m).fns.f!(0.5));
  });
});
