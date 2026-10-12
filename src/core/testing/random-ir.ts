// ═══ Shader DSL — seeded, typed random-IR generator (X-GIS #2406, direction record D6.1) ═══
//
// Every other "property" test in this package randomises INPUTS over a fixed kernel. This
// generates the KERNEL: whole `ModuleDecl`s, deterministic from a seed, type-correct by
// construction so `validate()` accepts them, and shaped to reach the constructs the
// compiler's defects actually lived in.
//
// It is a fuzz CORPUS, not a fuzz ENGINE: no shrinking, no coverage feedback. A failure is
// reproduced by its seed, which is what a regression test needs — and `describeCorpus`
// exists so a green run can be checked for having generated anything at all. A generator
// that silently stopped emitting integer division would report zero divergences forever
// (AGENTS.md#gate-discipline — validate the instrument against a known positive before believing a zero).
//
// NOT generated, deliberately: `raw` / `placeholder` statements and `hostBlock` / `externVar`
// (opaque by construction — they have no CPU semantics to differentiate against), textures
// and samplers (they need GPU stubs, not values), and `f64` (its own lowering pass owns it).

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

/** Deterministic PRNG — mulberry32. Same seed, same module, on every machine and run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the generator was asked to build. Every field has a defaulted, DOCUMENTED value —
 *  a caller narrowing one (integers only, say) is bisecting a failure, not configuring. */
export interface GenOptions {
  /** Functions per module (default 6). */
  readonly funcs?: number;
  /** Statements in a function body, before the mandatory `return` (default 5). */
  readonly stmts?: number;
  /** Maximum expression nesting (default 3). Depth 0 is a leaf. */
  readonly depth?: number;
  /** Maximum BLOCK nesting — `if` / `for` / `switch` inside each other (default 2). */
  readonly nest?: number;
  /** Types a generated function may take and return (default: all scalars + f32 vectors). */
  readonly types?: readonly ShaderType[];
  /** Only the operations WGSL gives one answer (default false): the ones the determinism report
   *  (`passes/determinism.ts`) calls exact, over float literals with a few bits each, so that no
   *  grouping a driver may choose (WGSL §15.7.5, #378) rounds, and a GPU must match the f32
   *  oracle bit for bit. */
  readonly exact?: boolean;
}

const SCALARS: readonly ShaderType[] = [f32T, i32T, u32T];
const DEFAULT_TYPES: readonly ShaderType[] = [...SCALARS, vec2fT, vec3fT, vec4fT];

const isF32 = (t: ShaderType): boolean =>
  (t.kind === 'scalar' && t.scalar === 'f32') || (t.kind === 'vec' && t.elem === 'f32');
/** A type PREDICATE, not a boolean: every caller then reads `t.scalar` under the narrowing. */
const isInt = (
  t: ShaderType,
): t is Extract<ShaderType, { kind: 'scalar' }> & { scalar: 'i32' | 'u32' } =>
  t.kind === 'scalar' && (t.scalar === 'i32' || t.scalar === 'u32');
const isVec = (t: ShaderType): boolean => t.kind === 'vec';
const arity = (t: ShaderType): number => (t.kind === 'vec' ? t.n : 1);

// Builtins split by the argument shape they accept, so a call is type-correct by construction.
// Only value-returning, side-effect-free, CPU-defined ones — the oracle is the contract.
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
/** Vector → scalar f32. Only on f32 vectors; `dot`'s CPU form reduces to a number. */
const VEC_REDUCE = ['length'] as const;

const F32_BINOPS: readonly BinOp[] = ['+', '-', '*', '/'];

const F32_LITERALS = [0, 1, -1, 0.5, -0.25, 2, 3.5, 1e-3, 1e3, Math.PI];
/** `F32_LITERALS` with a few bits each, so that a sum or a product of them rounds in no order:
 *  WGSL lets a driver reassociate (§15.7.5), and SwiftShader groups two constants across the
 *  operation between them, so `3.5 + (0.001 - x)` came back as `(3.5 + 0.001) - x`, 1 ULP from
 *  the oracle (#378). The same length, so a seed draws the same shape in both modes. */
const EXACT_F32_LITERALS = [0, 1, -1, 0.5, -0.25, 2, 3.5, 0.125, 1e3, -8];

/** Each list above, kept to what `accuracyOf` calls exact: every target computes one answer, the
 *  f32 oracle's, so `GenOptions.exact`'s programs are held to the GPU bit for bit. */
