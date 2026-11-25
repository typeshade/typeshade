import type {
  Expr,
  Stmt,
  ModuleDecl,
  FuncDecl,
  ShaderType,
  BinOp,
  CmpOp,
  StructDecl,
} from '../ir/index.js';
import { f32T, i32T, u32T, boolT, vec2fT, vec3fT, vec4fT, voidT } from '../ir/index.js';
import { accuracyOf } from '../passes/determinism.js';
import { guardKernelBody } from '../passes/kernel-stores.js';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GenOptions {
  readonly funcs?: number;
  readonly stmts?: number;
  readonly depth?: number;
  readonly nest?: number;
  readonly types?: readonly ShaderType[];
  readonly exact?: boolean;
}

const SCALARS: readonly ShaderType[] = [f32T, i32T, u32T];
const DEFAULT_TYPES: readonly ShaderType[] = [...SCALARS, vec2fT, vec3fT, vec4fT];

const isF32 = (t: ShaderType): boolean =>
  (t.kind === 'scalar' && t.scalar === 'f32') || (t.kind === 'vec' && t.elem === 'f32');
const isInt = (
  t: ShaderType,
): t is Extract<ShaderType, { kind: 'scalar' }> & { scalar: 'i32' | 'u32' } =>
  t.kind === 'scalar' && (t.scalar === 'i32' || t.scalar === 'u32');
const isVec = (t: ShaderType): boolean => t.kind === 'vec';
const arity = (t: ShaderType): number => (t.kind === 'vec' ? t.n : 1);

const F32_UNARY = [
  'sin',
  'cos',
  'tan',
  'atan',
  'sinh',
  'tanh',
  'exp',
  'log2',
  'sqrt',
  'exp2',
  'inverseSqrt',
  'trunc',
  'round',
  'floor',
  'ceil',
  'abs',
  'sign',
  'fract',
  'radians',
  'degrees',
] as const;
const F32_BINARY = ['atan2', 'pow', 'step', 'min', 'max'] as const;
const F32_TERNARY = ['mix', 'clamp', 'smoothstep'] as const;
const INT_UNARY = ['abs', 'sign'] as const;
const INT_BINARY = ['min', 'max'] as const;
const VEC_REDUCE = ['length'] as const;

const F32_BINOPS: readonly BinOp[] = ['+', '-', '*', '/'];

const F32_LITERALS = [0, 1, -1, 0.5, -0.25, 2, 3.5, 1e-3, 1e3, Math.PI];
const EXACT_F32_LITERALS = [0, 1, -1, 0.5, -0.25, 2, 3.5, 0.125, 1e3, -8];

const onlyExact = <T extends string>(xs: readonly T[]): readonly T[] =>
  xs.filter((x) => accuracyOf(x)?.kind === 'exact');
const EXACT = {
  unary: onlyExact(F32_UNARY),
  binary: onlyExact(F32_BINARY),
  ternary: onlyExact(F32_TERNARY),
  binops: onlyExact(F32_BINOPS),
};
const INT_BINOPS: readonly BinOp[] = ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>'];
const CMPS: readonly CmpOp[] = ['<', '<=', '>', '>=', '==', '!='];

export interface Corpus {
  readonly module: ModuleDecl;
  readonly seed: number;
  readonly features: Readonly<Record<string, number>>;
}

class Gen {
  private n = 0;
  readonly features: Record<string, number> = {};

  constructor(
    private readonly rnd: () => number,
    private readonly exact = false,
  ) {}

