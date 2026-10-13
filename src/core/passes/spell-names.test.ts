// The late rename of Proposal 0070 (C2): every declaration and every reference kind of the spelling
// plan, on the IR, with no writer. Names come from the all-kinds factory and from hand-built IR.

import { describe, expect, it } from 'vitest';
import type { ConstDecl, Expr, FuncDecl, ModuleDecl, Stmt } from '../ir/index.js';
import { f32T, u32T, vec3fT } from '../ir/index.js';
import { eachExpr, eachStmtExpr } from '../ir/visit.js';
import { allKindsModule } from '../testing/all-kinds-module.js';
import { planSpellings, unspellable, type TargetSpellings } from '../spelling-plan.js';
import { spellModule } from './spell-names.js';

/** One name per kind, each one the target cannot spell on either target. */
const NAMES = {
  const: 'class',
  var: 'static',
  helper: 'union',
  entry: 'enum',
  fragment: 'interface',
  binding: 'typedef',
  texture: 'namespace',
  override: 'template',
  struct: 'this',
  field: 'public',
  param: 'extern',
} as const;

const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });

const emptySpellings = (): TargetSpellings => ({
  funcs: new Map(),
  entries: new Map(),
  consts: new Map(),
  vars: new Map(),
  bindings: new Map(),
  overrides: new Map(),
  structs: new Map(),
  members: new Map(),
  hostStructs: new Set(),
});

/** Every reference of `m` by its kind: the op and the name it carries. */
function refsOf(m: ModuleDecl): [string, string][] {
  const out: [string, string][] = [];
  const visit = (e: Expr): void =>
    eachExpr(e, (x) => {
      if (x.op === 'constref' || x.op === 'overrideref' || x.op === 'varref' || x.op === 'param')
        out.push([x.op, x.name]);
      else if (x.op === 'call') out.push([x.declRef ? 'call' : 'builtin', x.fn]);
      else if (x.op === 'member' && x.base.type.kind === 'struct') out.push(['member', x.field]);
    });
  for (const f of m.funcs) for (const s of f.body) eachStmtExpr(s, visit);
  for (const c of m.consts) if (c.valueExpr) visit(c.valueExpr);
  for (const v of m.vars ?? []) if (v.init) visit(v.init);
  return out;
}

const namesOf = (m: ModuleDecl, op: string): string[] =>
  refsOf(m)
    .filter(([kind]) => kind === op)
    .map(([, name]) => name);

/** The module with `stmt` appended to the body of the function named `in`. */
function withStmt(m: ModuleDecl, inFn: string, stmt: Stmt): ModuleDecl {
  return {
    ...m,
    funcs: m.funcs.map((f) => (f.name === inFn ? { ...f, body: [...f.body, stmt] } : f)),
  };
}

const fnNamed = (m: ModuleDecl, name: string): FuncDecl => {
  const f = m.funcs.find((x) => x.name === name);
  if (f === undefined) throw new Error(`no function ${name}`);
  return f;
};

/** Every object of `value`, recursively, is frozen. */
function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const v of Object.values(value)) deepFreeze(v, seen);
  return Object.freeze(value);
}

describe('spellModule: the factory names are unspellable on both targets', () => {
  it('holds for every name of the factory', () => {
    for (const name of Object.values(NAMES)) {
      expect(unspellable('wgsl', name), name).toBe(true);
      expect(unspellable('glsl', name), name).toBe(true);
    }
  });
});

