import { describe, expect, it } from 'vitest';
import { compileTsSource } from '../../compiler/ts/source-file.js';
import type { FuncDecl, ModuleDecl, StructDecl } from '../ir/index.js';
import { f32T, texture2dfT, type Expr, type ShaderType } from '../ir/index.js';
import { stampSpans } from '../testing/stamp-spans.js';
import {
  DEBUG_LAUNCH_SCHEMA,
  DebugConfigError,
  resolveBindings,
  startDebugSessionFromConfig,
  type DebugLaunchConfig,
} from './config.js';

function compiled(source: string): ModuleDecl {
  const r = compileTsSource(source, { fileName: 'cfg.shade.ts' });
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return {
    consts: [...r.consts],
    structs: r.structs.map((s) => s.decl),
    bindings: [...r.bindings],
    funcs: [...r.funcs],
  };
}

function problems(m: ModuleDecl, config: DebugLaunchConfig): readonly string[] {
  try {
    startDebugSessionFromConfig(m, config);
  } catch (e) {
    expect(e).toBeInstanceOf(DebugConfigError);
    return (e as DebugConfigError).problems;
  }
  throw new Error('expected the configuration to be rejected');
}

const structsOf = (m: ModuleDecl): Map<string, StructDecl> =>
  new Map(m.structs.map((s) => [s.name, s]));

const withShape = (m: ModuleDecl, shape: FuncDecl['workgroupShape']): ModuleDecl => ({
  ...m,
  funcs: m.funcs.map((f) => ({
    ...f,
    workgroupSize: undefined,
    attrs: undefined,
    workgroupShape: shape,
  })),
});

const IDS = `"use typeshade";
@compute([4, 3, 2]) export function k(
  gid: builtin<"global_invocation_id">,
  lid: builtin<"local_invocation_id">,
  wid: builtin<"workgroup_id">,
  li: builtin<"local_invocation_index">,
): void {
  let x: u32 = gid.x;
}
`;

const locals = (m: ModuleDecl, config: DebugLaunchConfig): ReadonlyMap<string, unknown> =>
  startDebugSessionFromConfig(m, { precision: 'f64', ...config }).pause!.frames[0]!.locals;

describe('the compute ids derived from global_invocation_id', () => {
  it('uses the three-axis WGSL formula for the local index', () => {
    const l = locals(compiled(IDS), {
      entry: 'k',
      invocation: { global_invocation_id: [10, 7, 3] },
    });
    expect(l.get('lid')).toEqual([2, 1, 1]);
    expect(l.get('wid')).toEqual([2, 2, 1]);
    expect(l.get('li')).toBe(18);
  });

  it('takes a workgroup of 64 by 1 by 1 when the entry declares no shape', () => {
    const m = withShape(compiled(IDS), undefined);
    const l = locals(m, { entry: 'k', invocation: { global_invocation_id: [70, 0, 0] } });
    expect(l.get('lid')).toEqual([6, 0, 0]);
    expect(l.get('wid')).toEqual([1, 0, 0]);
    expect(l.get('li')).toBe(6);
  });

  it('names a workgroup with no invocations instead of deriving NaN ids', () => {
    const m = withShape(compiled(IDS), [0, 1, 1]);
    const found = problems(m, { entry: 'k', invocation: { global_invocation_id: [1, 0, 0] } });
    expect(found).toEqual([
      'k is @compute([0, 1, 1]), which has no invocations to derive an id from',
    ]);
  });

  it('seeds num_workgroups for a kernel that reads only it', () => {
    const m = compiled(`"use typeshade";
@compute([1]) export function k(nwg: builtin<"num_workgroups">): void {
  let x: u32 = nwg.x;
}
`);
    expect(locals(m, { entry: 'k', invocation: { dispatch: [2, 3, 4] } }).get('nwg')).toEqual([
      2, 3, 4,
    ]);
    expect(locals(m, { entry: 'k' }).get('nwg')).toEqual([1, 1, 1]);
  });
});

describe('the dispatch is checked before it is used', () => {
  const m = compiled(IDS);
  const bad = (dispatch: unknown): readonly string[] =>
    problems(m, { entry: 'k', invocation: { dispatch } as never });

  it('refuses a dispatch that is not three finite numbers', () => {
    const sentence = '"dispatch" must be three finite numbers, [x, y, z]';
    expect(bad([1, 1])).toEqual([sentence]);
    expect(bad([1, 1, 1, 1])).toEqual([sentence]);
    expect(bad([1, Number.NaN, 1])).toEqual([sentence]);
    expect(bad([1, Number.POSITIVE_INFINITY, 1])).toEqual([sentence]);
    expect(bad('abc')).toEqual([sentence]);
  });

  it('refuses a negative axis as it refuses a zero one', () => {
    expect(bad([1, -1, 1])[0]).toContain('"dispatch" must be positive');
  });
});

