// The WGSL writer spells every name the plan renames (Proposal 0070, C3): a declaration named like
// a WGSL reserved word or a predeclared function is emitted under its planned name, and the
// references follow it. Functional check of the writer; the record reads are in emitted-record.test.ts.
//
// Verifies: Rule 3.2, Rule 3.3, Rule 9.5 (docs/language-design.md; traced in reqs/).
import { describe, expect, it } from 'vitest';
import { emitModule } from './wgsl.js';
import { emitGlslModule } from './glsl.js';
import { allKindsModule } from '../testing/all-kinds-module.js';
import {
  builtin,
  f32T,
  fn,
  hostUniform,
  module,
  storageBuffer,
  vec3uT,
  vec4fT,
  voidT,
} from '../ir/index.js';
import type { Expr, FuncDecl, ModuleDecl } from '../ir/index.js';

/** A compute kernel that reads the host-owned uniform `name` (Proposal 0070, Q3). */
const readsHostUniform = (name: string) => {
  const u = hostUniform(name, f32T, { group: 0, binding: 0 });
  const out = storageBuffer('out', f32T, { group: 0, binding: 1, access: 'read_write' });
  const k = fn(
    'k',
    { gid: builtin('global_invocation_id', vec3uT) },
    voidT,
    ({ gid }) => {
      out.at(gid.x).assign(u.node);
    },
    { stage: 'compute', workgroupSize: 1 },
  );
  return module({ bindings: [u.binding, out.binding], funcs: [k] });
};