const onlyExact = <T extends string>(xs: readonly T[]): readonly T[] =>
  xs.filter((x) => accuracyOf(x)?.kind === 'exact');
const EXACT = {
  unary: onlyExact(F32_UNARY),
  binary: onlyExact(F32_BINARY),
  ternary: onlyExact(F32_TERNARY),
  binops: onlyExact(F32_BINOPS),
};
// Integer ops carry WGSL's own semantics (wrap, truncating `/`, `x/0 = x`, `x%0 = 0`) — the
// exact surface X-GIS #2274 got wrong, so `/` and `%` are generated on purpose, over divisors that
// CAN be zero.
const INT_BINOPS: readonly BinOp[] = ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>'];
const CMPS: readonly CmpOp[] = ['<', '<=', '>', '>=', '==', '!='];

/** One generated module plus what it actually contains — the instrument's own self-report. */
export interface Corpus {
  readonly module: ModuleDecl;
  readonly seed: number;
  /** Construct counts, for asserting the generator still reaches what it claims to. */
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
  /** Function-unique binding name — `no-shadowed-local` (X-GIS #2341) is a CORE gate, so a
   *  generator that reused a name would be emitting INVALID modules, not finding bugs. */
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
      // Small magnitudes keep products inside the wrap window most of the time, and 0 is
      // over-weighted: it is the divisor that separates WGSL's `x/0 = x` from JS's Infinity.
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

  /** An in-scope value of exactly `t`, or a literal when scope offers none. */
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

  /** An expression of EXACTLY `t`. Every arm preserves the type, so `validate()` passes and
   *  the generator tests semantics rather than the type checker. */
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
      // A shift count must be u32 on both targets; everything else is same-typed.
      const b =
        bop === '<<' || bop === '>>'
          ? ({ op: 'lit', type: u32T, value: Math.floor(this.rnd() * 34) } as Expr) // >31 included: the wrap case
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
        // smoothstep/mix/clamp take same-typed args on both targets; scalars broadcast is
        // NOT generated, so the emit is always spellable.
        const args = Array.from({ length: n as number }, () => this.expr(t, depth - 1, scope, fns));
        // A float `clamp` whose `low` passes its `high` has two answers in WGSL, `min(max(e, low),
        // high)` or the median of the three, and Tint refuses it outright in a constant. Its exact
        // form orders the bounds.
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
        // `abs`/`sign` on u32 are meaningless (and `abs(INT_MIN)` is the wrap case on i32).
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
        // Cross-kind conversion — a bit reinterpretation between i32 and u32, and a
        // truncation from f32. Both are places the CPU tier and the GPU can disagree.
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
      // `length` is inherited from `sqrt`, which a driver may evaluate its own way.
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

  /** A statement list. `inLoop` gates `break` / `continue`, which are invalid outside one.
   *  `nest` is the BLOCK budget, deliberately separate from the expression `depth`: a `for`
   *  whose body may hold a `for` recurses on blocks, not on operators, so one counter cannot
   *  bound both (it did not — the first version recursed until the stack gave out). */
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
      // Past the block budget only NON-nesting statements are legal moves.
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
        // A mutation right after, so copy-prop / const-prop have a moving target to respect.
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
          // The ACCUMULATOR LOOP, emitted deliberately rather than hoped for. A `continue`
          // is only observable when something AFTER it in the loop body changes a value the
          // function returns — and a `switch` arm only runs when the scrutinee hits its
          // case. The first version of this generator satisfied neither: its scrutinee was
          // an arbitrary truncated float (so the arms were dead) and the switch was often
          // the last statement in the body (so `continue` and falling through agreed). It
          // generated 39 `continue`s inside switches and could not see X-GIS #2275 reverted.
          // Here the scrutinee IS the loop counter, so cases 0/1/2 all execute, and the
          // accumulate lands after the switch, so skipping it is visible in the result.
          this.mark('accumulatorLoop');
          const accType = this.pick(SCALARS);
          const accName = this.fresh();
          // Declared in the ENCLOSING scope and pushed there, so the function's later
          // statements — the mandatory `return` above all — can read what the loop wrote.
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
            // Skipped on every `continue` above — this is what makes the propagation visible.
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
        // `switch` with `break` / `continue` arms. X-GIS #2275 was exactly this: the interpreter
        // swallowed a `continue` raised inside a switch case, so the loop kept executing the
        // rest of the body. Generated only inside a loop, where `continue` is legal.
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