describe('spellModule: the compute factory on WGSL', () => {
  const m = allKindsModule(NAMES, 'compute');
  const plan = planSpellings(m).wgsl;
  const out = spellModule(m, plan, 'wgsl');

  it('renames each declaration to the spelling the plan gives it', () => {
    expect(out.consts.map((c) => c.name)).toEqual(['class_']);
    expect(out.overrides?.map((o) => o.name)).toEqual(['template_']);
    expect(out.vars?.map((v) => v.name)).toEqual(['static_']);
    expect(out.structs.map((s) => [s.name, s.fields.map((f) => f.name)])).toEqual([
      ['this_', ['public_']],
    ]);
    expect(out.bindings.map((b) => b.name)).toEqual(['typedef_']);
    expect(out.funcs.map((f) => f.name)).toEqual(['union_', 'enum_']);
    expect(fnNamed(out, 'enum_').params.map((p) => p.name)).toEqual(['extern_']);
  });

  it('renames each reference kind of section 0 item 5 to the same spelling', () => {
    expect(namesOf(out, 'constref')).toEqual(['class_']);
    expect(namesOf(out, 'overrideref')).toEqual(['template_']);
    expect(namesOf(out, 'varref')).toEqual(['static_', 'typedef_']);
    // The helper's own parameter read stays authored; the entry's read is spelled.
    expect(namesOf(out, 'param')).toEqual(['extern', 'extern_']);
    expect(namesOf(out, 'call')).toEqual(['union_']);
    expect(namesOf(out, 'member')).toEqual(['public_']);
  });

  it('keeps a call without a declaration and the builtin it names', () => {
    // `f32` is the factory's cast of its override (a builtin call the pass keeps), and `fract` the
    // builtin the module calls beside its declaration.
    expect(namesOf(out, 'builtin')).toEqual(['f32', 'fract']);
  });

  it('spells the struct in the binding type and in the array element', () => {
    const binding = out.bindings[0]!;
    expect(binding.type).toEqual({ kind: 'array', elem: { kind: 'struct', name: 'this_' } });
  });

  it('keeps the authored module and the host contract, which the rename does not rewrite', () => {
    expect(fnNamed(out, 'enum_').workgroupSizeOverrides).toEqual([
      undefined,
      'template',
      undefined,
    ]);
  });
});

describe('spellModule: the graphics factory on WGSL', () => {
  const m = allKindsModule(NAMES, 'graphics');
  const out = spellModule(m, planSpellings(m).wgsl, 'wgsl');

  it('renames the texture, the struct in both entries and the entry names', () => {
    expect(out.bindings.map((b) => b.name)).toEqual(['typedef_', 'namespace_', 'namespaceSampler']);
    expect(fnNamed(out, 'enum_').ret).toEqual({ kind: 'struct', name: 'this_' });
    expect(fnNamed(out, 'interface_').params[0]!.type).toEqual({ kind: 'struct', name: 'this_' });
    expect(out.funcs.map((f) => f.name)).toEqual(['union_', 'enum_', 'interface_']);
  });

  it('leaves a sampler that WGSL spells, and renames its read', () => {
    expect(namesOf(out, 'varref')).toEqual(['typedef_', 'namespace_', 'namespaceSampler']);
  });
});