  private mark(f: string): void {
    this.features[f] = (this.features[f] ?? 0) + 1;
  }
  private pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rnd() * xs.length)]!;
  }
  private chance(p: number): boolean {
    return this.rnd() < p;
  }
  private fresh(): string {
    return `g${this.n++}`;
  }
  private resetNames(): void {
    this.n = 0;
  }

  private literal(t: ShaderType): Expr {
    if (t.kind === 'scalar' && t.scalar === 'bool')
      return { op: 'lit', type: t, value: this.chance(0.5) };
    if (isInt(t)) {
      const pool = [0, 0, 1, 2, 3, 7, -1, -5, 255, 65535];
      const v = this.pick(pool);
      return { op: 'lit', type: t, value: t.scalar === 'u32' ? v >>> 0 : v | 0 };
    }
    const v = this.pick(this.exact ? EXACT_F32_LITERALS : F32_LITERALS);
    if (isVec(t))
      return {
        op: 'construct',
        type: t,
        args: Array.from({ length: arity(t) }, () => this.literal(f32T)),
      };
    return { op: 'lit', type: t, value: v };
  }

  private leaf(
    t: ShaderType,
    scope: ReadonlyArray<{ name: string; type: ShaderType; op: 'param' | 'varref' }>,
  ): Expr {
    const same = scope.filter((v) => typeKey(v.type) === typeKey(t));
    if (same.length > 0 && this.chance(0.7)) {
      const v = this.pick(same);
      return { op: v.op, type: v.type, name: v.name } as Expr;
    }
    return this.literal(t);
  }

  private boolExpr(depth: number, scope: Scope, fns: readonly FuncSig[]): Expr {
    const t = this.pick(SCALARS);
    const a = this.expr(t, depth - 1, scope, fns);
    const b = this.expr(t, depth - 1, scope, fns);
    const cmp: Expr = { op: 'compare', type: boolT, cop: this.pick(CMPS), a, b };
    if (depth > 1 && this.chance(0.3)) {
      this.mark('logical');
      return {
        op: 'logical',
        type: boolT,
        lop: this.chance(0.5) ? '&&' : '||',
        a: cmp,
        b: this.boolExpr(depth - 1, scope, fns),
      };
    }
    return cmp;
  }

  expr(t: ShaderType, depth: number, scope: Scope, fns: readonly FuncSig[]): Expr {
    if (t.kind === 'scalar' && t.scalar === 'bool')
      return this.boolExpr(Math.max(depth, 1), scope, fns);
    if (depth <= 0) return this.leaf(t, scope);

    const arms: Array<() => Expr> = [];

    arms.push(() => {
      const bop = this.pick(isInt(t) ? INT_BINOPS : this.exact ? EXACT.binops : F32_BINOPS);
      if (isInt(t) && (bop === '/' || bop === '%')) this.mark(`int${bop}`);
      if (isInt(t) && (bop === '<<' || bop === '>>')) this.mark('intShift');
      else if (isInt(t)) this.mark('intArith');
      const b =
        bop === '<<' || bop === '>>'
          ? ({ op: 'lit', type: u32T, value: Math.floor(this.rnd() * 34) } as Expr)
          : this.expr(t, depth - 1, scope, fns);
      return { op: 'binop', type: t, bop, a: this.expr(t, depth - 1, scope, fns), b };
    });

    arms.push(() => {
      this.mark('select');
      return {
        op: 'select',
        type: t,
        cond: this.boolExpr(depth - 1, scope, fns),
        ifTrue: this.expr(t, depth - 1, scope, fns),
        ifFalse: this.expr(t, depth - 1, scope, fns),
      };
    });

    if (isF32(t)) {
      arms.push(() => {
        this.mark('builtin');
        const k = this.rnd();
        const [fn, n] =
          k < 0.5
            ? [this.pick(this.exact ? EXACT.unary : F32_UNARY), 1]
            : k < 0.8
              ? [this.pick(this.exact ? EXACT.binary : F32_BINARY), 2]
              : [this.pick(this.exact ? EXACT.ternary : F32_TERNARY), 3];
        const args = Array.from({ length: n as number }, () => this.expr(t, depth - 1, scope, fns));
        if (this.exact && fn === 'clamp') {
          const [lo, hi] = [args[1]!, args[2]!];
          args[1] = { op: 'call', type: t, fn: 'min', args: [lo, hi] };
          args[2] = { op: 'call', type: t, fn: 'max', args: [lo, hi] };
        }
        return { op: 'call', type: t, fn, args };
      });
    }
    if (isInt(t)) {
      arms.push(() => {
        this.mark('intBuiltin');
        const unary = t.scalar === 'i32';
        const [fn, n] =
          unary && this.chance(0.4) ? [this.pick(INT_UNARY), 1] : [this.pick(INT_BINARY), 2];
        return {
          op: 'call',
          type: t,
          fn,
          args: Array.from({ length: n as number }, () => this.expr(t, depth - 1, scope, fns)),
        };
      });
      arms.push(() => {
        this.mark('convert');
        const from = this.chance(0.5) ? f32T : t.scalar === 'i32' ? u32T : i32T;
        return {
          op: 'call',
          type: t,
          fn: t.scalar === 'i32' ? 'i32' : 'u32',
          args: [this.expr(from, depth - 1, scope, fns)],
        };
      });
    }
    if (isVec(t)) {
      arms.push(() => {
        this.mark('construct');
        return {
          op: 'construct',
          type: t,
          args: Array.from({ length: arity(t) }, () => this.expr(f32T, depth - 1, scope, fns)),
        };
      });
    }
    if (t.kind === 'scalar' && t.scalar === 'f32') {
      arms.push(() => {
        this.mark('swizzle');
        const src = this.pick([vec2fT, vec3fT, vec4fT] as const);
        const field = this.pick(['x', 'y', 'z', 'w'].slice(0, arity(src)));
        return { op: 'member', type: f32T, base: this.expr(src, depth - 1, scope, fns), field };
      });
      if (!this.exact)
        arms.push(() => {
          this.mark('reduce');
          const src = this.pick([vec2fT, vec3fT, vec4fT] as const);
          return {
            op: 'call',
            type: f32T,
            fn: this.pick(VEC_REDUCE),
            args: [this.expr(src, depth - 1, scope, fns)],
          };
        });
    }

    const callable = fns.filter((f) => typeKey(f.ret) === typeKey(t));
    if (callable.length > 0) {
      arms.push(() => {
        this.mark('callFn');
        const f = this.pick(callable);
        return {
          op: 'call',
          type: t,
          fn: f.name,
          args: f.params.map((p) => this.expr(p, depth - 1, scope, fns)),
        };
      });
    }

    return this.pick(arms)();
  }

  private stmts(
    count: number,
    depth: number,
    scope: Scope,
    fns: readonly FuncSig[],
    inLoop: boolean,
    nest: number,
  ): Stmt[] {
    const out: Stmt[] = [];
    for (let i = 0; i < count; i++) {
      const k = nest <= 0 ? this.rnd() * 0.5 : this.rnd();
      if (k < 0.3) {
        const t = this.pick(DEFAULT_TYPES);
        const name = this.fresh();
        out.push({ s: 'let', name, expr: this.expr(t, depth, scope, fns) });
        scope.push({ name, type: t, op: 'varref' });
        this.mark('let');
      } else if (k < 0.5) {
        const t = this.pick(DEFAULT_TYPES);
        const name = this.fresh();
        out.push({ s: 'var', name, type: t, init: this.expr(t, depth, scope, fns) });
        scope.push({ name, type: t, op: 'varref' });
        this.mark('var');
        if (this.chance(0.6)) {
          const target: Expr = { op: 'varref', type: t, name };
          if (this.chance(0.5)) {
            out.push({ s: 'assign', target, expr: this.expr(t, depth, scope, fns) });
            this.mark('assign');
          } else {
            const bop = this.pick(
              isInt(t)
                ? INT_BINOPS.filter((b) => b !== '<<' && b !== '>>')
                : this.exact
                  ? EXACT.binops
                  : F32_BINOPS,
            );
            out.push({ s: 'assignOp', target, bop, expr: this.expr(t, depth, scope, fns) });
            this.mark('assignOp');
          }
        }
      } else if (k < 0.68) {
        this.mark('if');
        out.push({
          s: 'if',
          arms: [
            {
              cond: this.boolExpr(depth, scope, fns),
              body: this.stmts(2, depth - 1, [...scope], fns, inLoop, nest - 1),
            },
          ],
          elseBody: this.chance(0.6)
            ? this.stmts(2, depth - 1, [...scope], fns, inLoop, nest - 1)
            : undefined,
        });
      } else if (k < 0.85) {
        this.mark('for');
        const iName = this.fresh();
        const trips = 3 + Math.floor(this.rnd() * 3);
        const iRef: Expr = { op: 'varref', type: i32T, name: iName };
        const inner: Scope = [...scope, { name: iName, type: i32T, op: 'varref' }];
        let body: Stmt[];
        if (nest > 0 && this.chance(0.5)) {
          this.mark('accumulatorLoop');
          const accType = this.pick(SCALARS);
          const accName = this.fresh();
          out.push({
            s: 'var',
            name: accName,
            type: accType,
            init: this.expr(accType, 1, scope, fns),
          });
          scope.push({ name: accName, type: accType, op: 'varref' });
          inner.push({ name: accName, type: accType, op: 'varref' });
          const acc: Expr = { op: 'varref', type: accType, name: accName };
          const mkArm = (tag: 'continue' | 'break' | 'plain'): Stmt[] => {
            const arm: Stmt[] = [
              { s: 'assignOp', target: acc, bop: '+', expr: this.expr(accType, 1, inner, fns) },
            ];
            if (tag !== 'plain') {
              this.mark(tag === 'continue' ? 'switchContinue' : 'switchBreak');
              arm.push({ s: tag });
            }
            return arm;
          };
          body = [
            {
              s: 'switch',
              scrut: iRef,
              cases: [
                { values: [0], body: mkArm('continue') },
                { values: [1], body: mkArm('break') },
                { values: [2], body: mkArm('plain') },
              ],
              defaultBody: mkArm('continue'),
            },
            { s: 'assignOp', target: acc, bop: '*', expr: this.expr(accType, 1, inner, fns) },
          ];
          this.mark('switch');
        } else {
          body = this.stmts(2, depth - 1, inner, fns, true, nest - 1);
        }
        out.push({
          s: 'for',
          init: { s: 'var', name: iName, type: i32T, init: { op: 'lit', type: i32T, value: 0 } },
          cond: {
            op: 'compare',
            type: boolT,
            cop: '<',
            a: iRef,
            b: { op: 'lit', type: i32T, value: trips },
          },
          update: {
            s: 'assign',
            target: iRef,
            expr: {
              op: 'binop',
              type: i32T,
              bop: '+',
              a: iRef,
              b: { op: 'lit', type: i32T, value: 1 },
            },
          },
          body,
        });
      } else if (inLoop && k < 0.93) {
        this.mark('switch');
        const scrut: Expr = {
          op: 'call',
          type: i32T,
          fn: 'i32',
          args: [this.expr(f32T, Math.max(depth - 1, 0), scope, fns)],
        };
        const mkArm = (): Stmt[] => {
          const body = this.stmts(1, depth - 1, [...scope], fns, true, nest - 1);
          const j = this.rnd();
          if (j < 0.4) {
            this.mark('switchContinue');
            body.push({ s: 'continue' });
          } else if (j < 0.7) {
            this.mark('switchBreak');
            body.push({ s: 'break' });
          }
          return body;
        };
        out.push({
          s: 'switch',
          scrut,
          cases: [0, 1, 2].map((value) => ({ values: [value], body: mkArm() })),
          defaultBody: mkArm(),
        });
      } else if (inLoop) {
        this.mark(this.chance(0.5) ? 'break' : 'continue');
        out.push(this.chance(0.5) ? { s: 'break' } : { s: 'continue' });
      }
    }
    return out;
  }

  func(
    name: string,
    ret: ShaderType,
    paramTypes: readonly ShaderType[],
    opts: Required<Pick<GenOptions, 'stmts' | 'depth' | 'nest'>>,
    fns: readonly FuncSig[],
  ): FuncDecl {
    this.resetNames();
    const params = paramTypes.map((type) => ({ name: this.fresh(), type }));
    const scope: Scope = params.map((p) => ({ name: p.name, type: p.type, op: 'param' as const }));
    const body = this.stmts(opts.stmts, opts.depth, scope, fns, false, opts.nest);
    body.push({ s: 'return', expr: this.expr(ret, opts.depth, scope, fns) });
    return { name, params, ret, body, attrs: [] };
  }

  kernel(
    name: string,
    sig: KernelSig,
    structs: ReadonlyMap<string, StructDecl>,
    opts: Required<Pick<KernelGenOptions, 'loops' | 'stmts' | 'depth'>> &
      Pick<KernelGenOptions, 'stores' | 'storeLength'> & { readonly deviceRange?: KernelArray },
    fns: readonly FuncSig[],
    map?: MapSpec,
  ): FuncDecl {
    this.resetNames();
    this.mark('kernel');
    if (opts.loops === 0) this.mark('noLoop');
    if (opts.loops > 1 && sig.arrays.some((a) => a.role === 'push')) this.mark('pushTwoLoops');
    const params: FuncDecl['params'] = [
      ...sig.arrays.map((a) => ({ name: a.name, type: arrayOf(a), mode: 'inout' as const })),
      ...sig.scalars.map((s) => ({ name: s.name, type: s.type })),
    ];
    const scope: Scope = sig.scalars.map((s) => ({
      name: s.name,
      type: s.type,
      op: 'param' as const,
    }));
    const body: Stmt[] = [];
    const pushing = sig.arrays.find((a) => a.role === 'push');
    for (let k = Math.floor(this.rnd() * 3); k > 0; k--) {
      const t = this.pick(DEFAULT_TYPES);
      const v = this.fresh();
      body.push({ s: 'let', name: v, expr: this.expr(t, 1, scope, fns) });
      scope.push({ name: v, type: t, op: 'varref' });
    }
    const perLoop: Reduction[][] = [];
    for (let l = 0; l < opts.loops; l++) {
      const rs: Reduction[] = [];
      for (
        let k =
          map !== undefined
            ? (map.reduces ?? 0)
            : pushing || opts.deviceRange !== undefined
              ? 0
              : Math.floor(this.rnd() * 3);
        k > 0;
        k--
      ) {
        const type = this.pick(REDUCE_TYPES);
        const op = this.pick(isInt(type) ? INT_COMBINES : FLOAT_COMBINES);
        const v = this.fresh();
        body.push({ s: 'var', name: v, type, init: this.expr(type, 1, scope, fns) });
        rs.push({ name: v, type, op });
      }
      perLoop.push(rs);
    }
    for (const [l, rs] of perLoop.entries()) {
      const count = opts.deviceRange;
      if (count === undefined || l !== perLoop.length - 1) {
        body.push(this.kernelLoop(sig, structs, opts, [...scope], fns, rs, map));
        continue;
      }
      this.mark('deviceRange');
      const loop = this.kernelLoop(sig, structs, opts, [...scope], fns, rs, map) as Stmt & {
        s: 'for';
      };
      const dn = this.fresh();
      const dnRef: Expr = { op: 'varref', type: u32T, name: dn };
      const cond = loop.cond as Expr & { op: 'compare' };
      const length = cond.b;
      const element: Expr = {
        op: 'index',
        type: u32T,
        base: arrayRef(count),
        idx: { op: 'lit', type: u32T, value: 0 },
      };
      if (this.chance(0.3)) {
        this.mark('devicePastEnd');
        body.push({
          s: 'let',
          name: dn,
          expr: {
            op: 'binop',
            type: u32T,
            bop: '%',
            a: element,
            b: { op: 'lit', type: u32T, value: 4 },
          },
        });
        body.push(this.pastEndLoop(sig, structs, opts, [...scope], fns, length, dnRef));
      } else {
        body.push({
          s: 'let',
          name: dn,
          expr: { op: 'binop', type: u32T, bop: '%', a: element, b: plus(length, 2) },
        });
        body.push({
          ...loop,
          cond: { ...cond, b: { op: 'call', type: u32T, fn: 'min', args: [length, dnRef] } },
        });
      }
    }
    const reduced = perLoop.flat();
    const stored: Scope = [
      ...scope,
      ...reduced.map((r) => ({ name: r.name, type: r.type, op: 'varref' as const })),
    ];
    const targets = sig.arrays.filter(
      (a) => (a.role === 'in' || a.role === 'out') && a.elem.kind !== 'struct',
    );
    for (let s = 0; s < (opts.stores ?? 0) && targets.length > 0; s++) {
      const a = this.pick(targets);
      this.mark('storeAfterLoops');
      const past = this.chance(0.25);
      if (past) this.mark('storePastEnd');
      const idx: Expr = past
        ? plus(lengthOf(a), 1 + Math.floor(this.rnd() * 3))
        : this.chance(0.5)
          ? { op: 'lit', type: u32T, value: 0 }
          : {
              op: 'binop',
              type: u32T,
              bop: '%',
              a: this.expr(u32T, 1, stored, fns),
              b: lengthOf(a),
            };
      let e = this.expr(a.elem, 1, stored, fns);
      for (const r of reduced.filter((r) => typeKey(r.type) === typeKey(a.elem)))
        e = {
          op: 'binop',
          type: a.elem,
          bop: '+',
          a: { op: 'varref', type: a.elem, name: r.name },
          b: e,
        };
      if (
        opts.storeLength === true &&
        s === 0 &&
        pushing !== undefined &&
        a.elem.kind === 'scalar'
      ) {
        this.mark('storeLength');
        const length: Expr = { op: 'call', type: u32T, fn: 'pushCount', args: [arrayRef(pushing)] };
        e =
          a.elem.scalar === 'u32'
            ? length
            : { op: 'call', type: a.elem, fn: a.elem.scalar, args: [length] };
      }
      body.push({
        s: 'assign',
        target: { op: 'index', type: a.elem, base: arrayRef(a), idx },
        expr: e,
      });
    }
    if (pushing !== undefined) {
      body.push({
        s: 'return',
        expr: { op: 'call', type: u32T, fn: 'pushCount', args: [arrayRef(pushing)] },
      });
      return {
        name,
        params,
        ret: u32T,
        body: guardKernelBody({ params, body }),
        attrs: [],
        kernel: true,
      };
    }
    const ret =
      reduced.length > 0
        ? reduced[0]!.type
        : opts.deviceRange !== undefined
          ? voidT
          : this.chance(0.5)
            ? this.pick(SCALARS)
            : voidT;
    if (ret.kind !== 'void') {
      const after: Scope = [
        ...scope,
        ...reduced.map((r) => ({ name: r.name, type: r.type, op: 'varref' as const })),
      ];
      const same = reduced.filter((r) => typeKey(r.type) === typeKey(ret));
      let e = this.expr(ret, 1, after, fns);
      for (const r of same)
        e = {
          op: 'binop',
          type: ret,
          bop: '+',
          a: { op: 'varref', type: ret, name: r.name },
          b: e,
        };
      body.push({ s: 'return', expr: e });
    }
    return {
      name,
      params,
      ret,
      body: guardKernelBody({ params, body }),
      attrs: [],
      kernel: true,
    };
  }

  private kernelLoop(
    sig: KernelSig,
    structs: ReadonlyMap<string, StructDecl>,
    opts: Required<Pick<KernelGenOptions, 'stmts' | 'depth'>>,
    scope: Scope,
    fns: readonly FuncSig[],
    rs: readonly Reduction[],
    map?: MapSpec,
  ): Stmt {
    this.mark('kernelLoop');
    const i = this.fresh();
    const iRef: Expr = { op: 'varref', type: u32T, name: i };
    scope.push({ name: i, type: u32T, op: 'varref' });
    const shared = sig.arrays.filter((a) => a.role !== 'scatter' && a.role !== 'push');
    const body: Stmt[] = [];
    for (const a of shared) {
      if (a.name === map?.stride) continue;
      if (!this.chance(a.role === 'in' ? 0.85 : 0.3)) continue;
      const shifted = a.role === 'in' && this.chance(map?.shifted ?? 0.3);
      this.mark(shifted ? 'shiftedRead' : 'arrayRead');
      const by =
        shifted && map?.extra !== undefined && map.extra() < 0.5
          ? shared.find((x) => x.name === map.bound)!
          : a;
      const idx = shifted ? this.inRange(plus(iRef, 1 + Math.floor(this.rnd() * 4)), by) : iRef;
      const el: Expr = { op: 'index', type: a.elem, base: arrayRef(a), idx };
      const reads: { expr: Expr; type: ShaderType }[] =
        a.elem.kind === 'struct'
          ? structs
              .get(a.elem.name)!
              .fields.filter(() => this.chance(0.7))
              .map((f) => {
                this.mark('structRead');
                return {
                  expr: { op: 'member', type: f.type, base: el, field: f.name },
                  type: f.type,
                };
              })
          : [{ expr: el, type: a.elem }];
      if (reads.length > 0) {
        map?.trace.reads.set(a.name, shifted ? 'shifted' : 'i');
        if (shifted) map?.trace.measures.add(by.name);
      }
      for (const r of reads) {
        const v = this.fresh();
        body.push({ s: 'let', name: v, expr: r.expr });
        scope.push({ name: v, type: r.type, op: 'varref' });
      }
    }
    if (this.chance(map?.continues ?? 0.2)) {
      this.mark('loopContinue');
      if (map !== undefined) map.trace.continues = true;
      body.push({
        s: 'if',
        arms: [{ cond: this.boolExpr(1, scope, fns), body: [{ s: 'continue' }] }],
      });
    }
    body.push(...this.stmts(opts.stmts, opts.depth, scope, fns, false, 1));
    for (const a of sig.arrays.filter((x) => x.role === 'out')) {
      if (!this.chance(map?.write ?? 0.85)) continue;
      const strided = a.name === map?.stride;
      if (strided) this.mark('stridedWrite');
      const write = this.writeAt(
        a,
        strided ? timesTwo(iRef) : iRef,
        structs,
        opts.depth,
        scope,
        fns,
      );
      map?.trace.writes.set(a.name, strided ? 'strided' : 'i');
      if (this.chance(0.25)) {
        this.mark('conditionalWrite');
        map?.trace.conditional.add(a.name);
        body.push({
          s: 'if',
          arms: [{ cond: this.boolExpr(opts.depth, scope, fns), body: [write] }],
        });
      } else body.push(write);
    }
    for (const r of rs) {
      const combine = this.combine(r, opts.depth, scope, fns);
      if (this.chance(0.25)) {
        this.mark('conditionalCombine');
        body.push({
          s: 'if',
          arms: [{ cond: this.boolExpr(opts.depth, scope, fns), body: [combine] }],
        });
      } else body.push(combine);
    }
    for (const h of sig.arrays.filter((x) => x.role === 'scatter'))
      if (this.chance(0.75)) body.push(this.scatter(h, opts.depth, scope, fns));
    for (const q of sig.arrays.filter((x) => x.role === 'push')) {
      const twice = this.chance(0.3);
      const pushes: Stmt[] = Array.from({ length: twice ? 2 : 1 }, () => ({
        s: 'call',
        expr: {
          op: 'call',
          type: u32T,
          fn: 'push',
          args: [arrayRef(q), this.expr(q.elem, opts.depth, scope, fns)],
        },
      }));
      this.mark('push');
      if (twice) this.mark('pushTwice');
      if (this.chance(0.6)) {
        this.mark('conditionalPush');
        body.push({
          s: 'if',
          arms: [{ cond: this.boolExpr(opts.depth, scope, fns), body: pushes }],
        });
      } else body.push(...pushes);
    }
    if (map === undefined ? this.chance(0.3) : false)
      body.push(this.refused(sig, iRef, opts.depth, scope, fns));
    const bound = map === undefined ? this.pick(shared) : shared.find((x) => x.name === map.bound)!;
    const [start, step] = [map?.start ?? 0, map?.step ?? 1];
    return {
      s: 'for',
      init: { s: 'var', name: i, type: u32T, init: { op: 'lit', type: u32T, value: start } },
      cond: { op: 'compare', type: boolT, cop: '<', a: iRef, b: lengthOf(bound) },
      update: { s: 'assign', target: iRef, expr: plus(iRef, step) },
      body,
      counted: { name: i, op: 'add', step, start },
    };
  }

  private pastEndLoop(
    sig: KernelSig,
    structs: ReadonlyMap<string, StructDecl>,
    opts: Required<Pick<KernelGenOptions, 'stmts' | 'depth'>>,
    scope: Scope,
    fns: readonly FuncSig[],
    length: Expr,
    extra: Expr,
  ): Stmt {
    const i = this.fresh();
    const iRef: Expr = { op: 'varref', type: u32T, name: i };
    scope.push({ name: i, type: u32T, op: 'varref' });
    const body: Stmt[] = [...this.stmts(opts.stmts, opts.depth, scope, fns, false, 1)];
    for (const a of sig.arrays.filter((x) => x.role === 'out'))
      body.push(this.writeAt(a, iRef, structs, opts.depth, scope, fns));
    return {
      s: 'for',
      init: { s: 'var', name: i, type: u32T, init: { op: 'lit', type: u32T, value: 0 } },
      cond: {
        op: 'compare',
        type: boolT,
        cop: '<',
        a: iRef,
        b: { op: 'binop', type: u32T, bop: '+', a: length, b: extra },
      },
      update: { s: 'assign', target: iRef, expr: plus(iRef, 1) },
      body,
      counted: { name: i, op: 'add', step: 1, start: 0 },
    };
  }

  private inRange(idx: Expr, a: KernelArray): Expr {
    return { op: 'binop', type: u32T, bop: '%', a: idx, b: lengthOf(a) };
  }

  private writeAt(
    a: KernelArray,
    iRef: Expr,
    structs: ReadonlyMap<string, StructDecl>,
    depth: number,
    scope: Scope,
    fns: readonly FuncSig[],
  ): Stmt {
    const place: Expr = { op: 'index', type: a.elem, base: arrayRef(a), idx: iRef };
    if (a.elem.kind !== 'struct') {
      this.mark('affineWrite');
      return { s: 'assign', target: place, expr: this.expr(a.elem, depth, scope, fns) };
    }
    const decl = structs.get(a.elem.name)!;
    if (this.chance(0.5)) {
      this.mark('structWrite');
      return {
        s: 'assign',
        target: place,
        expr: {
          op: 'construct',
          type: a.elem,
          args: decl.fields.map((f) => this.expr(f.type, depth, scope, fns)),
        },
      };
    }
    this.mark('fieldWrite');
    const f = this.pick(decl.fields);
    return {
      s: 'assign',
      target: { op: 'member', type: f.type, base: place, field: f.name },
      expr: this.expr(f.type, depth, scope, fns),
    };
  }

  private combine(r: Reduction, depth: number, scope: Scope, fns: readonly FuncSig[]): Stmt {
    this.mark('combine');
    this.mark(`combine${r.op}`);
    if (r.type.kind === 'vec') this.mark('vecCombine');
    const target: Expr = { op: 'varref', type: r.type, name: r.name };
    const e = this.expr(r.type, depth, scope, fns);
    const [a, b] = this.chance(0.5) ? [target, e] : [e, target];
    if (r.op === 'min' || r.op === 'max')
      return { s: 'assign', target, expr: { op: 'call', type: r.type, fn: r.op, args: [a, b] } };
    if (this.chance(0.7)) return { s: 'assignOp', target, bop: r.op, expr: e };
    this.mark('combineSpelled');
    return { s: 'assign', target, expr: { op: 'binop', type: r.type, bop: r.op, a, b } };
  }

  private scatter(h: KernelArray, depth: number, scope: Scope, fns: readonly FuncSig[]): Stmt {
    const op = this.chance(0.1) ? '*' : this.pick(SCATTER_COMBINES);
    this.mark('scatter');
    this.mark(`scatter${op}`);
    return {
      s: 'assignOp',
      target: {
        op: 'index',
        type: h.elem,
        base: arrayRef(h),
        idx: this.anyIndex(h, depth, scope, fns),
      },
      bop: op,
      expr: this.expr(h.elem, depth, scope, fns),
    };
  }

  private anyIndex(a: KernelArray, depth: number, scope: Scope, fns: readonly FuncSig[]): Expr {
    const t = this.pick([i32T, u32T] as const);
    const k = this.expr(t, depth, scope, fns);
    return this.inRange(t === u32T ? k : { op: 'call', type: u32T, fn: 'u32', args: [k] }, a);
  }

  private refused(
    sig: KernelSig,
    iRef: Expr,
    depth: number,
    scope: Scope,
    fns: readonly FuncSig[],
  ): Stmt {
    const outs = sig.arrays.filter((a) => a.role === 'out');
    const hs = sig.arrays.filter((a) => a.role === 'scatter');
    const kind = this.pick([
      ...(outs.length > 0 ? ['read' as const] : []),
      ...(hs.length > 0 ? ['scatter' as const] : []),
      'break' as const,
    ]);
    if (kind === 'read') {
      this.mark('refusedRead');
      const o = this.pick(outs);
      const from: Expr = {
        op: 'index',
        type: o.elem,
        base: arrayRef(o),
        idx: this.inRange(plus(iRef, 1), o),
      };
      return {
        s: 'assign',
        target: { op: 'index', type: o.elem, base: arrayRef(o), idx: iRef },
        expr: from,
      };
    }
    if (kind === 'scatter') {
      this.mark('refusedScatter');
      const h = this.pick(hs);
      const place: Expr = {
        op: 'index',
        type: h.elem,
        base: arrayRef(h),
        idx: this.anyIndex(h, depth, scope, fns),
      };
      return {
        s: 'assign',
        target: place,
        expr: {
          op: 'call',
          type: h.elem,
          fn: this.pick(['min', 'max'] as const),
          args: [place, this.expr(h.elem, depth, scope, fns)],
        },
      };
    }
    this.mark('refusedBreak');
    return { s: 'if', arms: [{ cond: this.boolExpr(1, scope, fns), body: [{ s: 'break' }] }] };
  }
}