  // ─── kernel functions (#349) ─────────────────────────────────────────────────────────────

  /** A kernel function (Rule 8.22) over `sig`: scalar statements, then `opts.loops` loops over
   *  the length the arrays share, then a `return` of what the loops combined. */
  kernel(
    name: string,
    sig: KernelSig,
    structs: ReadonlyMap<string, StructDecl>,
    opts: Required<Pick<KernelGenOptions, 'loops' | 'stmts' | 'depth'>>,
    fns: readonly FuncSig[],
    map?: MapSpec,
  ): FuncDecl {
    this.resetNames();
    this.mark('kernel');
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
    // Loop-invariant values the loops may read.
    for (let k = Math.floor(this.rnd() * 3); k > 0; k--) {
      const t = this.pick(DEFAULT_TYPES);
      const v = this.fresh();
      body.push({ s: 'let', name: v, expr: this.expr(t, 1, scope, fns) });
      scope.push({ name: v, type: t, op: 'varref' });
    }
    // Every combined variable is declared before the first loop and read only after the last:
    // a loop that read its own would carry it (R3), and a loop that read an earlier loop's would
    // split the function (the shape refusal). Each loop combines its own.
    const perLoop: Reduction[][] = [];
    for (let l = 0; l < opts.loops; l++) {
      const rs: Reduction[] = [];
      // A loop a fusion takes reduces nothing but as the last call of a group (F6).
      for (
        let k = map === undefined ? Math.floor(this.rnd() * 3) : (map.reduces ?? 0);
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
    for (const rs of perLoop)
      body.push(this.kernelLoop(sig, structs, opts, [...scope], fns, rs, map));
    const reduced = perLoop.flat();
    const ret =
      reduced.length > 0 ? reduced[0]!.type : this.chance(0.5) ? this.pick(SCALARS) : voidT;
    if (ret.kind !== 'void') {
      const after: Scope = [
        ...scope,
        ...reduced.map((r) => ({ name: r.name, type: r.type, op: 'varref' as const })),
      ];
      // What the loops combined is read, so no reduction is dead code an optimizer may drop.
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
    return { name, params, ret, body, attrs: [], kernel: true };
  }

  /** One loop of a kernel function: `for (i = 0u; i < arrayLength(x); i++)`, reading the arrays
   *  at `i` or at an index kept in range by `%`, writing each output at `i`, combining `rs`, and
   *  combining an integer array at any index. */
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
    const shared = sig.arrays.filter((a) => a.role !== 'scatter');
    const body: Stmt[] = [];
    for (const a of shared) {
      // A strided write is held to the index it writes, so its array is not read (R4).
      if (a.name === map?.stride) continue;
      if (!this.chance(a.role === 'in' ? 0.85 : 0.3)) continue;
      // An output is read only at `i`, before it is written: another index is R4's refusal.
      const shifted = a.role === 'in' && this.chance(map?.shifted ?? 0.3);
      this.mark(shifted ? 'shiftedRead' : 'arrayRead');
      // A read at another index keeps in range by the length of the array it reads. In a chain it
      // does so, now and then, by the length of the array that bounds the loop, which is as long:
      // the iteration then names no length of the array it reads, and only the facts tell a fused
      // entry that the read is not at `i`.
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
      // A struct whose every field is left out is not read.
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
    // A `continue` of the loop's own, which the lowering makes the invocation's `return`.
    if (this.chance(map?.continues ?? 0.2)) {
      this.mark('loopContinue');
      if (map !== undefined) map.trace.continues = true;
      body.push({
        s: 'if',
        arms: [{ cond: this.boolExpr(1, scope, fns), body: [{ s: 'continue' }] }],
      });
    }
    // Locals, branches and loops over constants, which write only the iteration's own values.
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
    for (const r of rs) body.push(this.combine(r, opts.depth, scope, fns));
    for (const h of sig.arrays.filter((x) => x.role === 'scatter'))
      if (this.chance(0.75)) body.push(this.scatter(h, opts.depth, scope, fns));
    // Now and then a shape the proof refuses, so the CPU path of a refused loop is generated too.
    // A loop a fusion takes is one the proof accepts.
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

  /** `idx % arrayLength(a)`: an index every target reads the same element at. */
  private inRange(idx: Expr, a: KernelArray): Expr {
    return { op: 'binop', type: u32T, bop: '%', a: idx, b: lengthOf(a) };
  }

  /** A write of output `a` at `i`: the element, a struct whole, or one of its fields. */
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

  /** `s op= e`, `s = s op e` or `s = min(s, e)`: forms the proof reads as one combine. */
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

  /** An integer array combined at an index any iteration may reach, which the lowering makes
   *  one atomic (`*` has none, so that one runs on the CPU). */
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

  /** An index into `a` computed from the iteration's values, kept in range. */
  private anyIndex(a: KernelArray, depth: number, scope: Scope, fns: readonly FuncSig[]): Expr {
    const t = this.pick([i32T, u32T] as const);
    const k = this.expr(t, depth, scope, fns);
    return this.inRange(t === u32T ? k : { op: 'call', type: u32T, fn: 'u32', args: [k] }, a);
  }

  /** A statement the proof refuses (Rule 8.22), so the loop runs on the CPU tier as written. */
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
      // R4: an element of an array the loop writes, read at another index.
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
      // R3: an integer element combined through `min` or `max`, a form the proof reads as
      // carried where `+=` would be a scatter.
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
    // R2: a `break`, after which no later iteration runs.
    this.mark('refusedBreak');
    return { s: 'if', arms: [{ cond: this.boolExpr(1, scope, fns), body: [{ s: 'break' }] }] };
  }
}

/** One array a generated kernel function takes: read, written at `i`, or combined at any index. */
export interface KernelArray {
  readonly name: string;
  readonly elem: ShaderType;
  readonly role: 'in' | 'out' | 'scatter';
}
interface KernelSig {
  readonly arrays: readonly KernelArray[];
  readonly scalars: readonly { readonly name: string; readonly type: ShaderType }[];
}
/** What a chain asks of a kernel function it builds (change 0058): a loop that a fusion may take.
 *  A function built for a chain has one loop, scatters nowhere and carries no statement the proof
 *  refuses, and records how it reaches each array in `trace`. It reduces nothing, or, when it is
 *  to be the last call of a fused group (F6), the variables `reduces` says. */
interface MapSpec {
  /** The array parameter whose length bounds the loop. */
  readonly bound: string;
  /** The counter's first value, and what it steps by. */
  readonly start: number;
  readonly step: number;
  /** The output written at `2 * i`, if any. */
  readonly stride?: string;
  /** The chance that a read of an input is at another index, that the loop has a `continue`, and
   *  that an output is written. */
  readonly shifted: number;
  readonly continues: number;
  readonly write: number;
  /** How many variables the loop folds: none for a map, one or two for a call that reduces. */
  readonly reduces?: number;
  /** A stream of its own for a decision that must not move the draws of the function it is made
   *  in: whether a read at another index keeps in range by the length of the array it reads. */
  readonly extra?: () => number;
  readonly trace: MapTrace;
}

/** How a function built for a chain reaches its arrays, as it was built and not as the proof
 *  reads it. */
interface MapTrace {
  /** The arrays read, and whether at `i` or at another index. */
  readonly reads: Map<string, 'i' | 'shifted'>;
  /** The arrays written, and whether at `i` or at `2 * i`. */
  readonly writes: Map<string, 'i' | 'strided'>;
  /** The arrays written under an `if`. */
  readonly conditional: Set<string>;
  /** The arrays whose length the iteration names: a read at another index keeps in range by one. */
  readonly measures: Set<string>;
  /** Whether the loop has a `continue` of its own. */
  continues: boolean;
}

type CombineOp = '+' | '*' | '&' | '|' | '^' | 'min' | 'max';
interface Reduction {
  readonly name: string;
  readonly type: ShaderType;
  readonly op: CombineOp;
}

/** What an array of a generated kernel function holds. */
const ELEMS: readonly ShaderType[] = [f32T, i32T, u32T, vec2fT, vec3fT, vec4fT];
/** What a loop combines: every scalar, and the `f32` vectors component-wise. */
const REDUCE_TYPES: readonly ShaderType[] = [...SCALARS, vec2fT, vec4fT];
const FLOAT_COMBINES: readonly CombineOp[] = ['+', '*', 'min', 'max'];
const INT_COMBINES: readonly CombineOp[] = ['+', '*', '&', '|', '^', 'min', 'max'];
/** An integer element combined at any index, each lowered to its atomic. `*` has no atomic, so a
 *  scatter with it runs on the CPU; one in ten is generated. */
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

/** Structural type identity — two ShaderTypes are interchangeable iff this matches. */
function typeKey(t: ShaderType): string {
  return t.kind === 'scalar'
    ? `s:${t.scalar}`
    : t.kind === 'vec'
      ? `v:${t.n}:${t.elem}`
      : `o:${t.kind}`;
}

/** Generate one module from `seed`. Same seed ⇒ byte-identical module, forever. */
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
    // Only EARLIER functions are callable, so the call graph is a DAG and `no-recursion` holds.
    decls.push(gen.func(`f${i}`, ret, params, { stmts, depth, nest }, [...sigs]));
    sigs.push({ name: `f${i}`, ret, params });
  }
  return {
    module: { consts: [], structs: [], bindings: [], funcs: decls },
    seed,
    features: { ...gen.features },
  };
}

/** Merge the feature counts of a whole corpus — what the generator actually reached. */
export function describeCorpus(corpora: readonly Corpus[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of corpora)
    for (const [k, v] of Object.entries(c.features)) out[k] = (out[k] ?? 0) + v;
  return out;
}

// ═══ Kernel functions (#349): storage arrays, runtime-sized loops, reductions and scatters ═══
//
// `generateModule`'s helpers take and return values, so no array the caller owns, no loop over a
// runtime length, no reduction and no scatter reached a differential, and those are what a kernel
// function (Rule 8.22) is made of. `generateKernelModule` builds helpers and one kernel function
// `k` over arrays of scalars, `f32` vectors and a struct: scalar statements, then one or two
// loops over the length the arrays share, then a `return` of what the loops combined. The loops
// take the shapes the proof (`passes/parallel-loop.ts`) judges: a write at `i`, a variable
// combined with `+ * min max & | ^`, an integer element combined at any index, and now and then
// one the proof refuses (`refused*` in the features), so a refused loop's CPU path is generated
// as well as the accepted loop's lowering.
//
// Every index is in range by construction: `i` below the length every array but a scatter target
// shares, or `% arrayLength(...)`. An index past the end reads a different value on each target,
// which would be a finding about the generator, not the compiler. The caller keeps the lengths
// equal and nonzero (`KernelCorpus.arrays`). Its own PRNG stream leaves `generateModule`'s
// modules, and the seeds pinned against them, as they were.

/** What {@link generateKernelModule} was asked to build. Every field has a documented default. */
export interface KernelGenOptions {
  /** Helper functions the kernel function may call (default 3). */
  readonly helpers?: number;
  /** Loops in the kernel function (default: one, or two for 40% of seeds). */
  readonly loops?: number;
  /** Statements in a loop body besides its reads, writes and combines (default 2). */
  readonly stmts?: number;
  /** Maximum expression nesting (default 2). */
  readonly depth?: number;
  /** Only the operations WGSL gives one answer, as `GenOptions.exact` (default false). */
  readonly exact?: boolean;
}

/** A generated module whose kernel function is `kernel`, with the arrays it takes. A caller
 *  passes every array but a scatter target the same nonzero length, and a scatter target any
 *  nonzero length. */
export interface KernelCorpus extends Corpus {
  readonly kernel: string;
  readonly arrays: readonly KernelArray[];
}

/** Generate a module with one kernel function from `seed`. Same seed ⇒ the same module. */
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
      // A struct is one of seven element types; the first output holds it half the time, so
      // whole-struct and field writes are reached as often as the others.
      elem: n === 0 && structs.length > 0 && rnd() < 0.5 ? elems[elems.length - 1]! : pick(elems),
      role: 'out' as const,
    })),
    ...(rnd() < 0.7 ? [{ name: 'h0', elem: pick([i32T, u32T]), role: 'scatter' as const }] : []),
  ];
  const scalars = Array.from({ length: count(0, 2) }, (_, n) => ({
    name: `p${n}`,
    type: pick(SCALARS),
  }));
  const k = gen.kernel(
    'k',
    { arrays, scalars },
    new Map(structs.map((s) => [s.name, s])),
    { loops: opts.loops ?? (rnd() < 0.4 ? 2 : 1), stmts: opts.stmts ?? 2, depth: opts.depth ?? 2 },
    sigs,
  );
  return {
    module: { consts: [], structs, bindings: [], funcs: [...decls, k] },
    seed,
    features: { ...gen.features },
    kernel: 'k',
    arrays,
  };
}