describe('spellModule: rules of the scope and the reference kinds', () => {
  it('leaves a local that shares a binding name alone in its own function, and renames the read in another (R5)', () => {
    const m: ModuleDecl = {
      consts: [],
      structs: [],
      funcs: [
        {
          name: 'own',
          params: [],
          ret: f32T,
          body: [
            { s: 'let', name: 'class', expr: lit(1) },
            { s: 'return', expr: { op: 'varref', type: f32T, name: 'class' } },
          ],
        },
        {
          name: 'other',
          params: [],
          ret: f32T,
          body: [{ s: 'return', expr: { op: 'varref', type: f32T, name: 'class' } }],
        },
      ],
      bindings: [{ group: 0, binding: 0, name: 'class', space: 'uniform', type: f32T }],
    };
    const out = spellModule(m, planSpellings(m).wgsl, 'wgsl');
    expect(namesOf({ ...out, funcs: [fnNamed(out, 'own')] }, 'varref')).toEqual(['class']);
    expect(namesOf({ ...out, funcs: [fnNamed(out, 'other')] }, 'varref')).toEqual(['class_']);
  });

  it('spells an entry parameter and leaves a helper parameter of the same name alone', () => {
    const m: ModuleDecl = {
      consts: [],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'helper',
          params: [{ name: 'extern', type: f32T }],
          ret: f32T,
          body: [{ s: 'return', expr: { op: 'param', type: f32T, name: 'extern' } }],
        },
        {
          name: 'main',
          params: [{ name: 'extern', type: u32T, builtin: 'global_invocation_id' }],
          ret: { kind: 'void' },
          attrs: ['@compute'],
          body: [{ s: 'return', expr: { op: 'param', type: u32T, name: 'extern' } }],
        },
      ],
    };
    const out = spellModule(m, planSpellings(m).wgsl, 'wgsl');
    expect(fnNamed(out, 'helper').params[0]!.name).toBe('extern');
    expect(namesOf({ ...out, funcs: [fnNamed(out, 'helper')] }, 'param')).toEqual(['extern']);
    expect(fnNamed(out, 'main').params[0]!.name).toBe('extern_');
    expect(namesOf({ ...out, funcs: [fnNamed(out, 'main')] }, 'param')).toEqual(['extern_']);
  });

  it('keeps a call without a declaration, even when it names a renamed helper', () => {
    const m = withStmt(allKindsModule(NAMES, 'compute'), 'enum', {
      s: 'call',
      expr: { op: 'call', type: f32T, fn: 'union', args: [lit(1)] },
    });
    const out = spellModule(m, planSpellings(m).wgsl, 'wgsl');
    expect(namesOf(out, 'builtin')).toEqual(['f32', 'fract', 'union']);
    expect(namesOf(out, 'call')).toEqual(['union_']);
  });

  it('keeps a swizzle, whose base is a vector and not a struct, though its field has a renamed name', () => {
    const m = withStmt(allKindsModule(NAMES, 'compute'), 'enum', {
      s: 'let',
      name: 'sw',
      expr: {
        op: 'member',
        type: f32T,
        base: { op: 'construct', type: vec3fT, args: [lit(0), lit(0), lit(0)] },
        field: 'public',
      },
    });
    const out = spellModule(m, planSpellings(m).wgsl, 'wgsl');
    const sw = fnNamed(out, 'enum_').body.at(-1) as { s: 'let'; expr: Expr };
    expect(sw.expr).toMatchObject({ op: 'member', field: 'public' });
    expect(namesOf(out, 'member')).toEqual(['public_']);
  });

  it('spells a struct in a module variable type and in an extern type, and keeps the extern name', () => {
    const m: ModuleDecl = {
      consts: [],
      structs: [{ name: 'this', fields: [{ name: 'x', type: f32T }] }],
      bindings: [],
      funcs: [],
      vars: [{ name: 'static', space: 'private', type: { kind: 'struct', name: 'this' } }],
      externs: [
        {
          name: 'host',
          type: { kind: 'struct', name: 'this' },
          spelling: { wgsl: 'host_value' },
        },
      ],
    };
    const plan = planSpellings(m).wgsl;
    const out = spellModule(m, plan, 'wgsl');
    expect(out.vars![0]!.type).toEqual({ kind: 'struct', name: 'this_' });
    expect(out.externs![0]!.type).toEqual({ kind: 'struct', name: 'this_' });
    expect(out.externs![0]!.name).toBe('host');
    expect(out.externs![0]!.spelling).toEqual({ wgsl: 'host_value' });
  });

  it('spells a size override, a constant value, a variable initialiser and the workgroup text', () => {
    const m: ModuleDecl = {
      consts: [
        { name: 'class', type: f32T, wgslValue: 1, cpuValue: 1 },
        {
          name: 'k2',
          type: f32T,
          wgslValue: 1,
          cpuValue: 1,
          valueExpr: { op: 'constref', type: f32T, name: 'class' },
        } satisfies ConstDecl,
      ],
      overrides: [{ name: 'template', type: u32T, default: 8 }],
      vars: [
        {
          name: 'static',
          space: 'private',
          type: f32T,
          init: { op: 'constref', type: f32T, name: 'class' },
        },
      ],
      structs: [],
      bindings: [
        {
          group: 0,
          binding: 0,
          name: 'typedef',
          space: 'storage',
          type: { kind: 'array', elem: f32T, sizeOverride: 'template' },
        },
      ],
      funcs: [
        {
          name: 'enum',
          params: [],
          ret: { kind: 'void' },
          attrs: ['@compute', '@workgroup_size(class, template)'],
          workgroupSizeOverrides: [undefined, 'template', undefined],
          body: [],
        },
      ],
    };
    const out = spellModule(m, planSpellings(m).wgsl, 'wgsl');
    expect(out.consts[1]!.valueExpr).toEqual({ op: 'constref', type: f32T, name: 'class_' });
    expect(out.vars![0]!.init).toEqual({ op: 'constref', type: f32T, name: 'class_' });
    expect(out.bindings[0]!.type).toEqual({
      kind: 'array',
      elem: f32T,
      sizeOverride: 'template_',
    });
    expect(fnNamed(out, 'enum_').attrs).toEqual(['@compute', '@workgroup_size(class_, template_)']);
    expect(fnNamed(out, 'enum_').workgroupSizeOverrides).toEqual([
      undefined,
      'template',
      undefined,
    ]);
  });
});