export interface KernelArray {
  readonly name: string;
  readonly elem: ShaderType;
  readonly role: 'in' | 'out' | 'scatter' | 'push';
}
interface KernelSig {
  readonly arrays: readonly KernelArray[];
  readonly scalars: readonly { readonly name: string; readonly type: ShaderType }[];
}
interface MapSpec {
  readonly bound: string;
  readonly start: number;
  readonly step: number;
  readonly stride?: string;
  readonly shifted: number;
  readonly continues: number;
  readonly write: number;
  readonly reduces?: number;
  readonly extra?: () => number;
  readonly trace: MapTrace;
}

interface MapTrace {
  readonly reads: Map<string, 'i' | 'shifted'>;
  readonly writes: Map<string, 'i' | 'strided'>;
  readonly conditional: Set<string>;
  readonly measures: Set<string>;
  continues: boolean;
}

type CombineOp = '+' | '*' | '&' | '|' | '^' | 'min' | 'max';
interface Reduction {
  readonly name: string;
  readonly type: ShaderType;
  readonly op: CombineOp;
}

const ELEMS: readonly ShaderType[] = [f32T, i32T, u32T, vec2fT, vec3fT, vec4fT];
const REDUCE_TYPES: readonly ShaderType[] = [...SCALARS, vec2fT, vec4fT];
const FLOAT_COMBINES: readonly CombineOp[] = ['+', '*', 'min', 'max'];
const INT_COMBINES: readonly CombineOp[] = ['+', '*', '&', '|', '^', 'min', 'max'];
const SCATTER_COMBINES = ['+', '&', '|', '^'] as const;