// ═══ Chains of kernel calls (change 0058, steps 3b and D14): the input of the fuse planner ═══
//
// A fuse scope (`typeshade/fuse`) runs the kernel calls a body makes over `Resident` arrays as one
// plan, and fuses the consecutive calls the facts F1 to F6 allow into one dispatch. A chain is
// that body: 2 to 6 calls of kernel functions over arrays the caller keeps, in one module. Each
// function has one loop that the proof accepts and a fusion may take, built by the same generator
// as `generateKernelModule`'s (the same statements, the same expressions, helper calls among
// them), with no scatter and no statement the proof refuses. It reduces nothing, but in three
// chains of ten one call folds one variable or two (F6). A call's arrays are drawn so that the
// planner has something to decide:
//
//   - an input is an earlier call's output, an earlier input or a new array of the chain, so that
//     most chains have edges (a call reads what an earlier one wrote, at `i`);
//   - a call's first output is the array its loop is bounded by, and is new unless the chain
//     reuses one (F4: it writes an array an earlier call reads, or writes);
//   - a second output is now and then written at `2 * i`, or reuses an array, or is new;
//   - an input is now and then read at another index (F3), a loop now and then starts at 1 or 3,
//     steps by 2 or has a `continue` (F1, F2), and a call now and then runs over `m` iterations
//     when the rest of the chain runs over `n` (F2);
//   - a call that reduces is the last call of its chain in four chains of five that have one, and
//     earlier in the others, so that a call stands after it (F6). It writes one output or none,
//     and a loop with no output is bounded by an input.
//
// The chain records how each function reaches each array as it was BUILT (`ChainAccess`), apart
// from the proof that reads the function again at compile time. A test can then derive from the
// chain alone which calls the planner must group, and hold the facts the compiler wrote to it.
//
// A chain is built from `seed` and no other input. The lengths of its arrays are `n` and `m` at
// run time (`ChainLength`), and their contents are the caller's.
//
// SCRATCH. Once all the calls are drawn, the generator decides which arrays the host reads after
// the chain. Every other array of `f32`, `i32` or `u32` elements is a scratch array of the scope
// (`scope.scratch`, step 4 of the change), and at least one array a call writes is left to the
// host. A scratch array holds zeros when the plan starts, and the chain's reader leaves it out of
// what it compares. Whether the plan holds it as a local is the planner's rule (Rule 11.13), not
// the generator's: `modelGroups` (`fuse-chain.ts`) restates that rule over the chain as it was
// built. A call now and then names the length of a scratch array in its iteration (`t.length`),
// which keeps that array a buffer. The decisions of a reduction, of a scratch array and of a
// length come from a stream of their own, so that they do not move the draws of the rest of the
// chain.

