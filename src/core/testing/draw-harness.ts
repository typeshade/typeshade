// Why: GLSL ES 3.00 leaves undefined what WGSL settles: an integer `/` or `%` by zero (§5.9),
// the least `i32` over -1 (§4.1.3), a `%` with a negative operand (§5.9), and a float's conversion
// to an integer that does not hold it (§5.4.1). Rule 11.5 has the oracle follow WGSL. On ANGLE over
// SwiftShader the bare operators answered otherwise (#382).

import type { CpuValue } from '../cpu-runtime.js';
import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt } from '../ir/index.js';
import { boolT, f32T, i32T, u32T, vec4fT, vec4uT } from '../ir/index.js';
import { mapChildren, mapStmtExpr } from '../ir/visit.js';

export interface DrawnFunction {
  readonly module: ModuleDecl;
  readonly entry: string;
  readonly fn: FuncDecl;
  readonly width: number;
  readonly height: number;
}

const ENTRY = 'drawFn';
const TABLE = 'drawTable';
const TABLE_STRUCT = 'DrawTable';
const ROWS = 'rows';

const lit = (value: number, type: ShaderType): Expr => ({ op: 'lit', type, value });
const call = (fn: string, type: ShaderType, args: readonly Expr[]): Expr => ({
  op: 'call',
  type,
  fn,
  args: [...args],
});
const lane = (v: Expr, i: number, type: ShaderType): Expr => ({
  op: 'member',
  type,
  base: v,
  field: 'xyzw'[i]!,
});

function lanesOf(t: ShaderType): number {
  if (t.kind === 'scalar' && t.scalar !== 'bool') return 1;
  if (t.kind === 'vec' && t.elem === 'f32') return t.n;
  throw new Error(`draw-harness: no ${JSON.stringify(t)} in a generated function's signature`);
}

function unpackArg(t: ShaderType, w: Expr): Expr {
  if (t.kind === 'vec') {
    const n = lanesOf(t);
    return {
      op: 'construct',
      type: t,
      args: Array.from({ length: n }, (_, i) => call('bitcastF32', f32T, [lane(w, i, u32T)])),
    };
  }
  const x = lane(w, 0, u32T);
  if (t.kind === 'scalar' && t.scalar === 'u32') return x;
  if (t.kind === 'scalar' && t.scalar === 'i32') return call('i32', i32T, [x]);
  return call('bitcastF32', f32T, [x]);
}

function packResult(t: ShaderType, r: Expr): Expr {
  const n = lanesOf(t);
  const bits = (x: Expr, s: ShaderType): Expr =>
    s.kind === 'scalar' && s.scalar === 'u32'
      ? x
      : s.kind === 'scalar' && s.scalar === 'i32'
        ? call('u32', u32T, [x])
        : call('bitcastU32', u32T, [x]);
  const lanes = t.kind === 'vec' ? Array.from({ length: n }, (_, i) => lane(r, i, f32T)) : [r];
  return {
    op: 'construct',
    type: vec4uT,
    args: [
      ...lanes.map((x) => bits(x, t.kind === 'vec' ? f32T : t)),
      ...Array.from({ length: 4 - n }, () => lit(0, u32T)),
    ],
  };
}

export function drawnFunction(
  m: ModuleDecl,
  fn: string,
  width: number,
  height: number,
): DrawnFunction {
  const f = m.funcs.find((x) => x.name === fn);
  if (f === undefined) throw new Error(`draw-harness: no function "${fn}"`);
  const slots = f.params.length;
  const rowsT: ShaderType = { kind: 'array', elem: vec4uT, size: width * height * slots };
  const tableT: ShaderType = { kind: 'struct', name: TABLE_STRUCT };
  const pos: Expr = { op: 'param', type: vec4fT, name: 'pos' };
  const at: Expr = { op: 'varref', type: u32T, name: 'at' };
  const row = (i: number): Expr => ({
    op: 'index',
    type: vec4uT,
    base: {
      op: 'member',
      type: rowsT,
      base: { op: 'varref', type: tableT, name: TABLE },
      field: ROWS,
    },
    idx: i === 0 ? at : { op: 'binop', type: u32T, bop: '+', a: at, b: lit(i, u32T) },
  });
  const index: Expr = {
    op: 'binop',
    type: u32T,
    bop: '*',
    a: {
      op: 'binop',
      type: u32T,
      bop: '+',
      a: call('u32', u32T, [lane(pos, 0, f32T)]),
      b: {
        op: 'binop',
        type: u32T,
        bop: '*',
        a: call('u32', u32T, [lane(pos, 1, f32T)]),
        b: lit(width, u32T),
      },
    },
    b: lit(slots, u32T),
  };
  const result: Expr = { op: 'varref', type: f.ret, name: 'r' };
  const entry: FuncDecl = {
    name: ENTRY,
    params: [{ name: 'pos', type: vec4fT, builtin: 'position' }],
    ret: vec4uT,
    attrs: ['@fragment'],
    stage: 'fragment',
    retAttr: '@location(0)',
    body: [
      { s: 'let', name: 'at', expr: index },
      {
        s: 'let',
        name: 'r',
        expr: call(
          fn,
          f.ret,
          f.params.map((p, i) => unpackArg(p.type, row(i))),
        ),
      },
      { s: 'return', expr: packResult(f.ret, result) },
    ],
  };
  return {
    module: {
      ...m,
      structs: [...m.structs, { name: TABLE_STRUCT, fields: [{ name: ROWS, type: rowsT }] }],
      bindings: [
        ...m.bindings,
        { group: 0, binding: m.bindings.length, name: TABLE, space: 'uniform', type: tableT },
      ],
      funcs: [...m.funcs, entry],
    },
    entry: ENTRY,
    fn: f,
    width,
    height,
  };
}