const arrayOf = (a: KernelArray): ShaderType => ({ kind: 'array', elem: a.elem });
const arrayRef = (a: KernelArray): Expr => ({ op: 'param', type: arrayOf(a), name: a.name });
const lengthOf = (a: KernelArray): Expr => ({
  op: 'call',
  type: u32T,
  fn: 'arrayLength',
  args: [arrayRef(a)],
});
const plus = (a: Expr, n: number): Expr => ({
  op: 'binop',
  type: u32T,
  bop: '+',
  a,
  b: { op: 'lit', type: u32T, value: n },
});
const timesTwo = (a: Expr): Expr => ({
  op: 'binop',
  type: u32T,
  bop: '*',
  a: { op: 'lit', type: u32T, value: 2 },
  b: a,
});

type Scope = Array<{ name: string; type: ShaderType; op: 'param' | 'varref' }>;
interface FuncSig {
  readonly name: string;
  readonly ret: ShaderType;
  readonly params: readonly ShaderType[];
}

function typeKey(t: ShaderType): string {
  return t.kind === 'scalar'
    ? `s:${t.scalar}`
    : t.kind === 'vec'
      ? `v:${t.n}:${t.elem}`
      : `o:${t.kind}`;
}

export function generateModule(seed: number, opts: GenOptions = {}): Corpus {
  const funcs = opts.funcs ?? 6;
  const stmts = opts.stmts ?? 5;
  const depth = opts.depth ?? 3;
  const nest = opts.nest ?? 2;
  const types = opts.types ?? DEFAULT_TYPES;
  const gen = new Gen(mulberry32(seed), opts.exact ?? false);
  const rnd = mulberry32(seed ^ 0x5bf03635);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

  const decls: FuncDecl[] = [];
  const sigs: FuncSig[] = [];
  for (let i = 0; i < funcs; i++) {
    const ret = pick(types);
    const params = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(types));
    decls.push(gen.func(`f${i}`, ret, params, { stmts, depth, nest }, [...sigs]));
    sigs.push({ name: `f${i}`, ret, params });
  }
  return {
    module: { consts: [], structs: [], bindings: [], funcs: decls },
    seed,
    features: { ...gen.features },
  };
}