/** How long an array of a chain is, in terms of the two trip counts a chain runs at: the call
 *  that bounds its loop by an array of `n` elements runs `n` iterations, and an array a call writes
 *  at `2 * i` holds twice as many. */
export interface ChainLength {
  readonly of: 'n' | 'm';
  readonly times: 1 | 2;
}

/** One array of a chain, known by its id. */
export interface ChainArray {
  readonly id: string;
  readonly elem: ShaderType;
  readonly length: ChainLength;
  /** Whether a call of the chain has it as an output. The chain's reader reads such an array
   *  back, unless it is a scratch array; an array that is only an input keeps its contents. */
  readonly written: boolean;
  /** Whether it is a scratch array of the scope: an intermediate the host never reads, which holds
   *  zeros when the plan starts. Only an array of `f32`, `i32` or `u32` elements is one. */
  readonly scratch: boolean;
}

/** What a function does to one of its array parameters, as it was built. */
export interface ChainAccess {
  readonly param: string;
  /** The array it is called with. */
  readonly array: string;
  readonly reads: 'none' | 'i' | 'shifted';
  readonly writes: 'none' | 'i' | 'strided';
  /** The write is under an `if`, so it leaves the old contents where the condition fails. */
  readonly conditional: boolean;
  /** The iteration names the array's length (`t.length`) and reads no element for it. A fused
   *  entry cannot hold such an array as a local, which has no length. */
  readonly measures: boolean;
}

