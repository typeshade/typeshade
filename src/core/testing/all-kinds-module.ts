// A module with one declaration of each kind, named by the caller (Proposal 0070, section 8.1).
//
// The module is built from IR literals, not from the front end and not from the spelling pass, so
// any string is a valid name: a test can name a declaration `class` or `shared` and reach the
// writers that a TypeScript source cannot reach before step 3 (section 8.2).
//
// `compute`: a storage binding of an array of struct, a workgroup variable, an override that sizes
// the workgroup, a constant, a helper called through its declaration, and an entry that reads each.
// `graphics`: a uniform binding of a struct, a texture and its sampler, an override, a constant, a
// helper, a vertex entry that returns the struct, and a fragment entry that reads each.

import type {
  ConstDecl,
  Expr,
  FuncDecl,
  ModuleDecl,
  OverrideDecl,
  StructDecl,
} from '../ir/index.js';
import { f32T, samplerT, texture2dfT, u32T, vec3fT, vec4fT } from '../ir/index.js';

/** The authored name of each declaration kind. A kind that is not given keeps its default. */
export interface AllKindsNames {
  readonly const?: string;
  readonly var?: string;
  readonly helper?: string;
  readonly entry?: string;
  /** The graphics shape's fragment entry. */
  readonly fragment?: string;
  readonly binding?: string;
  readonly texture?: string;
  readonly override?: string;
  readonly struct?: string;
  readonly field?: string;
  readonly param?: string;
}

const DEFAULTS: Required<AllKindsNames> = {
  const: 'k',
  var: 'v',
  helper: 'h',
  entry: 'e',
  fragment: 'fe',
  binding: 'b',
  texture: 'tex',
  override: 'o',
  struct: 'S',
  field: 'f',
  param: 'p',
};

const lit = (value: number): Expr => ({ op: 'lit', type: f32T, value });

/** A module of the named shape, with every kind of `names` (defaults where unnamed). */
export function allKindsModule(
  names: AllKindsNames = {},
  shape: 'compute' | 'graphics' = 'compute',
): ModuleDecl {
  const n = { ...DEFAULTS, ...names };
  const structT = { kind: 'struct', name: n.struct } as const;
  const kConst: ConstDecl = { name: n.const, type: f32T, wgslValue: 2, cpuValue: 2 };
  const oOverride: OverrideDecl = { name: n.override, type: u32T, default: 8 };
  const sampler = `${n.texture}Sampler`;

  if (shape === 'compute') {
    return computeModule(n, structT, kConst, oOverride);
  }
  return graphicsModule(n, structT, kConst, oOverride, sampler);
}

type Names = Required<AllKindsNames>;
type StructT = { readonly kind: 'struct'; readonly name: string };

function computeModule(
  n: Names,
  structT: StructT,
  kConst: ConstDecl,
  oOverride: OverrideDecl,
): ModuleDecl {
  const helper: FuncDecl = {
    name: n.helper,
    params: [{ name: n.param, type: f32T }],
    ret: f32T,
    body: [{ s: 'return', expr: { op: 'param', type: f32T, name: n.param } }],
  };
  const callHelper = (arg: Expr): Expr => ({
    op: 'call',
    type: f32T,
    fn: n.helper,
    args: [arg],
    declRef: helper,
  });
  const bindingRef: Expr = {
    op: 'varref',
    type: { kind: 'array', elem: structT },
    name: n.binding,
  };
  const element: Expr = {
    op: 'index',
    type: structT,
    base: bindingRef,
    idx: { op: 'param', type: u32T, name: n.param },
  };
  const entry: FuncDecl = {
    name: n.entry,
    params: [{ name: n.param, type: u32T, builtin: 'global_invocation_id' }],
    ret: { kind: 'void' },
    attrs: ['@compute', `@workgroup_size(${n.const}, ${n.override})`],
    workgroupSizeOverrides: [undefined, n.override, undefined] as [
      string | undefined,
      string | undefined,
      string | undefined,
    ],
    body: [
      { s: 'let', name: 'x', expr: callHelper(lit(1)) },
      {
        s: 'assign',
        target: { op: 'varref', type: f32T, name: n.var },
        expr: { op: 'constref', type: f32T, name: n.const },
      },
      {
        s: 'assign',
        target: { op: 'member', type: f32T, base: element, field: n.field },
        expr: {
          op: 'overrideref',
          type: u32T,
          name: n.override,
        },
      },
      {
        s: 'call',
        expr: { op: 'call', type: f32T, fn: 'fract', args: [lit(0.5)] },
      },
    ],
  };
  return {
    consts: [kConst],
    overrides: [oOverride],
    vars: [{ name: n.var, space: 'workgroup', type: f32T }],
    structs: [{ name: n.struct, fields: [{ name: n.field, type: f32T }] }] satisfies StructDecl[],
    bindings: [
      {
        group: 0,
        binding: 0,
        name: n.binding,
        space: 'storage',
        access: 'read_write',
        type: { kind: 'array', elem: structT },
      },
    ],
    funcs: [helper, entry],
  };
}