export function describeCorpus(corpora: readonly Corpus[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of corpora)
    for (const [k, v] of Object.entries(c.features)) out[k] = (out[k] ?? 0) + v;
  return out;
}

export interface KernelGenOptions {
  readonly helpers?: number;
  readonly loops?: number;
  readonly stores?: number;
  readonly pushes?: boolean;
  readonly storeLength?: boolean;
  readonly deviceRange?: boolean;
  readonly stmts?: number;
  readonly depth?: number;
  readonly exact?: boolean;
}

export interface KernelCorpus extends Corpus {
  readonly kernel: string;
  readonly arrays: readonly KernelArray[];
}

export function generateKernelModule(seed: number, opts: KernelGenOptions = {}): KernelCorpus {
  const gen = new Gen(mulberry32(seed ^ 0x2545f491), opts.exact ?? false);
  const rnd = mulberry32(seed ^ 0x68e31da4);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const count = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));

  const structs: StructDecl[] =
    rnd() < 0.6
      ? [
          {
            name: 'S0',
            fields: Array.from({ length: count(1, 4) }, (_, f) => ({
              name: `f${f}`,
              type: pick(ELEMS),
            })),
          },
        ]
      : [];
  const decls: FuncDecl[] = [];
  const sigs: FuncSig[] = [];
  for (let i = 0; i < (opts.helpers ?? 3); i++) {
    const ret = pick(DEFAULT_TYPES);
    const params = Array.from({ length: count(1, 3) }, () => pick(DEFAULT_TYPES));
    decls.push(gen.func(`f${i}`, ret, params, { stmts: 3, depth: 2, nest: 1 }, [...sigs]));
    sigs.push({ name: `f${i}`, ret, params });
  }
  const elems = [...ELEMS, ...structs.map((s): ShaderType => ({ kind: 'struct', name: s.name }))];
  const arrays: KernelArray[] = [
    ...Array.from({ length: count(1, 3) }, (_, n) => ({
      name: `a${n}`,
      elem: pick(elems),
      role: 'in' as const,
    })),
    ...Array.from({ length: count(1, 2) }, (_, n) => ({
      name: `o${n}`,
      elem: n === 0 && structs.length > 0 && rnd() < 0.5 ? elems[elems.length - 1]! : pick(elems),
      role: 'out' as const,
    })),
    ...(rnd() < 0.7 ? [{ name: 'h0', elem: pick([i32T, u32T]), role: 'scatter' as const }] : []),
  ];
  const scalars = Array.from({ length: count(0, 2) }, (_, n) => ({
    name: `p${n}`,
    type: pick(SCALARS),
  }));
  const pushStream = mulberry32(seed ^ 0x0078c0de);
  const drawn = pushStream() < 0.2;
  const pushes = opts.pushes ?? drawn;
  const kernelArrays: KernelArray[] = pushes
    ? [
        ...arrays.filter((a) => a.role === 'in'),
        { name: 'q0', elem: [f32T, i32T, u32T][Math.floor(pushStream() * 3)]!, role: 'push' },
      ]
    : arrays;
  const loops = opts.loops ?? (rnd() < 0.4 ? 2 : 1);
  const storeStream = mulberry32(seed ^ 0x0094f1e1);
  const stores =
    opts.stores ?? (loops === 0 || storeStream() < 1 / 3 ? 1 + Math.floor(storeStream() * 2) : 0);
  const storeLength = opts.storeLength ?? mulberry32(seed ^ 0x0094a11d)() < 0.5;
  const device = !pushes && loops > 0 && opts.deviceRange === true;
  const counts: KernelArray = { name: 'c0', elem: u32T, role: 'in' };
  const withCount = device ? [...kernelArrays, counts] : kernelArrays;
  const k = gen.kernel(
    'k',
    { arrays: withCount, scalars },
    new Map(structs.map((s) => [s.name, s])),
    {
      loops,
      stmts: opts.stmts ?? 2,
      depth: opts.depth ?? 2,
      stores,
      storeLength,
      ...(device ? { deviceRange: counts } : {}),
    },
    sigs,
  );
  return {
    module: { consts: [], structs, bindings: [], funcs: [...decls, k] },
    seed,
    features: { ...gen.features },
    kernel: 'k',
    arrays: withCount,
  };
}