/** One call of a chain. */
export interface ChainCall {
  /** The kernel function, a function of the chain's module. */
  readonly fn: string;
  /** The array length its loop is bounded by: it runs over `n` or `m` elements. */
  readonly over: 'n' | 'm';
  /** The loop's first counter value and its step. */
  readonly start: number;
  readonly step: number;
  /** One per parameter of the function, in order: the array of the chain it is called with, or
   *  the type of the scalar the caller passes. */
  readonly args: readonly (
    { readonly array: string } | { readonly scalar: ShaderType; readonly name: string }
  )[];
  /** One per array parameter, in order. */
  readonly access: readonly ChainAccess[];
  /** Whether the loop has a `continue` of its own. */
  readonly continues: boolean;
  /** How many variables its loop folds: none for a map, one or two for a call that reduces. */
  readonly reduces: number;
}

/** A generated chain: one module, and the calls to make in order. */
export interface ChainCorpus extends Corpus {
  readonly calls: readonly ChainCall[];
  readonly arrays: readonly ChainArray[];
}

/** What {@link generateChain} was asked to build. Every field has a documented default. */
export interface ChainGenOptions {
  /** Calls in the chain (default: 2 to 6). */
  readonly calls?: number;
  /** Only the operations WGSL gives one answer, as `GenOptions.exact` (default false). */
  readonly exact?: boolean;
}