function f32Bits(x: number): number {
  const v = new DataView(new ArrayBuffer(4));
  v.setFloat32(0, x, true);
  return v.getUint32(0, true);
}

function f32Of(w: number): number {
  const v = new DataView(new ArrayBuffer(4));
  v.setUint32(0, w >>> 0, true);
  return v.getFloat32(0, true);
}

function rowOf(t: ShaderType, v: CpuValue): number[] {
  const n = lanesOf(t);
  const xs = (t.kind === 'vec' ? (v as number[]) : [v as number]).map((x) =>
    t.kind === 'scalar' && t.scalar !== 'f32' ? x >>> 0 : f32Bits(x),
  );
  return [...xs, ...new Array<number>(4 - n).fill(0)];
}

export function tableWords(d: DrawnFunction, args: readonly (readonly CpuValue[])[]): number[] {
  if (args.length !== d.width * d.height)
    throw new Error(
      `draw-harness: ${String(args.length)} argument lists for ${String(d.width * d.height)} pixels`,
    );
  return args.flatMap((xs) => d.fn.params.flatMap((p, i) => rowOf(p.type, xs[i]!)));
}

export function tableValue(words: readonly number[]): CpuValue {
  const rows: number[][] = [];
  for (let i = 0; i < words.length; i += 4) rows.push(words.slice(i, i + 4));
  return { [ROWS]: rows } as unknown as CpuValue;
}

export const DRAW_TABLE = TABLE;

export function pixelValue(t: ShaderType, words: readonly number[]): CpuValue {
  if (t.kind === 'vec') return Array.from({ length: lanesOf(t) }, (_, i) => f32Of(words[i]!));
  if (t.kind === 'scalar' && t.scalar === 'u32') return words[0]! >>> 0;
  if (t.kind === 'scalar' && t.scalar === 'i32') return words[0]! | 0;
  return f32Of(words[0]!);
}

const FLAG = 'glslUndefined';

export const taintedName = (fn: string): string => `${fn}_glslUndefined`;

const flagRef: Expr = { op: 'varref', type: u32T, name: FLAG };
const setFlag: Stmt = { s: 'assign', target: flagRef, expr: lit(1, u32T) };
const cmp = (cop: '==' | '<' | '>=' | '!=', a: Expr, b: Expr): Expr => ({
  op: 'compare',
  type: boolT,
  cop,
  a,
  b,
});
const or = (a: Expr, b: Expr): Expr => ({ op: 'logical', type: boolT, lop: '||', a, b });
const and = (a: Expr, b: Expr): Expr => ({ op: 'logical', type: boolT, lop: '&&', a, b });

function helper(
  name: string,
  params: readonly { name: string; type: ShaderType }[],
  ret: ShaderType,
  undefinedWhen: (ps: readonly Expr[]) => Expr,
  value: (ps: readonly Expr[]) => Expr,
): FuncDecl {
  const ps = params.map((p): Expr => ({ op: 'param', type: p.type, name: p.name }));
  return {
    name,
    params: params.map((p) => ({ name: p.name, type: p.type })),
    ret,
    attrs: [],
    body: [
      { s: 'if', arms: [{ cond: undefinedWhen(ps), body: [setFlag] }] },
      { s: 'return', expr: value(ps) },
    ],
  };
}

const binop = (bop: '/' | '%', type: ShaderType, a: Expr, b: Expr): Expr => ({
  op: 'binop',
  type,
  bop,
  a,
  b,
});
const I32_MIN = -2147483648;
const intPair = (t: ShaderType) => [
  { name: 'a', type: t },
  { name: 'b', type: t },
];