describe('what a refusal lists is sorted, and says none when there is nothing', () => {
  it('lists the declared builtins in alphabetical order', () => {
    const [msg] = problems(compiled(IDS), { entry: 'k', invocation: { bogus: 1 } as never });
    expect(msg).toContain(
      'k declares global_invocation_id, local_invocation_id, local_invocation_index, workgroup_id',
    );
  });

  it('lists the declared inputs in alphabetical order', () => {
    const m = compiled(`"use typeshade";
@fragment export function fs(zeta: location<0, vec2>, alpha: location<1, vec2>): vec4 {
  return vec4(zeta, alpha);
}
`);
    const [msg] = problems(m, { entry: 'fs', invocation: { inputs: { nope: [0, 0] } } });
    expect(msg).toContain('fs takes alpha, zeta');
  });

  it('lists every launch key in alphabetical order', () => {
    const [msg] = problems(compiled(IDS), { entry: 'k', typo: 1 } as never);
    expect(msg).toBe(
      '"typo" is not a launch configuration key; it takes ' +
        'bindings, breakpoints, derivatives, entry, invocation, maxSteps, name, precision, ' +
        'program, request, stopOnEntry, type',
    );
  });

  it('says none for an entry with no builtins, no inputs and no bindings', () => {
    const m = compiled(`"use typeshade";
export function f(a: f32): f32 {
  return a;
}
`);
    const found = problems(m, {
      entry: 'f',
      invocation: { bogus: 1, inputs: { bogus: 1 } } as never,
      bindings: { bogus: 1 },
    });
    expect(found).toEqual([
      '"bogus" is not a builtin this entry declares; f declares none (a @location input goes under "inputs")',
      '"bogus" is not an input this entry declares; f takes a',
      '"bogus" is not a binding this module declares; it declares none',
    ]);
  });

  it('says none for an entry that takes no input', () => {
    const [msg] = problems(compiled(IDS), {
      entry: 'k',
      invocation: { inputs: { bogus: 1 } },
    });
    expect(msg).toBe('"bogus" is not an input this entry declares; k takes none');
  });

  it('says none when the module declares no function', () => {
    const empty: ModuleDecl = { consts: [], structs: [], bindings: [], funcs: [] };
    expect(problems(empty, { entry: 'f' })).toEqual([
      'no function "f" in module; it declares none',
    ]);
  });
});

describe('the problems come in the order they were found', () => {
  it('reports the key, the derivative mode, the budget, the invocation, then the bindings', () => {
    const m = compiled(`"use typeshade";
declare const near: uniform<f32>;
@fragment export function fs(uv: location<0, vec2>): vec4 {
  return vec4(uv, near, 1.);
}
`);
    const found = problems(m, {
      entry: 'fs',
      typo: true,
      derivatives: 'quad',
      maxSteps: 0,
      invocation: { bogus: 1, inputs: { uv: [1] } },
      bindings: { far: 1 },
    } as never);
    const heads = found.map((p) => p.split(' ').slice(0, 2).join(' '));
    expect(heads).toEqual([
      '"typo" is',
      "derivatives: 'quad'",
      'maxSteps must',
      '"bogus" is',
      'input "uv":',
      '"far" is',
    ]);
  });
});

describe('a location input is not a builtin of the same name', () => {
  it('keeps position the builtin and position the input apart', () => {
    const m = compiled(`"use typeshade";
@fragment export function fs(p: builtin<"position">, position: location<0, vec2>): vec4 {
  return vec4(p.x, p.w, position.x, position.y);
}
`);
    const s = startDebugSessionFromConfig(m, {
      entry: 'fs',
      precision: 'f64',
      invocation: { position: [1, 2, 3, 4], inputs: { position: [5, 6] } },
    });
    s.continue();
    expect(s.result).toEqual([1, 4, 5, 6]);
  });
});

describe('the defaults of a builtin carried by a struct field', () => {
  it('gives position w of 1 and front_facing true, as a loose parameter gets', () => {
    const m = compiled(`"use typeshade";
interface FsIn {
  pos: builtin<"position">;
  ff: builtin<"front_facing">;
}
@fragment export function fs(i: FsIn): vec4 {
  let face = 0.;
  if (i.ff) {
    face = 1.;
  }
  return vec4(i.pos.w, face, i.pos.x, 0.);
}
`);
    const s = startDebugSessionFromConfig(m, { entry: 'fs', precision: 'f64' });
    s.continue();
    expect(s.result).toEqual([1, 1, 0, 0]);
  });
});