/** Whether an array of `t` can be a scratch array: `scope.scratch` makes arrays of `f32`, `i32` and
 *  `u32`. */
const holdsScalars = (t: ShaderType): boolean =>
  t.kind === 'scalar' && (t.scalar === 'f32' || t.scalar === 'i32' || t.scalar === 'u32');

/** `fn` with `let len_<p> = arrayLength(<p>)` at the head of the body of its loop, for each array
 *  parameter `p` in `names`: the iteration names the array's length. Nothing reads the value. */
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

/** Generate a chain from `seed`. Same seed ⇒ the same module and the same calls. */
export function generateChain(seed: number, opts: ChainGenOptions = {}): ChainCorpus {
  const gen = new Gen(mulberry32(seed ^ 0x3c6ef372), opts.exact ?? false);
  const rnd = mulberry32(seed ^ 0x1f83d9ab);
  // The decisions of a reduction, of a scratch array and of a length read come from a stream of
  // their own, so that they do not move the draws of the rest of the chain.
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
  // An element type for a new array: `f32` for two in five, so that a chain has edges to fuse.
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
  // Of the arrays free to take, one of the latest: the output of a call just before is the likeliest.
  const recent = <T>(xs: readonly T[]): T =>
    xs[xs.length - 1 - Math.floor(rnd() * rnd() * xs.length)]!;

  const calls: ChainCall[] = [];
  const total = opts.calls ?? count(2, 6);
  // A reduction (F6) in three chains of ten: at the last call in four of five, and earlier in the
  // others, so that a call stands after it. It folds one variable, or two in three of ten.
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
    // The first output bounds the loop, so it is `over` elements long. It is a new array unless the
    // chain reuses one of that length: then the call writes what an earlier call read or wrote. A
    // call that reduces writes one output in three of ten, and none otherwise: then an input of
    // that length bounds its loop.
    const outs: (typeof arrays)[number][] = [];
    if (reduces === 0 || chance(0.3)) {
      const reusable = free().filter((a) => a.length.times === 1);
      outs.push(
        take(reusable.length > 0 && chance(0.1) ? recent(reusable) : fresh(elemOf(), over, 1)),
      );
    } else if (!ins.some((a) => a.length.times === 1)) ins.unshift(take(fresh(elemOf(), over, 1)));
    let stride: string | undefined;
    if (reduces === 0 && chance(0.5)) {
      // A second output: written at `2 * i` into a new array twice as long, or an array of the
      // chain, or a new array.
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

  // SCRATCH: the arrays the host never reads after the chain, now that all the calls are drawn. An
  // array a call writes is one the host reads in half the draws, and an array no call writes, which
  // a scratch array holds as zeros, is one in about one draw in eight.
  for (const a of arrays) a.scratch = holdsScalars(a.elem) && extra() < (a.written ? 0.5 : 0.12);
  // The host reads at least one array a call writes, or the chain would compare nothing it wrote.
  if (!arrays.some((a) => a.written && !a.scratch))
    for (let i = arrays.length - 1; i >= 0; i--)
      if (arrays[i]!.written) {
        arrays[i]!.scratch = false;
        break;
      }
  // A call now and then names the length of a scratch array it reaches.
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