export interface ChainLength {
  readonly of: 'n' | 'm';
  readonly times: 1 | 2;
}

export interface ChainArray {
  readonly id: string;
  readonly elem: ShaderType;
  readonly length: ChainLength;
  readonly written: boolean;
  readonly scratch: boolean;
}

export interface ChainAccess {
  readonly param: string;
  readonly array: string;
  readonly reads: 'none' | 'i' | 'shifted';
  readonly writes: 'none' | 'i' | 'strided';
  readonly conditional: boolean;
  readonly measures: boolean;
}

export interface ChainCall {
  readonly fn: string;
  readonly over: 'n' | 'm';
  readonly start: number;
  readonly step: number;
  readonly args: readonly (
    { readonly array: string } | { readonly scalar: ShaderType; readonly name: string }
  )[];
  readonly access: readonly ChainAccess[];
  readonly continues: boolean;
  readonly reduces: number;
}

export interface ChainCorpus extends Corpus {
  readonly calls: readonly ChainCall[];
  readonly arrays: readonly ChainArray[];
}

export interface ChainGenOptions {
  readonly calls?: number;
  readonly exact?: boolean;
}

const holdsScalars = (t: ShaderType): boolean =>
  t.kind === 'scalar' && (t.scalar === 'f32' || t.scalar === 'i32' || t.scalar === 'u32');