describe('the configuration keys the resolver accepts', () => {
  const m = compiled(`"use typeshade";
export function f(a: f32): f32 {
  return a;
}
`);
  const properties = DEBUG_LAUNCH_SCHEMA.properties as Record<string, unknown>;
  const values: Record<string, unknown> = {
    type: 'typeshade',
    request: 'launch',
    name: 'n',
    program: 'p.shade.ts',
    entry: 'f',
    stopOnEntry: true,
    maxSteps: 100,
    precision: 'f32',
    derivatives: 'zero',
    invocation: {},
    bindings: {},
    breakpoints: [],
  };

  it('has a value for each schema key and no other', () => {
    expect(Object.keys(values).sort()).toEqual(Object.keys(properties).sort());
  });

  it.each(Object.keys(properties))('accepts the schema key %s', (key) => {
    expect(() =>
      startDebugSessionFromConfig(m, { entry: 'f', [key]: values[key] } as never),
    ).not.toThrow();
  });

  it('closes the top level of the schema and leaves the invocation open', () => {
    expect(DEBUG_LAUNCH_SCHEMA.additionalProperties).toBe(false);
    const invocation = properties.invocation as Record<string, unknown>;
    expect(invocation.additionalProperties).toBe(true);
  });
});

describe('derivatives in a launch configuration', () => {
  const x: Expr = { op: 'param', type: f32T, name: 'x' };
  const m = stampSpans({
    consts: [],
    structs: [],
    bindings: [],
    funcs: [
      {
        name: 'fs',
        params: [{ name: 'x', type: f32T }],
        ret: f32T,
        body: [{ s: 'return', expr: { op: 'call', type: f32T, fn: 'dpdx', args: [x] } }],
      },
    ],
  });

  it('zero lets the run through and names the stand-in', () => {
    const s = startDebugSessionFromConfig(m, { entry: 'fs', derivatives: 'zero' });
    s.continue();
    expect(s.stubbedIntrinsics).toEqual(['dpdx']);
  });

  it('omitted, a derivative throws', () => {
    const s = startDebugSessionFromConfig(m, { entry: 'fs' });
    expect(() => s.continue()).toThrow(/dpdx/);
  });
});

describe('a module with no source spans', () => {
  const m: ModuleDecl = {
    consts: [],
    structs: [],
    bindings: [],
    funcs: [
      {
        name: 'f',
        params: [{ name: 'x', type: f32T }],
        ret: f32T,
        body: [{ s: 'return', expr: { op: 'param', type: f32T, name: 'x' } }],
      },
    ],
  };

  it('comes back finished, with the invocation applied', () => {
    const s = startDebugSessionFromConfig(m, {
      entry: 'f',
      precision: 'f64',
      invocation: { inputs: { x: 3 } },
    });
    expect(s.done).toBe(true);
    expect(s.pause).toBeUndefined();
    expect(s.result).toBe(3);
  });

  it('still reports the problems of the configuration', () => {
    expect(problems(m, { entry: 'f', invocation: { inputs: { y: 3 } } })[0]).toContain(
      '"y" is not an input this entry declares',
    );
  });
});

describe('the bindings an entry reaches', () => {
  const m = compiled(`"use typeshade";
declare const near: uniform<f32>;
declare const far: uniform<f32>;
declare const unused: storage<array<f32>, "read_write">;
function helper(a: f32): f32 {
  return a * far;
}
export function f(a: f32): f32 {
  return helper(a) + near;
}
`);
  const entry = m.funcs.find((f) => f.name === 'f')!;

  it('follows a call into a helper and leaves out what nothing reads', () => {
    const found: string[] = [];
    const out = resolveBindings(m, { near: 1, far: 2 }, structsOf(m), found, entry);
    expect(found).toEqual([]);
    expect(out).toEqual({ near: 1, far: 2 });
  });
});

describe('a texture binding', () => {
  const textureRead: Expr = { op: 'varref', type: texture2dfT as ShaderType, name: 'atlas' };
  const m: ModuleDecl = {
    consts: [],
    structs: [],
    bindings: [{ group: 0, binding: 0, name: 'atlas', space: 'uniform', type: texture2dfT }],
    funcs: [
      {
        name: 'f',
        params: [],
        ret: f32T,
        body: [{ s: 'return', expr: { op: 'call', type: f32T, fn: 'use', args: [textureRead] } }],
      },
    ],
  };

  it('is refused even when the caller supplies a value for it', () => {
    const found: string[] = [];
    const out = resolveBindings(m, { atlas: [1, 2] }, structsOf(m), found);
    expect(out).toEqual({});
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('binding "atlas"');
    expect(found[0]).toContain('a CPU run cannot supply');
  });
});