describe('spellModule: identity, the authored module, and the refusals', () => {
  it('returns the module itself for a plan that renames nothing', () => {
    const m = allKindsModule(NAMES, 'compute');
    expect(spellModule(m, emptySpellings(), 'wgsl')).toBe(m);
  });

  it('returns the module itself when the plan renames a name the module does not hold', () => {
    const other = allKindsModule(NAMES, 'compute');
    const m: ModuleDecl = {
      consts: [{ name: 'x', type: f32T, wgslValue: 0, cpuValue: 0 }],
      structs: [],
      bindings: [],
      funcs: [],
    };
    expect(spellModule(m, planSpellings(other).wgsl, 'wgsl')).toBe(m);
  });

  it('leaves the authored module unchanged, which is frozen here', () => {
    const m = deepFreeze(allKindsModule(NAMES, 'compute'));
    const before = JSON.stringify(m);
    const out = spellModule(m, planSpellings(m).wgsl, 'wgsl');
    expect(out).not.toBe(m);
    expect(JSON.stringify(m)).toBe(before);
  });

  it('refuses a raw statement in a function when the plan renames anything', () => {
    const m: ModuleDecl = {
      consts: [{ name: 'class', type: f32T, wgslValue: 0, cpuValue: 0 }],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'f',
          params: [],
          ret: { kind: 'void' },
          body: [{ s: 'raw', wgsl: 'x = 1.0;' }],
        },
      ],
    };
    expect(() => spellModule(m, planSpellings(m).wgsl, 'wgsl')).toThrow(
      "wgsl: a raw statement is present and constant 'class' needs the spelling 'class_'; raw text cannot be rewritten",
    );
  });

  it('refuses a local that takes the spelling of a renamed name the plan did not see', () => {
    const t = emptySpellings();
    const plan = { ...t, consts: new Map([['class', 'class_']]) };
    const m: ModuleDecl = {
      consts: [{ name: 'class', type: f32T, wgslValue: 0, cpuValue: 0 }],
      structs: [],
      bindings: [],
      funcs: [
        {
          name: 'f',
          params: [],
          ret: f32T,
          body: [
            { s: 'let', name: 'class_', expr: lit(1) },
            { s: 'return', expr: { op: 'varref', type: f32T, name: 'class_' } },
          ],
        },
      ],
    };
    expect(() => spellModule(m, plan, 'wgsl')).toThrow(/spelling 'class' as 'class_' collides/);
  });

  it('refuses two module-scope declarations that end with one name', () => {
    const plan = { ...emptySpellings(), consts: new Map([['class', 'class_']]) };
    const m: ModuleDecl = {
      consts: [{ name: 'class', type: f32T, wgslValue: 0, cpuValue: 0 }],
      structs: [],
      bindings: [{ group: 0, binding: 0, name: 'class_', space: 'uniform', type: f32T }],
      funcs: [],
    };
    expect(() => spellModule(m, plan, 'wgsl')).toThrow(
      /collides with a declaration of the same name/,
    );
  });
});