function measuring(fn: FuncDecl, names: readonly string[]): FuncDecl {
  const lets = names.map((name): Stmt => {
    const p = fn.params.find((x) => x.name === name)!;
    return {
      s: 'let',
      name: `len_${name}`,
      expr: {
        op: 'call',
        type: u32T,
        fn: 'arrayLength',
        args: [{ op: 'param', type: p.type, name }],
      },
    };
  });
  return {
    ...fn,
    body: fn.body.map((st) => (st.s === 'for' ? { ...st, body: [...lets, ...st.body] } : st)),
  };
}

export function generateChain(seed: number, opts: ChainGenOptions = {}): ChainCorpus {
  const gen = new Gen(mulberry32(seed ^ 0x3c6ef372), opts.exact ?? false);
  const rnd = mulberry32(seed ^ 0x1f83d9ab);
  const extra = mulberry32(seed ^ 0x9e3779b9);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const chance = (p: number): boolean => rnd() < p;
  const count = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));

  const structs: StructDecl[] = chance(0.5)
    ? [
        {
          name: 'S0',
          fields: Array.from({ length: count(1, 3) }, (_, f) => ({
            name: `f${f}`,
            type: pick(ELEMS),
          })),
        },
      ]
    : [];
  const structMap = new Map(structs.map((s) => [s.name, s]));
  const decls: FuncDecl[] = [];
  const sigs: FuncSig[] = [];
  for (let i = 0; i < 3; i++) {
    const ret = pick(DEFAULT_TYPES);
    const params = Array.from({ length: count(1, 3) }, () => pick(DEFAULT_TYPES));
    decls.push(gen.func(`f${i}`, ret, params, { stmts: 3, depth: 2, nest: 1 }, [...sigs]));
    sigs.push({ name: `f${i}`, ret, params });
  }
  const elems = [...ELEMS, ...structs.map((s): ShaderType => ({ kind: 'struct', name: s.name }))];
  const elemOf = (): ShaderType => (chance(0.4) ? f32T : pick(elems));

  const arrays: {
    id: string;
    elem: ShaderType;
    length: ChainLength;
    written: boolean;
    scratch: boolean;
  }[] = [];
  const fresh = (elem: ShaderType, of: 'n' | 'm', times: 1 | 2): (typeof arrays)[number] => {
    const a = {
      id: `x${arrays.length}`,
      elem,
      length: { of, times },
      written: false,
      scratch: false,
    };
    arrays.push(a);
    return a;
  };
  const recent = <T>(xs: readonly T[]): T =>
    xs[xs.length - 1 - Math.floor(rnd() * rnd() * xs.length)]!;

  const calls: ChainCall[] = [];
  const total = opts.calls ?? count(2, 6);
  const [pChain, pLast, pAt, pTwo] = [extra(), extra(), extra(), extra()];
  const reduceAt =
    pChain < 0.3 ? (pLast < 0.8 ? total - 1 : Math.floor(pAt * Math.max(total - 1, 1))) : -1;
  const reduceVars = pTwo < 0.3 ? 2 : 1;
  for (let j = 0; j < total; j++) {
    const over: 'n' | 'm' = chance(0.08) ? 'm' : 'n';
    const reduces = j === reduceAt ? reduceVars : 0;
    const bound = new Set<string>();
    const free = (): (typeof arrays)[number][] =>
      arrays.filter((a) => a.length.of === over && !bound.has(a.id));
    const take = (a: (typeof arrays)[number]): (typeof arrays)[number] => {
      bound.add(a.id);
      return a;
    };
    const ins: (typeof arrays)[number][] = [];
    for (let k = pick([1, 1, 2, 2, 3]); k > 0; k--) {
      const have = free();
      ins.push(take(have.length > 0 && chance(0.75) ? recent(have) : fresh(elemOf(), over, 1)));
    }
    const outs: (typeof arrays)[number][] = [];
    if (reduces === 0 || chance(0.3)) {
      const reusable = free().filter((a) => a.length.times === 1);
      outs.push(
        take(reusable.length > 0 && chance(0.1) ? recent(reusable) : fresh(elemOf(), over, 1)),
      );
    } else if (!ins.some((a) => a.length.times === 1)) ins.unshift(take(fresh(elemOf(), over, 1)));
    let stride: string | undefined;
    if (reduces === 0 && chance(0.5)) {
      const r = rnd();
      const have = free();
      if (r < 0.25) {
        outs.push(take(fresh(elemOf(), over, 2)));
        stride = 'o1';
      } else if (r < 0.45 && have.length > 0) outs.push(take(recent(have)));
      else outs.push(take(fresh(elemOf(), over, 1)));
    }
    for (const o of outs) o.written = true;

    const karrays: KernelArray[] = [
      ...ins.map((a, k) => ({ name: `a${k}`, elem: a.elem, role: 'in' as const })),
      ...outs.map((a, k) => ({ name: `o${k}`, elem: a.elem, role: 'out' as const })),
    ];
    const scalars = Array.from({ length: count(0, 2) }, (_, k) => ({
      name: `p${k}`,
      type: pick(SCALARS),
    }));
    const [start, step] = [chance(0.04) ? pick([1, 3]) : 0, chance(0.04) ? 2 : 1];
    const trace: MapTrace = {
      reads: new Map(),
      writes: new Map(),
      conditional: new Set(),
      measures: new Set(),
      continues: false,
    };
    const fn = gen.kernel(
      `c${j}`,
      { arrays: karrays, scalars },
      structMap,
      { loops: 1, stmts: 2, depth: 2 },
      sigs,
      {
        bound: outs.length > 0 ? 'o0' : `a${ins.findIndex((a) => a.length.times === 1)}`,
        start,
        step,
        ...(stride !== undefined ? { stride } : {}),
        shifted: 0.15,
        continues: 0.04,
        write: 0.95,
        reduces,
        extra,
        trace,
      },
    );
    decls.push(fn);
    const bindings = [...ins, ...outs];
    calls.push({
      fn: fn.name,
      over,
      start,
      step,
      args: [
        ...karrays.map((_, k) => ({ array: bindings[k]!.id })),
        ...scalars.map((s) => ({ scalar: s.type, name: s.name })),
      ],
      access: karrays.map((a, k): ChainAccess => ({
        param: a.name,
        array: bindings[k]!.id,
        reads: trace.reads.get(a.name) ?? 'none',
        writes: trace.writes.get(a.name) ?? 'none',
        conditional: trace.conditional.has(a.name),
        measures: trace.measures.has(a.name),
      })),
      continues: trace.continues,
      reduces,
    });
  }

  for (const a of arrays) a.scratch = holdsScalars(a.elem) && extra() < (a.written ? 0.5 : 0.12);
  if (!arrays.some((a) => a.written && !a.scratch))
    for (let i = arrays.length - 1; i >= 0; i--)
      if (arrays[i]!.written) {
        arrays[i]!.scratch = false;
        break;
      }
  const scratchIds = new Set(arrays.filter((a) => a.scratch).map((a) => a.id));
  let lengthReads = 0;
  calls.forEach((call, j) => {
    const names = call.access
      .filter((a) => scratchIds.has(a.array) && !a.measures && extra() < 0.15)
      .map((a) => a.param);
    if (names.length === 0) return;
    const at = decls.findIndex((d) => d.name === call.fn);
    decls[at] = measuring(decls[at]!, names);
    calls[j] = {
      ...call,
      access: call.access.map((a) => (names.includes(a.param) ? { ...a, measures: true } : a)),
    };
    lengthReads += names.length;
  });
  const features: Record<string, number> = { ...gen.features, chainCall: calls.length };
  const [reducing, scratching] = [
    calls.filter((call) => call.reduces > 0).length,
    arrays.filter((a) => a.scratch).length,
  ];
  if (reducing > 0) features['reducingCall'] = reducing;
  if (scratching > 0) features['scratchArray'] = scratching;
  if (lengthReads > 0) features['lengthRead'] = lengthReads;
  return {
    module: { consts: [], structs, bindings: [], funcs: decls },
    seed,
    features,
    calls,
    arrays,
  };
}