const HELPERS: Readonly<Record<string, FuncDecl>> = {
  'i32 /': helper(
    'glslDivI32',
    intPair(i32T),
    i32T,
    ([a, b]) =>
      or(
        cmp('==', b!, lit(0, i32T)),
        and(cmp('==', a!, lit(I32_MIN, i32T)), cmp('==', b!, lit(-1, i32T))),
      ),
    ([a, b]) => binop('/', i32T, a!, b!),
  ),
  'i32 %': helper(
    'glslRemI32',
    intPair(i32T),
    i32T,
    ([a, b]) =>
      or(cmp('==', b!, lit(0, i32T)), or(cmp('<', a!, lit(0, i32T)), cmp('<', b!, lit(0, i32T)))),
    ([a, b]) => binop('%', i32T, a!, b!),
  ),
  'u32 /': helper(
    'glslDivU32',
    intPair(u32T),
    u32T,
    ([, b]) => cmp('==', b!, lit(0, u32T)),
    ([a, b]) => binop('/', u32T, a!, b!),
  ),
  'u32 %': helper(
    'glslRemU32',
    intPair(u32T),
    u32T,
    ([, b]) => cmp('==', b!, lit(0, u32T)),
    ([a, b]) => binop('%', u32T, a!, b!),
  ),
  'i32 of f32': helper(
    'glslToI32',
    [{ name: 'x', type: f32T }],
    i32T,
    ([x]) =>
      or(
        cmp('!=', x!, x!),
        or(cmp('<', x!, lit(-2147483648, f32T)), cmp('>=', x!, lit(2147483648, f32T))),
      ),
    ([x]) => call('i32', i32T, [x!]),
  ),
  'u32 of f32': helper(
    'glslToU32',
    [{ name: 'x', type: f32T }],
    u32T,
    ([x]) =>
      or(cmp('!=', x!, x!), or(cmp('<', x!, lit(0, f32T)), cmp('>=', x!, lit(4294967296, f32T)))),
    ([x]) => call('u32', u32T, [x!]),
  ),
};

const intScalar = (t: ShaderType): 'i32' | 'u32' | undefined =>
  t.kind === 'scalar' && (t.scalar === 'i32' || t.scalar === 'u32') ? t.scalar : undefined;
const isIntVec = (t: ShaderType): boolean => t.kind === 'vec' && t.elem !== 'f32';

function taintExpr(e: Expr): Expr {
  const x = mapChildren(e, taintExpr);
  if (x.op === 'binop' && (x.bop === '/' || x.bop === '%')) {
    const s = intScalar(x.type);
    if (s !== undefined) return call(HELPERS[`${s} ${x.bop}`]!.name, x.type, [x.a, x.b]);
    if (isIntVec(x.type))
      throw new Error(`draw-harness: an integer vector ${x.bop} is not tainted`);
  }
  if (x.op === 'call' && (x.fn === 'i32' || x.fn === 'u32') && x.args.length === 1) {
    const from = x.args[0]!.type;
    if (from.kind === 'scalar' && from.scalar === 'f32')
      return call(HELPERS[`${x.fn} of f32`]!.name, x.type, x.args);
  }
  if (x.op === 'construct' && isIntVec(x.type) && x.args.some((a) => a.type.kind === 'vec'))
    throw new Error('draw-harness: an integer vector conversion is not tainted');
  return x;
}

function taintStmt(s: Stmt): Stmt {
  if (s.s === 'assignOp' && (s.bop === '/' || s.bop === '%')) {
    const t = intScalar(s.target.type);
    if (t !== undefined)
      return {
        s: 'assign',
        target: s.target,
        expr: call(HELPERS[`${t} ${s.bop}`]!.name, s.target.type, [s.target, taintExpr(s.expr)]),
      };
  }
  return mapStmtExpr(s, taintExpr, taintStmt);
}

export function taintGlslUndefined(m: ModuleDecl): ModuleDecl {
  const funcs = m.funcs.map((f) => ({ ...f, body: f.body.map(taintStmt) }));
  const wrappers = m.funcs
    .filter((f) => f.ret.kind !== 'void' && (f.attrs ?? []).length === 0 && f.stage === undefined)
    .map((f): FuncDecl => ({
      name: taintedName(f.name),
      params: f.params.map((p) => ({ name: p.name, type: p.type })),
      ret: u32T,
      attrs: [],
      body: [
        {
          s: 'let',
          name: 'r',
          expr: call(
            f.name,
            f.ret,
            f.params.map((p): Expr => ({ op: 'param', type: p.type, name: p.name })),
          ),
        },
        { s: 'return', expr: flagRef },
      ],
    }));
  return {
    ...m,
    vars: [...(m.vars ?? []), { name: FLAG, space: 'private', type: u32T, init: lit(0, u32T) }],
    funcs: [...Object.values(HELPERS), ...funcs, ...wrappers],
  };
}