function graphicsModule(
  n: Names,
  structT: StructT,
  kConst: ConstDecl,
  oOverride: OverrideDecl,
  sampler: string,
): ModuleDecl {
  const helper: FuncDecl = {
    name: n.helper,
    params: [{ name: n.param, type: f32T }],
    ret: f32T,
    body: [{ s: 'return', expr: { op: 'param', type: f32T, name: n.param } }],
  };
  const callHelper = (arg: Expr): Expr => ({
    op: 'call',
    type: f32T,
    fn: n.helper,
    args: [arg],
    declRef: helper,
  });
  const uniform: Expr = { op: 'varref', type: structT, name: n.binding };
  const vertex: FuncDecl = {
    name: n.entry,
    params: [{ name: n.param, type: u32T, builtin: 'vertex_index' }],
    ret: structT,
    attrs: ['@vertex'],
    body: [
      {
        s: 'return',
        expr: {
          op: 'construct',
          type: structT,
          args: [lit(0)],
        },
      },
    ],
  };
  const fragment: FuncDecl = {
    name: n.fragment,
    params: [{ name: n.param, type: structT }],
    ret: vec4fT,
    retAttr: '@location(0)',
    attrs: ['@fragment'],
    body: [
      {
        s: 'let',
        name: 'x',
        expr: callHelper({ op: 'member', type: f32T, base: uniform, field: n.field }),
      },
      {
        s: 'let',
        name: 'c',
        expr: {
          op: 'call',
          type: vec4fT,
          fn: 'textureSample',
          args: [
            { op: 'varref', type: texture2dfT, name: n.texture },
            { op: 'varref', type: samplerT, name: sampler },
            { op: 'construct', type: vec3fT, args: [lit(0), lit(0), lit(0)] },
          ],
        },
      },
      {
        s: 'return',
        expr: {
          op: 'construct',
          type: vec4fT,
          args: [
            { op: 'constref', type: f32T, name: n.const },
            { op: 'overrideref', type: f32T, name: n.override },
            {
              op: 'member',
              type: f32T,
              base: { op: 'param', type: structT, name: n.param },
              field: n.field,
            },
            lit(1),
          ],
        },
      },
    ],
  };
  return {
    consts: [kConst],
    overrides: [{ ...oOverride, type: f32T, default: 1 }],
    // The one struct is the vertex output, the fragment input and the uniform: its field is a varying.
    structs: [{ name: n.struct, fields: [{ name: n.field, type: f32T, location: 0 }] }],
    bindings: [
      {
        group: 0,
        binding: 0,
        name: n.binding,
        space: 'uniform',
        type: structT,
      },
      { group: 0, binding: 1, name: n.texture, space: 'uniform', type: texture2dfT },
      { group: 0, binding: 2, name: sampler, space: 'uniform', type: samplerT },
    ],
    funcs: [helper, vertex, fragment],
  };
}