describe('WGSL writer spells the names of the plan (Proposal 0070, C3)', () => {
  const m = allKindsModule(
    {
      const: 'class',
      var: 'shared',
      helper: 'fract',
      entry: 'step',
      struct: 'common',
      field: 'half',
      param: 'f32',
    },
    'compute',
  );
  const wgsl = emitModule(m);

  it('emits without a throw, and no declaration keeps a reserved name', () => {
    expect(wgsl).not.toMatch(/\bfn step\(/);
    expect(wgsl).not.toMatch(/\bfn fract\(/);
    expect(wgsl).not.toMatch(/\bconst class\b/);
    expect(wgsl).not.toMatch(/\bstruct common\b/);
  });

  it('spells each renamed declaration with its planned name', () => {
    expect(wgsl).toMatch(/\bfn step_\(/);
    expect(wgsl).toMatch(/\bfn fract_\(/);
    expect(wgsl).toMatch(/\bconst class_\b/);
    expect(wgsl).toMatch(/\bstruct common_\b/);
  });
});

describe('a host-owned binding keeps its name, or the writer refuses it (Proposal 0070, Q3)', () => {
  it('refuses a host-owned uniform named by a WGSL reserved word, rather than emit it', () => {
    expect(() => emitModule(readsHostUniform('shared'))).toThrow(/host-owned binding 'shared'/);
  });

  it('refuses a host-owned uniform named by a GLSL reserved word, on GLSL only', () => {
    const m = readsHostUniform('half');
    expect(emitModule(m)).toContain('var<uniform> half: f32;');
    expect(() => emitGlslModule(m, 'fragment')).toThrow(/host-owned binding 'half'/);
  });

  it('keeps a host-owned uniform that both targets spell', () => {
    expect(emitModule(readsHostUniform('scale'))).toContain('var<uniform> scale: f32;');
  });
});

describe('a helper parameter named like a constant its function reads is respelled (Rule 3.2, #999)', () => {
  // A module built from IR literals, as an engine builds one. The IR tells a `param` from a
  // `constref`, and the two writers print both as the bare name, so the parameter would hide the
  // constant in its function. The module emits an enum member as `E_A` and a static field as
  // `Voice_OFFSET`, which a program reads as `E.A` and `Voice.OFFSET` while a parameter has the
  // emitted name. A function that does not read the constant keeps its parameter's name.
  const param = (name: string): Expr => ({ op: 'param', type: f32T, name });
  const constant = (name: string): Expr => ({ op: 'constref', type: f32T, name });
  const sum = (a: Expr, b: Expr): Expr => ({ op: 'binop', bop: '+', type: f32T, a, b });
  const helper = (name: string, parameter: string, body: Expr): FuncDecl => ({
    name,
    params: [{ name: parameter, type: f32T }],
    ret: f32T,
    body: [{ s: 'return', expr: body }],
  });
  const reads = helper('reads', 'K', sum(param('K'), constant('K')));
  const ignores = helper('ignores', 'K', param('K'));
  const call = (f: FuncDecl): Expr => ({
    op: 'call',
    type: f32T,
    fn: f.name,
    args: [{ op: 'lit', type: f32T, value: 7 }],
    declRef: f,
  });
  const fragment: FuncDecl = {
    name: 'fs',
    params: [],
    ret: vec4fT,
    retAttr: '@location(0)',
    attrs: ['@fragment'],
    stage: 'fragment',
    body: [
      {
        s: 'return',
        expr: {
          op: 'construct',
          type: vec4fT,
          args: [call(reads), call(ignores), { op: 'lit', type: f32T, value: 0 }, constant('K')],
        },
      },
    ],
  };
  const m: ModuleDecl = {
    consts: [{ name: 'K', type: f32T, wgslValue: 2, cpuValue: 2 }],
    structs: [],
    bindings: [],
    funcs: [reads, ignores, fragment],
  };

  it('respells the parameter where its function reads the constant, and only there', () => {
    const wgsl = emitModule(m);
    expect(wgsl).toContain('const K: f32 = 2.0;');
    expect(wgsl).toContain('fn reads(K_: f32) -> f32 {\n  return (K_ + K);\n}');
    expect(wgsl).toContain('fn ignores(K: f32) -> f32 {\n  return K;\n}');
    const glsl = emitGlslModule(m, 'fragment');
    expect(glsl).toContain('const float K = 2.0;');
    expect(glsl).toContain('float reads(float K_) {\n  return (K_ + K);\n}');
    expect(glsl).toContain('float ignores(float K) {\n  return K;\n}');
  });

  it('leaves the authored module as it was', () => {
    emitModule(m);
    expect(reads.params[0]!.name).toBe('K');
    expect(m.funcs[0]).toBe(reads);
  });
});

describe('a helper parameter named like a function its function calls is respelled (Rule 3.2, #1010)', () => {
  // A module built from IR literals, as an engine builds one. A call prints the name of its
  // function, and a parameter prints its own name, so a parameter of the function's name would be
  // called in its function. The module emits a class function as `Voice_shift`, which a program
  // calls as `Voice.shift(1)` while a parameter has the emitted name. A function that does not call
  // the function keeps its parameter's name.
  const param = (name: string): Expr => ({ op: 'param', type: f32T, name });
  const sum = (a: Expr, b: Expr): Expr => ({ op: 'binop', bop: '+', type: f32T, a, b });
  const shift: FuncDecl = {
    name: 'shift',
    params: [{ name: 'k', type: f32T }],
    ret: f32T,
    body: [{ s: 'return', expr: param('k') }],
  };
  const callShift: Expr = {
    op: 'call',
    type: f32T,
    fn: 'shift',
    args: [{ op: 'lit', type: f32T, value: 1 }],
    declRef: shift,
  };
  const calls: FuncDecl = {
    name: 'calls',
    params: [{ name: 'shift', type: f32T }],
    ret: f32T,
    body: [{ s: 'return', expr: sum(callShift, param('shift')) }],
  };
  const ignores: FuncDecl = {
    name: 'ignores',
    params: [{ name: 'shift', type: f32T }],
    ret: f32T,
    body: [{ s: 'return', expr: param('shift') }],
  };
  const call = (f: FuncDecl): Expr => ({
    op: 'call',
    type: f32T,
    fn: f.name,
    args: [{ op: 'lit', type: f32T, value: 7 }],
    declRef: f,
  });
  const fragment: FuncDecl = {
    name: 'fs',
    params: [],
    ret: vec4fT,
    retAttr: '@location(0)',
    attrs: ['@fragment'],
    stage: 'fragment',
    body: [
      {
        s: 'return',
        expr: {
          op: 'construct',
          type: vec4fT,
          args: [call(calls), call(ignores), { op: 'lit', type: f32T, value: 0 }, callShift],
        },
      },
    ],
  };
  const m: ModuleDecl = {
    consts: [],
    structs: [],
    bindings: [],
    funcs: [shift, calls, ignores, fragment],
  };

  it('respells the parameter where its function calls the function, and only there', () => {
    const wgsl = emitModule(m);
    expect(wgsl).toContain('fn shift(k: f32) -> f32 {');
    expect(wgsl).toContain('fn calls(shift_: f32) -> f32 {\n  return (shift(1.0) + shift_);\n}');
    expect(wgsl).toContain('fn ignores(shift: f32) -> f32 {\n  return shift;\n}');
    const glsl = emitGlslModule(m, 'fragment');
    expect(glsl).toContain('float shift(float k) {');
    expect(glsl).toContain('float calls(float shift_) {\n  return (shift(1.0) + shift_);\n}');
    expect(glsl).toContain('float ignores(float shift) {\n  return shift;\n}');
  });

  it('leaves the authored module as it was', () => {
    emitModule(m);
    expect(calls.params[0]!.name).toBe('shift');
    expect(m.funcs[1]).toBe(calls);
  });
});
