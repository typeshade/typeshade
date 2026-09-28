// ═══ A generated function drawn as a fragment program (#349, the GLSL arm) ═══
//
// The GPU differential (`scripts/gpu-differential.ts`) draws the functions that
// `generateModule(seed, { exact: true })` builds on WebGL2, and holds what each pixel writes to
// the function run on the f32 oracle. A generated function takes values and returns one, so it
// needs an entry before it can be drawn. `drawnFunction` adds a `@fragment` entry: each pixel
// reads its own arguments from a uniform table, calls the function, and writes the bits of what
// it returns into a `vec4<u32>`, which an `RGBA32UI` target keeps as they are. The steps the entry
// adds are exact on both targets: an index from the pixel's integer position, a bit cast, a
// vector built from lanes. So a pixel that differs from the oracle differs in the function.
//
// GLSL ES 3.00 leaves some inputs undefined that WGSL settles:
//   - an integer `/` or `%` by zero (§5.9 of that spec);
//   - the least `i32` over -1, which may give the greatest (§4.1.3);
//   - a `%` with a negative operand (§5.9);
//   - a float's conversion to an integer that does not hold it, and a negative float's to `u32`
//     (§5.4.1).
// Rule 11.5 has the oracle follow WGSL there, and a GLSL driver answered otherwise with the bare
// operator: on ANGLE over SwiftShader, `7 / 0` was -7, `-7 % 3` 2 and `i32(3e9)` the least `i32`
// (#382). The GLSL writer now settles each such input the way WGSL does (Rule 11.12), and
// `taintGlslUndefined` finds the runs that reach one, so the gate can show its corpus reaches
// what the writer settles. It routes each of those operations through a helper that sets a
// private flag when its operands are ones the bare operator leaves undefined, and adds a function
// that runs a generated function and returns the flag.
//
// Test code only.

import type { CpuValue } from '../cpu-runtime.js';
import type { Expr, FuncDecl, ModuleDecl, ShaderType, Stmt } from '../ir/index.js';
import { boolT, f32T, i32T, u32T, vec4fT, vec4uT } from '../ir/index.js';
import { mapChildren, mapStmtExpr } from '../ir/visit.js';

/** A generated function with an entry that draws it. */
export interface DrawnFunction {
  /** The generated module, with the table's binding, its struct and the entry added. */
  readonly module: ModuleDecl;
  /** The `@fragment` entry. It writes the bits of the function's result at `@location(0)`. */
  readonly entry: string;
  /** The function drawn. */
  readonly fn: FuncDecl;
  /** The target's size. Pixel `(x, y)` takes argument list `y * width + x`, with `y` the
   *  fragment position's, which is also where `readPixels` returns that pixel. */
  readonly width: number;
  readonly height: number;
}

/** The entry's name, and the uniform table's binding, struct and field. */
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

/** The components of `t` that the table and the target carry, one 32-bit lane each. */
function lanesOf(t: ShaderType): number {
  if (t.kind === 'scalar' && t.scalar !== 'bool') return 1;
  if (t.kind === 'vec' && t.elem === 'f32') return t.n;
  throw new Error(`draw-harness: no ${JSON.stringify(t)} in a generated function's signature`);
}

/** An argument of type `t`, read from the table row `w`, a `vec4<u32>`. */
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

/** The bits of `r`, of type `t`, as a `vec4<u32>`, the lanes it does not fill zero. */
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

/** `fn` of `m` with a `@fragment` entry that draws it over `width` by `height` pixels, each
 *  pixel's arguments one table row per parameter, in {@link tableWords}' layout. */
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
  // The pixel's first row: its index from its integer position, times the rows it takes.
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

/** The bits of an f32, as a u32. */
function f32Bits(x: number): number {
  const v = new DataView(new ArrayBuffer(4));
  v.setFloat32(0, x, true);
  return v.getUint32(0, true);
}

/** The f32 whose bits are the u32 `w`. */
function f32Of(w: number): number {
  const v = new DataView(new ArrayBuffer(4));
  v.setUint32(0, w >>> 0, true);
  return v.getFloat32(0, true);
}

/** The words of one value of type `t` in a row: its lanes, then zeros to four. */
function rowOf(t: ShaderType, v: CpuValue): number[] {
  const n = lanesOf(t);
  const xs = (t.kind === 'vec' ? (v as number[]) : [v as number]).map((x) =>
    t.kind === 'scalar' && t.scalar !== 'f32' ? x >>> 0 : f32Bits(x),
  );
  return [...xs, ...new Array<number>(4 - n).fill(0)];
}

/** The table's words for one draw: pixel `p`'s arguments, one row of four words each, pixel
 *  after pixel. `args[p]` is pixel `p`'s argument list, as the oracle takes it. */
export function tableWords(d: DrawnFunction, args: readonly (readonly CpuValue[])[]): number[] {
  if (args.length !== d.width * d.height)
    throw new Error(
      `draw-harness: ${String(args.length)} argument lists for ${String(d.width * d.height)} pixels`,
    );
  return args.flatMap((xs) => d.fn.params.flatMap((p, i) => rowOf(p.type, xs[i]!)));
}

/** The table's value as the oracle binds it, for {@link drawnFunction}'s entry run there. */
export function tableValue(words: readonly number[]): CpuValue {
  const rows: number[][] = [];
  for (let i = 0; i < words.length; i += 4) rows.push(words.slice(i, i + 4));
  return { [ROWS]: rows } as unknown as CpuValue;
}

/** The binding the table is, by name. */
export const DRAW_TABLE = TABLE;

/** What a pixel's four words hold as the function's return type: the entry's packing undone. */
export function pixelValue(t: ShaderType, words: readonly number[]): CpuValue {
  if (t.kind === 'vec') return Array.from({ length: lanesOf(t) }, (_, i) => f32Of(words[i]!));
  if (t.kind === 'scalar' && t.scalar === 'u32') return words[0]! >>> 0;
  if (t.kind === 'scalar' && t.scalar === 'i32') return words[0]! | 0;
  return f32Of(words[0]!);
}

// ─── what GLSL ES 3.00 leaves undefined ───────────────────────────────────────────────────────

/** The private flag the helpers set. */
const FLAG = 'glslUndefined';

/** The function {@link taintGlslUndefined} adds for `fn`: it takes `fn`'s parameters, runs it,
 *  and returns 1 when the run reached an input GLSL ES 3.00 leaves undefined, else 0. */
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

/** A helper that sets the flag when `undefinedWhen` holds of its parameters, then returns
 *  `value` of them, the operation as WGSL computes it. */
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

/** One helper per operation GLSL ES 3.00 leaves undefined on some input, by the operation. */
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
  // Outside [-2^31, 2^31), or NaN, which is unequal to itself.
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
  // Negative, at or past 2^32, or NaN. A negative zero is zero, which is not negative.
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

/** `e` with every operation GLSL ES 3.00 leaves undefined on some input routed through its
 *  helper. An integer vector's division or conversion is refused rather than passed over: the
 *  generator makes none, and one would reach GLSL untainted. */
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

/** `s` with its expressions tainted, and an integer `/=` or `%=` spelled as the assignment of
 *  its helper's call. */
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

/** `m` for the CPU oracle alone: each function computes what it did, and sets the private flag
 *  when it reaches an input GLSL ES 3.00 leaves undefined; {@link taintedName} of each function
 *  returns the flag of one run. The flag starts at zero on every call from the host, as a
 *  private variable does on each invocation. */
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
