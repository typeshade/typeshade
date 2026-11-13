// A differential test of the written-integer rules of issue 1261 (change 0134, D-b, Amendment
// A6; the owner's decision of 2026-11-12, D1: "build a differential test first, then fix").
//
// A fixed-seed generator writes `"use typeshade"` programs over bit trees (negative ones among
// them), untyped constants (module, function-local, imported, and defined through others), a
// module `let`, `let` chains (annotated or not) with reassignment and compound assignment
// (quotients and trees on the right), loops, struct fields, arrays, vectors, extra functions
// (typed, untyped and exported), builtins, `?:` and `select` arms holding trees, written
// conversions alone and inside arithmetic, typed peers and the operators
// `/ % < <= > >= == != >> >>> + - * & | ^ << ~` and unary minus, with an `f32`, `i32` or `u32`
// result. The fourteenth review added: plain reassignments (also inside `for` and `if`), a
// reassigned module `let`, a generic function, a function with a `u32` parameter, functions that
// return trees (through a binding and a builtin) and the uses derived from them, an imported
// function, compound assignment to a swizzle, module constants with a bare `| & ^` root, and
// libraries whose own refusals name edits in the imported file. Three properties hold:
//
//   1. Where `compile()` accepts a program with no diagnostic, the CPU oracle's value is the value
//      the same source has as TypeScript, with `i32()` ToInt32 of the truncation, `u32()`
//      ToUint32 of it, `f32()` `Math.fround`, and a value whose type is declared (a parameter, a
//      conversion, an annotation) computing in that type (an integer `/` truncates, an integer
//      result wraps). A written number and a value of no declared type keep TypeScript's value
//      (OD-7, Rule 5.1); once such a value is no integer, the author's TypeScript keeps the
//      double. Integer results compare exactly; an `f32` compares after `Math.fround` on both
//      sides, exactly where it is an integer of at most 2^24.
//      A value of no declared type stored in a declared integer (a declaration, an assignment, a
//      parameter, a result) is truncated where it is no integer (Amendment A4), and is its bits
//      where only the other integer type holds it (C3: `let x: u32 = 3000000000 | 0`).
//   2. In each file of the program, the editor's diagnostics (`checkDocuments`) are exactly the
//      diagnostics `compile()` gives that file: the same codes and the same text (Rule 12.7).
//   3. Every edit the refusals name (a division's, a value with two readings', a `>>`'s, a value
//      form, a declaration with its type), made together at its diagnostic's place in whichever
//      file it stands, adds no error in either half: each file's errors after the edits are its
//      other errors before them, by line and text (Amendment A6, "name only verified edits").
//      Where the program's one error names no edit, each wrap or declaration its generic remedy
//      offers removes that error and adds none on its line; an error it adds on another line is
//      a use that asks the other type, which D4 of 2026-11-12 leaves to the generic text.

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { checkDocuments } from '../../language-service/check.js';

/** mulberry32: a small generator with a fixed seed, so the corpus is the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type T = 'k' | 'i32' | 'u32' | 'f32' | 'bool';
interface V {
  readonly t: T;
  readonly v: number;
}
/** The value is not a program TypeScript and the rules agree on: no comparison is made. */
class Skip extends Error {}

const INPUTS = { ii: -3, vi: 7, f: 2.5 } as const;
/** The imported file: the same exports in each, and in three of them one more that the file
 *  itself refuses, so that an edit lands in the imported file. */
const LIB_BASE =
  '"use typeshade";\nexport const L = 3;\nexport const LB = 0xF0000000 | 0;\n' +
  'export const LK = 1 | 2;\nexport function lg() {\n  return 6 ^ 3;\n}\n';
const LIBS = [
  LIB_BASE,
  `${LIB_BASE}export const LQ = (1|2)/2;\n`,
  `${LIB_BASE}export function lh() {\n  return (5|0)/2;\n}\n`,
  `${LIB_BASE}export const LS = 0xF0000000 >> 28;\n`,
] as const;

const inRange = (t: 'i32' | 'u32', x: number): boolean =>
  t === 'u32' ? x >= 0 && x <= 4294967295 : x >= -(2 ** 31) && x <= 2 ** 31 - 1;
const wrap = (t: T, x: number): number => {
  if (!Number.isFinite(x)) throw new Skip('not finite');
  // An f32 past 2^24 that rounds in an operation rounds differently in the oracle's and in
  // TypeScript's doubles: no comparison is made there.
  if (t === 'f32' && Math.abs(x) > 2 ** 24 && Math.fround(x) !== x) throw new Skip('f32 precision');
  return t === 'i32' ? x | 0 : t === 'u32' ? x >>> 0 : t === 'f32' ? Math.fround(x) : x;
};
/** A conversion to `to`, as the author's TypeScript computes it. A float outside the integer
 *  type converts as WGSL defines it (it saturates), which the language refuses where it is
 *  constant (Rule 5.4): no comparison is made there. */
function convert(to: 'i32' | 'u32' | 'f32', x: V): number {
  if (to === 'f32') return Math.fround(x.v);
  if ((x.t === 'f32' || !Number.isInteger(x.v)) && !inRange(to, Math.trunc(x.v))) {
    throw new Skip('float conversion out of range');
  }
  // A value of no declared type that no use decides is an `f32` (Rule 5.1): one outside the
  // integer type converts as a float does. No comparison (an open item of #1272).
  if (x.t === 'k' && !inRange(to, x.v)) throw new Skip('untyped value out of range');
  return to === 'i32' ? Math.trunc(x.v) | 0 : Math.trunc(x.v) >>> 0;
}
/** A value stored in a position that declares the integer type `to`: a declaration, an
 *  assignment, a parameter, a result. One of no declared type is truncated where it is no
 *  integer (Amendment A4), and is its bits where only the other integer type holds it (C3: the
 *  annotation ends the origin, `let x: u32 = 3000000000 | 0` is 3000000000). */
function store(to: 'i32' | 'u32', x: V): number {
  if (x.t !== 'k') return convert(to, x);
  const v = Math.trunc(x.v);
  if (inRange(to, v)) return to === 'i32' ? v | 0 : v >>> 0;
  if (to === 'u32' && v < 0 && v >= -(2 ** 31)) return v >>> 0;
  if (to === 'i32' && v > 2 ** 31 - 1 && v <= 2 ** 32 - 1) return v | 0;
  throw new Skip('stored value out of range');
}
const popcount = (x: number): number => {
  let n = x >>> 0;
  let c = 0;
  while (n !== 0) {
    c += n & 1;
    n >>>= 1;
  }
  return c;
};

/** The type two operands compute in: the declared one, or none where both have none. */
function unify(a: V, b: V): T {
  if (a.t === 'bool' || b.t === 'bool') throw new Skip('bool operand');
  if (a.t === 'k') return b.t;
  if (b.t === 'k' || a.t === b.t) return a.t;
  throw new Skip('two declared types');
}

const COMPARE = new Set(['<', '<=', '>', '>=', '==', '!=']);

function binary(op: string, a: V, b: V): V {
  if (COMPARE.has(op)) {
    unify(a, b);
    const [x, y] = [a.v, b.v];
    const r =
      op === '<'
        ? x < y
        : op === '<='
          ? x <= y
          : op === '>'
            ? x > y
            : op === '>='
              ? x >= y
              : op === '=='
                ? x === y
                : x !== y;
    return { t: 'bool', v: r ? 1 : 0 };
  }
  if (op === '>>>') throw new Skip('>>> is refused');
  // A shift computes in its left operand's type.
  const t = op === '<<' || op === '>>' ? a.t : unify(a, b);
  if (t === 'bool') throw new Skip('bool');
  const [x, y] = [a.v, b.v];
  if (t === 'f32' && ['&', '|', '^', '<<', '>>'].includes(op)) throw new Skip('f32 bits');
  // A value of no declared type that is no integer keeps TypeScript's double, beside a declared
  // integer too: the author's TypeScript never truncates it.
  const integer = (t === 'i32' || t === 'u32') && Number.isInteger(x) && Number.isInteger(y);
  const out: T = (t === 'i32' || t === 'u32') && !integer ? 'k' : t;
  let r: number;
  switch (op) {
    case '+':
      r = x + y;
      break;
    case '-':
      r = x - y;
      break;
    case '*':
      r = integer ? Math.imul(x | 0, y | 0) : x * y;
      break;
    case '/':
      if (y === 0) throw new Skip('zero');
      r = integer ? Math.trunc(x / y) : x / y;
      break;
    case '%':
      if (y === 0) throw new Skip('zero');
      r = x % y;
      break;
    case '&':
      r = x & y;
      break;
    case '|':
      r = x | y;
      break;
    case '^':
      r = x ^ y;
      break;
    case '<<':
      r = x << (y & 31);
      break;
    default:
      r = t === 'u32' ? (x >>> 0) >>> (y & 31) : x >> (y & 31);
  }
  // An integer of no declared type past both integer types wraps where its uses type it, as
  // every integer of an inferred type does (Rule 5.1): no comparison there.
  if (out === 'k' && Number.isInteger(r) && !inRange('i32', r) && !inRange('u32', r)) {
    throw new Skip('untyped integer past both types');
  }
  return { t: out, v: wrap(out, r) };
}

/** One generated expression: its source text and its reference value. */
interface Expr {
  readonly text: string;
  readonly value: () => V;
}

const lit = (n: number, text = String(n)): Expr => ({ text, value: () => ({ t: 'k', v: n }) });

class Program {
  readonly lines: string[] = [];
  readonly pre: string[] = [];
  readonly env = new Map<string, V>();
  readonly steps: (() => void)[] = [];
  readonly names: string[] = [];
  readonly fns: {
    name: string;
    call: (args: Expr[]) => Expr;
    arity: number;
    /** The types its arguments are drawn with. */
    args?: readonly T[];
    /** Whether it returns a tree of written integers (a call of it is one, `treeish`). */
    tree?: boolean;
  }[] = [];
  /** Which of {@link LIBS} the program imports from. */
  lib = 0;
  constructor(readonly r: () => number) {}
  pick<X>(xs: readonly X[]): X {
    return xs[Math.floor(this.r() * xs.length)]!;
  }
  chance(p: number): boolean {
    return this.r() < p;
  }

  /** A bit tree of written integers, a negative one among them. */
  tree(): Expr {
    return this.pick([
      () => lit(0xf0000000 | 0, '(0xF0000000|0)'),
      () => lit(3000000000 | 0, '(3000000000|0)'),
      () => lit(-7 | 0, '(-7|0)'),
      () => lit(5 | 0, '(5|0)'),
      () => lit(1 | 2, '(1|2)'),
      () => lit(1 << 3, '(1<<3)'),
      () => lit(6 ^ 3, '(6^3)'),
      () => lit(~2, '(~2)'),
      () => lit(-(5 | 0), '(-(5|0))'),
      () => lit(~(1 | 2), '(~(1|2))'),
    ])();
  }

  /** A quotient of written integers that is no integer: D-b's case. */
  quotient(): Expr {
    return this.pick([
      () => lit(2.5, '((5|0)/2)'),
      () => lit(8 / 3, '((1<<3)/3)'),
      () => lit(1.5, '((1|2)/2)'),
    ])();
  }

  /** A tree, or a call of a function that returns one (F1 of the fourteenth review). */
  treeish(): Expr {
    const fs = this.fns.filter((f) => f.tree === true);
    if (fs.length > 0 && this.chance(0.5)) return this.pick(fs).call([]);
    if (this.fns.some((f) => f.name === 'id') && this.chance(0.2)) {
      return this.fns.find((f) => f.name === 'id')!.call([this.tree()]);
    }
    return this.tree();
  }

  name(n: string): Expr {
    return {
      text: n,
      value: () => {
        const v = this.env.get(n);
        if (v === undefined) throw new Skip(`unbound ${n}`);
        return v;
      },
    };
  }

  leaf(t: T): Expr {
    if (t === 'i32') {
      return this.pick([() => this.name('ii'), () => this.conv('i32', this.leaf('k'))])();
    }
    if (t === 'u32') {
      return this.pick([() => this.name('vi'), () => this.conv('u32', this.leaf('k'))])();
    }
    if (t === 'f32') {
      return this.pick([() => this.name('f'), () => this.conv('f32', this.leaf('k'))])();
    }
    const known = this.names.filter((k) => this.declared(k) === 'k');
    return this.pick([
      () => lit(this.pick([2, 3, 4, 7, 9])),
      () => this.tree(),
      () => this.tree(),
      () => (known.length > 0 ? this.name(this.pick(known)) : lit(4)),
    ])();
  }

  /** The kind of a name as written: `k` for one of no declared type. */
  readonly kinds = new Map<string, T>();
  declared(n: string): T | undefined {
    return this.kinds.get(n);
  }

  conv(to: 'i32' | 'u32' | 'f32', a: Expr): Expr {
    return { text: `${to}(${a.text})`, value: () => ({ t: to, v: convert(to, a.value()) }) };
  }

  bin(op: string, a: Expr, b: Expr): Expr {
    return { text: `(${a.text} ${op} ${b.text})`, value: () => binary(op, a.value(), b.value()) };
  }

  unary(op: '-' | '~', a: Expr): Expr {
    return {
      text: `(${op}${a.text})`,
      value: () => {
        const x = a.value();
        if (x.t === 'bool') throw new Skip('bool');
        if (op === '~') {
          if (x.t === 'f32') throw new Skip('f32 bits');
          return { t: x.t, v: wrap(x.t, ~x.v) };
        }
        if (x.t === 'u32') throw new Skip('negated u32');
        return { t: x.t, v: wrap(x.t, -x.v) };
      },
    };
  }

  call(fn: string, args: Expr[]): Expr {
    return {
      text: `${fn}(${args.map((a) => a.text).join(', ')})`,
      value: () => {
        const vs = args.map((a) => a.value());
        if (fn === 'select') {
          if (vs[2]!.t !== 'bool') throw new Skip('select');
          const t = unify(vs[0]!, vs[1]!);
          return { t, v: vs[2]!.v ? vs[1]!.v : vs[0]!.v };
        }
        const t = vs.slice(1).reduce((acc, v) => unify({ t: acc, v: 0 }, v), vs[0]!.t);
        const xs = vs.map((v) => v.v);
        if (t === 'bool') throw new Skip('bool');
        switch (fn) {
          case 'abs':
            return { t, v: wrap(t, Math.abs(xs[0]!)) };
          case 'sign':
            if (t === 'u32') throw new Skip('sign u32');
            return { t, v: Math.sign(xs[0]!) };
          case 'countOneBits':
            if (t === 'f32' || !Number.isInteger(xs[0]!)) throw new Skip('bits');
            return { t, v: popcount(xs[0]!) };
          case 'min':
            return { t, v: wrap(t, Math.min(xs[0]!, xs[1]!)) };
          case 'max':
            return { t, v: wrap(t, Math.max(xs[0]!, xs[1]!)) };
          default:
            if (xs[1]! > xs[2]!) throw new Skip('clamp bounds');
            return { t, v: wrap(t, Math.min(Math.max(xs[0]!, xs[1]!), xs[2]!)) };
        }
      },
    };
  }

  cond(c: Expr, a: Expr, b: Expr): Expr {
    return {
      text: `(${c.text} ? ${a.text} : ${b.text})`,
      value: () => {
        const cv = c.value();
        if (cv.t !== 'bool') throw new Skip('cond');
        const [x, y] = [a.value(), b.value()];
        const t = unify(x, y);
        return { t, v: cv.v ? x.v : y.v };
      },
    };
  }

  /** A component of a vector built from two values: each is converted to the element type. */
  vector(t: 'u32' | 'i32'): Expr {
    const [a, b] = [this.expr(t, 1), this.expr('k', 1)];
    const which = this.pick(['x', 'y', 'yx.x']);
    const ctor = t === 'u32' ? 'vec2u' : 'vec2i';
    return {
      text: `${ctor}(${a.text}, ${b.text}).${which}`,
      value: () => {
        const parts = [a.value(), b.value()].map((v) => {
          if (v.t !== 'k' && v.t !== t) throw new Skip('vector element');
          if (!Number.isInteger(v.v) || !inRange(t, v.v)) throw new Skip('vector element value');
          return v.v;
        });
        return { t, v: which === 'x' ? parts[0]! : parts[1]! };
      },
    };
  }

  /** An expression of type `t` (or of no declared type, `k`), `depth` levels deep. */
  expr(t: T, depth: number): Expr {
    if (depth <= 0 || this.chance(0.22)) return this.leaf(t);
    const peer = (): T => (t === 'k' || this.chance(0.4) ? 'k' : t);
    const kind = this.r();
    if (kind < 0.45) {
      const ops =
        t === 'f32'
          ? ['/', '%', '+', '-', '*']
          : ['/', '/', '%', '+', '-', '*', '&', '|', '^', '<<', '>>', '>>', '>>>'];
      const op = this.pick(ops);
      const side = this.chance(0.5);
      const a = this.expr(side ? t : peer(), depth - 1);
      const shift = op === '<<' || op === '>>' || op === '>>>';
      const b = shift
        ? this.pick([() => lit(this.pick([1, 2, 4])), () => this.name('vi'), () => this.tree()])()
        : this.expr(side ? peer() : t, depth - 1);
      return this.bin(op, a, b);
    }
    if (kind < 0.55 && t !== 'f32')
      return this.unary(this.pick(['-', '~'] as const), this.expr(t, depth - 1));
    if (kind < 0.67) {
      const fn = this.pick(['abs', 'min', 'max', 'clamp', 'countOneBits', 'sign', 'select']);
      if (fn === 'select') {
        return this.call('select', [
          this.expr(peer(), depth - 1),
          this.chance(0.5) ? this.tree() : this.expr(t, depth - 1),
          this.compare(depth - 1),
        ]);
      }
      if (fn === 'clamp') {
        return this.call('clamp', [this.expr(t, depth - 1), lit(0), lit(this.pick([5, 9, 100]))]);
      }
      if (fn === 'min' || fn === 'max') {
        return this.call(fn, [this.expr(t, depth - 1), this.expr(peer(), depth - 1)]);
      }
      return this.call(fn, [this.expr(t, depth - 1)]);
    }
    if (kind < 0.77) {
      return this.cond(
        this.compare(depth - 1),
        this.chance(0.5) ? this.tree() : this.expr(t, depth - 1),
        this.expr(peer(), depth - 1),
      );
    }
    if (kind < 0.83 && (t === 'u32' || t === 'i32')) return this.vector(t);
    if (kind < 0.9 && this.fns.length > 0) {
      const f = this.pick(this.fns);
      return f.call(
        Array.from({ length: f.arity }, (_, i) =>
          this.expr(f.args?.[i] ?? this.pick<T>(['k', 'i32']), depth - 1),
        ),
      );
    }
    if (kind < 0.96 && t !== 'k' && t !== 'bool') {
      // A written conversion inside arithmetic: `i32(2) + 1`.
      return this.bin(this.pick(['+', '-']), this.conv(t, lit(2)), lit(1));
    }
    return this.leaf(t);
  }

  compare(depth: number): Expr {
    const t = this.pick<T>(['k', 'i32', 'u32']);
    return this.bin(
      this.pick(['<', '<=', '>', '>=', '==', '!=']),
      this.expr(t, depth),
      this.expr('k', depth),
    );
  }

  /** Declares the untyped constants, the module `let`, and the extra functions. */
  prelude(): void {
    if (this.chance(0.4)) {
      const e = this.tree();
      this.pre.push(`const K = ${e.text};`);
      this.bind('K', 'k', () => e.value());
      if (this.chance(0.4)) {
        const d = this.bin(this.pick(['+', '*', '|']), this.name('K'), lit(this.pick([1, 3, 7])));
        this.pre.push(`const K2 = ${d.text};`);
        this.bind('K2', 'k', () => d.value());
      }
    }
    // A module constant whose root is a bare `|`, `&` or `^` over written integers (F7).
    if (this.chance(0.2)) {
      const [a, op, b] = this.pick([
        [1, '|', 2],
        [6, '^', 3],
        [12, '&', 5],
      ] as const);
      const v = op === '|' ? a | b : op === '^' ? a ^ b : a & b;
      this.pre.push(`const KB = ${String(a)} ${op} ${String(b)};`);
      this.bind('KB', 'k', () => ({ t: 'k', v }));
    }
    if (this.chance(0.2)) {
      const e = this.tree();
      this.pre.push(`let M = ${e.text};`);
      this.bind('M', 'k', () => e.value());
    }
    if (this.chance(0.3)) {
      // One library in four refuses an export of its own (an edit lands in the imported file).
      this.lib = this.chance(0.6) ? 0 : 1 + Math.floor(this.r() * (LIBS.length - 1));
      const extra = this.lib === 1 ? ', LQ' : this.lib === 2 ? ', lh' : '';
      this.pre.unshift(`import { L, LB, LK, lg${extra} } from "./lib.shade";`);
      this.bind('L', 'k', () => ({ t: 'k', v: 3 }));
      this.bind('LB', 'k', () => ({ t: 'k', v: 0xf0000000 | 0 }));
      this.bind('LK', 'k', () => ({ t: 'k', v: 3 }));
      if (this.lib === 1) this.bind('LQ', 'f32', () => ({ t: 'f32', v: 1.5 }));
      this.fns.push({
        name: 'lg',
        arity: 0,
        tree: true,
        call: () => ({ text: 'lg()', value: () => ({ t: 'k', v: 6 ^ 3 }) }),
      });
      if (this.lib === 2) {
        this.fns.push({
          name: 'lh',
          arity: 0,
          call: () => ({ text: 'lh()', value: () => ({ t: 'f32', v: 2.5 }) }),
        });
      }
    }
    if (this.chance(0.2)) {
      this.pre.push('function id<T>(a: T): T {\n  return a;\n}');
      this.fns.push({
        name: 'id',
        arity: 1,
        args: [this.pick<T>(['k', 'i32', 'u32'])],
        call: (args) => ({ text: `id(${args[0]!.text})`, value: () => args[0]!.value() }),
      });
    }
    if (this.chance(0.2)) {
      this.pre.push('function hu(a: u32): u32 {\n  return a + 1;\n}');
      this.fns.push({
        name: 'hu',
        arity: 1,
        args: [this.pick<T>(['k', 'u32'])],
        call: (args) => ({
          text: `hu(${args[0]!.text})`,
          value: () => {
            const a = args[0]!.value();
            if (a.t !== 'k' && a.t !== 'u32') throw new Skip('argument type');
            return { t: 'u32', v: (store('u32', a) + 1) >>> 0 };
          },
        }),
      });
    }
    if (this.chance(0.2)) {
      const e = this.tree();
      this.pre.push(`function gg2() {\n  let x = ${e.text};\n  return x;\n}`);
      this.fns.push({
        name: 'gg2',
        arity: 0,
        tree: true,
        call: () => ({ text: 'gg2()', value: e.value }),
      });
    }
    if (this.chance(0.2)) {
      const e = this.tree();
      this.pre.push(`function gg3() {\n  return abs(${e.text});\n}`);
      const a = this.call('abs', [e]);
      this.fns.push({
        name: 'gg3',
        arity: 0,
        tree: true,
        call: () => ({ text: 'gg3()', value: a.value }),
      });
    }
    if (this.chance(0.3)) {
      this.pre.push('function hh(a: i32): i32 {\n  return a + 1;\n}');
      this.fns.push({
        name: 'hh',
        arity: 1,
        call: (args) => ({
          text: `hh(${args[0]!.text})`,
          value: () => {
            const a = args[0]!.value();
            if (a.t !== 'k' && a.t !== 'i32') throw new Skip('argument type');
            // A parameter states its type: a quotient passed to it is truncated (A4).
            return { t: 'i32', v: (store('i32', a) + 1) | 0 };
          },
        }),
      });
    }
    if (this.chance(0.3)) {
      const e = this.tree();
      const exported = this.chance(0.4);
      this.pre.push(`${exported ? 'export ' : ''}function gg() {\n  return ${e.text};\n}`);
      this.fns.push({
        name: 'gg',
        arity: 0,
        tree: true,
        call: () => ({
          text: 'gg()',
          // The module's own calls of an exported function read its integer copy (Amendment
          // A5); the host reads the `f32`.
          value: () => e.value(),
        }),
      });
    }
  }

  bind(n: string, kind: T, value: () => V): void {
    this.names.push(n);
    this.kinds.set(n, kind);
    this.steps.push(() => this.env.set(n, value()));
  }

  /** An assignment to a target of type `t` (`k`: no declared type): its new value. */
  assign(t: T, before: V, op: string | undefined, rhs: V): V {
    const next = op === undefined ? rhs : binary(op, before, rhs);
    if (t === 'k') return next;
    if (next.t !== 'k' && next.t !== t) throw new Skip('assignment type');
    // A declared integer target truncates a quotient where it is written to it whole (A4);
    // a compound assignment keeps the author's double (B1).
    if (op !== undefined && !Number.isInteger(next.v) && t !== 'f32') return { t: 'k', v: next.v };
    return { t, v: t === 'f32' ? Math.fround(next.v) : store(t as 'i32' | 'u32', next) };
  }

  /** The program as source, and its reference value (`undefined`: no comparison is made). */
  build(): { source: string; value: number | undefined; lib: number } {
    for (const [k, v] of Object.entries(INPUTS)) {
      this.env.set(k, { t: k === 'ii' ? 'i32' : k === 'vi' ? 'u32' : 'f32', v });
    }
    this.prelude();
    if (this.chance(0.4)) {
      const e = this.pick([() => lit(this.pick([4, 7])), () => this.tree()])();
      this.lines.push(`const k = ${e.text};`);
      this.bind('k', 'k', () => e.value());
      if (this.chance(0.3)) {
        const d = this.bin(this.pick(['+', '*', '|']), this.name('k'), lit(this.pick([1, 7])));
        this.lines.push(`const k2 = ${d.text};`);
        this.bind('k2', 'k', () => d.value());
      }
    }
    const result = this.pick<T>(['f32', 'i32', 'u32']);
    // A reassigned module `let` (F2 of the fourteenth review).
    if (this.names.includes('M') && this.chance(0.4)) {
      const rhs = this.pick([
        () => this.tree(),
        () => lit(3000000000 | 0, '(3000000000|0)'),
        () => this.bin('|', this.name('M'), lit(0)),
        () => this.expr('k', 1),
      ])();
      this.lines.push(`M = ${rhs.text};`);
      this.steps.push(() =>
        this.env.set('M', this.assign('k', this.env.get('M')!, undefined, rhs.value())),
      );
    }
    const form = this.r();
    let ret: Expr;
    if (form < 0.45) {
      // A `let` chain, annotated or not, with a reassignment or a compound assignment.
      const annotated = this.chance(0.25) ? this.pick<T>(['i32', 'u32', 'f32']) : undefined;
      const ty = annotated ?? this.pick<T>(['k', 'k', 'k', 'k', 'i32', 'u32', 'f32']);
      const init = this.chance(0.4)
        ? this.pick([
            () => this.treeish(),
            () => this.call('abs', [this.treeish()]),
            () => this.call('min', [this.treeish(), lit(9)]),
            () => this.call('sign', [this.treeish()]),
            () => this.call('select', [lit(3), this.treeish(), this.compare(0)]),
            () => this.cond(this.compare(0), this.treeish(), lit(3)),
          ])()
        : this.expr(annotated ?? ty, 2);
      this.lines.push(`let a${annotated !== undefined ? `: ${annotated}` : ''} = ${init.text};`);
      const target: T = annotated ?? 'k';
      this.bind('a', target, () => this.assign(target, { t: 'k', v: 0 }, undefined, init.value()));
      if (this.chance(0.4)) {
        this.lines.push('let b = a;');
        this.bind('b', 'k', () => this.env.get('a')!);
      }
      // A plain reassignment, alone or inside `for` or `if` (F2 of the fourteenth review).
      if (this.chance(0.35)) {
        const rhs = this.pick([
          () => this.treeish(),
          () => lit(3000000000 | 0, '(3000000000|0)'),
          () => this.expr(this.pick<T>(['k', result]), 1),
          () => this.bin(this.pick(['+', '|']), this.name('a'), this.tree()),
          () => this.call('select', [lit(1), this.tree(), this.compare(0)]),
        ])();
        const where = this.pick(['plain', 'for', 'if'] as const);
        const stmt = `a = ${rhs.text};`;
        this.lines.push(
          where === 'plain'
            ? stmt
            : where === 'for'
              ? `for (let i = 0; i < 2; i++) {\n    ${stmt}\n  }`
              : `if (vi > 3) {\n    ${stmt}\n  }`,
        );
        this.steps.push(() => {
          for (let i = 0; i < (where === 'for' ? 2 : 1); i++) {
            this.env.set('a', this.assign(target, this.env.get('a')!, undefined, rhs.value()));
          }
        });
      }
      if (this.chance(0.7)) {
        const op = this.pick(['/', '/', '%', '>>', '+', '*', '-']);
        const rhs = this.pick([
          () => lit(this.pick([2, 3, 4])),
          () => this.quotient(),
          () => this.tree(),
          () =>
            this.name(this.pick(['vi', 'ii', ...this.names.filter((n) => n !== 'a' && n !== 'b')])),
          () => this.conv(this.pick(['i32', 'u32', 'f32'] as const), lit(2)),
          () => this.bin('+', this.conv(this.pick(['i32', 'u32', 'f32'] as const), lit(2)), lit(1)),
        ])();
        const compound = this.chance(0.5);
        this.lines.push(compound ? `a ${op}= ${rhs.text};` : `a = a ${op} ${rhs.text};`);
        this.steps.push(() => {
          const before = this.env.get('a')!;
          const t = before.t === 'k' || target === 'k' ? (target === 'k' ? 'k' : target) : before.t;
          this.env.set('a', this.assign(t, before, op, rhs.value()));
        });
      }
      const use = this.chance(0.5)
        ? this.name(this.chance(0.5) && this.names.includes('b') ? 'b' : 'a')
        : this.expr(result, 1);
      ret = this.chance(0.5)
        ? this.bin(this.pick(['/', '+', '*', '%', '-']), this.name('a'), use)
        : use;
    } else if (form < 0.55) {
      // A loop that accumulates.
      const e = this.expr(this.pick<T>(['k', result]), 2);
      const op = this.pick(['+', '*', '-', '/']);
      this.lines.push(`let s = ${this.pick(['0', '1', 'vi', 'ii'])};`);
      const start = this.lines.at(-1)!.split('= ')[1]!.replace(';', '');
      this.lines.push(`for (let i = 0; i < 3; i++) {\n    s ${op}= ${e.text};\n  }`);
      this.steps.push(() => {
        let s: V =
          start === 'vi' || start === 'ii' ? this.env.get(start)! : { t: 'k', v: Number(start) };
        for (let i = 0; i < 3; i++) s = this.assign(s.t === 'k' ? 'k' : s.t, s, op, e.value());
        this.env.set('s', s);
      });
      ret = this.name('s');
    } else if (form < 0.65) {
      // A struct field, written whole or by a compound assignment.
      this.pre.push(`class P {\n  x: ${result === 'f32' ? 'f32' : result} = 0;\n}`);
      const e = this.chance(0.3) ? this.quotient() : this.expr(this.pick<T>(['k', result]), 2);
      const op = this.chance(0.5) ? undefined : this.pick(['+', '*', '/']);
      this.lines.push('let p = new P();');
      this.lines.push(op === undefined ? `p.x = ${e.text};` : `p.x ${op}= ${e.text};`);
      this.steps.push(() =>
        this.env.set('p.x', this.assign(result, { t: result, v: 0 }, op, e.value())),
      );
      ret = { text: 'p.x', value: () => this.env.get('p.x')! };
    } else if (form < 0.73) {
      // An array element.
      const el: T = result === 'u32' ? 'u32' : 'i32';
      const e = this.chance(0.3) ? this.quotient() : this.expr(this.pick<T>(['k', el]), 2);
      const op = this.chance(0.5) ? undefined : this.pick(['+', '*']);
      this.lines.push(`let xs: array<${el}, 2> = [1, 2];`);
      this.lines.push(op === undefined ? `xs[1] = ${e.text};` : `xs[1] ${op}= ${e.text};`);
      this.steps.push(() => this.env.set('xs1', this.assign(el, { t: el, v: 2 }, op, e.value())));
      ret = { text: 'xs[1]', value: () => this.env.get('xs1')! };
    } else if (form < 0.79) {
      // A compound assignment to a component of a vector.
      const el: T = result === 'u32' ? 'u32' : 'i32';
      const lane = this.pick(['x', 'y'] as const);
      const e = this.chance(0.3) ? this.quotient() : this.expr(this.pick<T>(['k', el]), 2);
      const op = this.pick(['+', '*', '-']);
      this.lines.push(`let v = ${el === 'u32' ? 'vec2u' : 'vec2i'}(1, 2);`);
      this.lines.push(`v.${lane} ${op}= ${e.text};`);
      this.steps.push(() =>
        this.env.set('vl', this.assign(el, { t: el, v: lane === 'x' ? 1 : 2 }, op, e.value())),
      );
      ret = { text: `v.${lane}`, value: () => this.env.get('vl')! };
    } else {
      ret = this.expr(this.pick<T>(['k', 'k', result]), 3);
    }
    const wrapped = this.chance(0.45);
    this.lines.push(`return ${wrapped ? `${result}(${ret.text})` : ret.text};`);
    const source =
      '"use typeshade";\n' +
      (this.pre.length > 0 ? `${this.pre.join('\n')}\n` : '') +
      `export function t(ii: i32, vi: u32, f: f32): ${result} {\n  ${this.lines.join('\n  ')}\n}\n`;
    let expected: number | undefined;
    try {
      for (const s of this.steps) s();
      const v = ret.value();
      if (v.t === 'bool') throw new Skip('bool result');
      if (!wrapped && v.t !== 'k' && v.t !== result) throw new Skip('result type');
      // A result states its type (C3: a value of no declared type is stored as its bits there);
      // a written conversion converts.
      expected =
        result === 'f32'
          ? Math.fround(v.v)
          : wrapped
            ? convert(result as 'i32' | 'u32', v)
            : store(result as 'i32' | 'u32', v);
    } catch (e) {
      if (!(e instanceof Skip)) throw e;
      expected = undefined;
    }
    return { source, value: expected, lib: this.lib };
  }
}

const FILE = '/p/a.shade.ts';
const LIB_FILE = '/p/lib.shade.ts';

/** One error of one file of the program, from either half. */
interface Line {
  readonly file: string;
  readonly code: string;
  readonly message: string;
  readonly line: number;
  readonly start: number;
  readonly length: number;
}

const fileOf = (name: string | undefined): string =>
  name !== undefined && name.includes('lib.shade') ? LIB_FILE : FILE;

/** A program: the file the compile starts from and the library it may import. */
interface Program2 {
  readonly main: string;
  readonly lib: string;
}

const readerOf =
  (p: Program2) =>
  (uri: string): string | undefined =>
    uri.includes('lib.shade') ? p.lib : undefined;

/** `compile()`'s errors, each in the file it stands in: the entry's from the program, the
 *  library's from the library compiled as its own program (as its document reports them). */
function compiled(p: Program2): Line[] {
  const read = readerOf(p);
  const of = (text: string, fileName: string, keep: (d: string) => boolean): Line[] =>
    compile(text, { fileName, readDocument: read })
      .diagnostics.filter((d) => d.category === 'error' && keep(fileOf(d.fileName)))
      .map((d) => ({
        file: fileOf(d.fileName),
        code: d.code ?? '',
        message: d.message,
        line: d.line,
        start: d.start,
        length: d.length,
      }));
  const imports = p.main.includes('./lib.shade');
  return [
    ...of(p.main, FILE, (f) => f === FILE),
    ...(imports ? of(p.lib, LIB_FILE, (f) => f === LIB_FILE) : []),
  ];
}

/** The editor's errors in each file of the program (`checkDocuments`, the CLI's and the
 *  editor's check), TypeShade's own: TypeScript's (`4 != 7` has no overlap) are the editor's. */
function editor(p: Program2): Line[] {
  return checkDocuments([{ path: FILE, uri: FILE, text: p.main }], { readDocument: readerOf(p) })
    .diagnostics.filter((d) => d.severity === 'error' && d.source === 'typeshade')
    .map((d) => ({
      file: fileOf(d.file),
      code: d.code,
      message: d.message,
      line: d.line,
      start: d.offset,
      length: d.length,
    }));
}

const key = (d: Line): string => `${d.file}|${String(d.line)}|${d.code}: ${d.message}`;

interface Change {
  readonly file: string;
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** The insertion that declares `name` with `type`, at its declaration in scope at `at`: the
 *  last `let` or `const` of that name before `at`, else the first after (a module's). */
function declarationAt(
  text: string,
  name: string,
  at: number,
  type: string,
): { start: number; end: number; text: string } | undefined {
  const re = new RegExp(`\\b(?:let|const) ${name}(\\s*)(?::\\s*\\w+\\s*)?=`, 'g');
  let best: RegExpExecArray | undefined;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index < at || best === undefined) best = m;
    if (m.index >= at) break;
  }
  if (best === undefined) return undefined;
  const start = best.index + best[0].indexOf(name) + name.length;
  const end = best.index + best[0].length - 1;
  return { start, end, text: `: ${type} ` };
}

/** The edit a diagnostic names, as a change of its file: at its span, or at the declaration a
 *  declaration edit names. `undefined`: it names no edit. Every form a refusal names is read:
 *  `Write "…" for the float division / integer division / u32 value / i32 value / u32 shift.`,
 *  the value forms `Write the u32 with the same bits, 0x….` and `Write the i32 with the same
 *  bits, -N, or declare a u32.`. */
function editOf(text: string, d: Line): Change | undefined | 'unreadable' {
  const value =
    / Write the (?:u32|i32) with the same bits, (0x[0-9a-f]+|-?\d+)(?:, or declare a u32)?\.$/.exec(
      d.message,
    );
  if (value !== null) {
    return { file: d.file, start: d.start, end: d.start + d.length, text: value[1]! };
  }
  const m =
    /[Ww]rite "([^"]*(?:"[^"]*"[^"]*)*?)" for the (?:float division|integer division|u32 value|i32 value|u32 shift)\.$/.exec(
      d.message,
    ) ?? /[Ww]rite "([^"]*)"\.$/.exec(d.message);
  if (m === null) return undefined;
  const edit = m[1]!;
  const decl = /^(let|const) (\w+): (\w+) = /.exec(edit);
  if (decl !== null) {
    const at = declarationAt(text, decl[2]!, d.start, decl[3]!);
    return at === undefined ? 'unreadable' : { file: d.file, ...at };
  }
  return { file: d.file, start: d.start, end: d.start + d.length, text: edit };
}

/** The edits a refusal that names none offers: each wrap of its generic remedy around each
 *  operand it names, or each declaration with a type. `undefined`: no generic remedy. */
function genericEdits(text: string, d: Line): Change[][] | undefined {
  const wrap =
    /Write ((?:[\w(]+\(…\)+(?:, | or )?)+) around ((?:each of )?"[^"]*"(?:(?:, | and )"[^"]*")*) to choose (?:the division|its value)\.$/.exec(
      d.message,
    );
  if (wrap !== null) {
    const forms = wrap[1]!.split(/, | or /).map((f) => f.replace(/…/, '%'));
    const subjects = [...wrap[2]!.matchAll(/"([^"]*)"/g)].map((x) => x[1]!);
    const span = text.slice(d.start, d.start + d.length);
    return forms.map((form) =>
      subjects.flatMap((subject) => {
        const i = span.indexOf(subject);
        if (i < 0) return [];
        return [
          {
            file: d.file,
            start: d.start + i,
            end: d.start + i + subject.length,
            text: form.replace('%', subject),
          },
        ];
      }),
    );
  }
  const declare =
    /Declare "(\w+)" with (\w+)(?: or (\w+))? to choose (?:the division|its value)\.$/.exec(
      d.message,
    );
  if (declare !== null) {
    return [declare[2]!, declare[3]]
      .filter((t): t is string => t !== undefined)
      .map((t) => {
        const at = declarationAt(text, declare[1]!, d.start, t);
        return at === undefined ? [] : [{ file: d.file, ...at }];
      });
  }
  return undefined;
}

/** The program with `changes` made in the files they name; `undefined` where two overlap. */
function applied(p: Program2, changes: readonly Change[]): Program2 | undefined {
  const one = (text: string, file: string): string | undefined => {
    const own = changes.filter((c) => c.file === file).sort((a, b) => b.start - a.start);
    for (let i = 1; i < own.length; i++) if (own[i]!.end > own[i - 1]!.start) return undefined;
    let out = text;
    for (const c of own) out = out.slice(0, c.start) + c.text + out.slice(c.end);
    return out;
  };
  const main = one(p.main, FILE);
  const lib = one(p.lib, LIB_FILE);
  return main === undefined || lib === undefined ? undefined : { main, lib };
}

export const CORPUS_SIZE = Number(process.env.DIFF_SIZE ?? 450);
const SEED = Number(process.env.DIFF_SEED ?? 1261);

/** The programs the twelfth and thirteenth reviews found, with TypeScript's value at the
 *  inputs: they lead the corpus, so a run shows each of them. */
const u32of = (x: number): number => Math.trunc(x) >>> 0;
const H0 = 'function g() {\n  return 3000000000|0;\n}\n';
const FIXED: readonly (readonly [string, string, number, string?])[] = [
  ['f32', 'let a = 1|2;\n  a /= f32(2);\n  return f32(a);', 1.5],
  ['f32', 'return f32((5|0)/(f32(2)+1));', Math.fround(5 / 3)],
  ['f32', 'return f32((0xF0000000|0)/(i32(2)+1));', Math.trunc((0xf0000000 | 0) / 3)],
  ['f32', 'let a = 1|2;\n  a = a / 2;\n  return f32(a);', 1.5],
  ['f32', 'let a = 1|2;\n  a = a / K;\n  return f32(a);', 0.75],
  ['f32', 'let a = 1|2;\n  a /= K;\n  return f32(a);', 0.75],
  ['f32', 'let a = abs(5|0);\n  a = a / 2;\n  return f32(a);', 2.5],
  ['u32', 'return max((3000000000|0), vi);', u32of(Math.max(3000000000 | 0, 7))],
  ['u32', 'return (3000000000|0) >> vi;', u32of((3000000000 | 0) >> 7)],
  ['u32', 'let a = (3000000000|0);\n  let b = a;\n  return b / vi;', u32of((3000000000 | 0) / 7)],
  ['u32', 'let a = (3000000000|0);\n  a %= vi;\n  return a;', u32of((3000000000 | 0) % 7)],
  ['f32', 'return f32((0xF0000000|0));', 0xf0000000 | 0],
  // B1: a compound assignment with a quotient on its right.
  ['i32', 'let g = ii;\n  g *= (5|0)/2;\n  return g;', Math.trunc(-3 * 2.5)],
  ['i32', 'let g = ii;\n  g += (5|0)/2;\n  return g;', Math.trunc(-3 + 2.5)],
  ['f32', 'let g = ii;\n  g *= (1<<3)/3;\n  return f32(g);', Math.fround(-3 * (8 / 3))],
  // B2: two readings through `?:`, `select`, a result, a module `let`, arithmetic.
  ['u32', 'let a = vi > 3 ? (3000000000|0) : vi;\n  return a / vi;', u32of((3000000000 | 0) / 7)],
  ['u32', 'return select(vi, (3000000000|0), vi > 3) / vi;', u32of((3000000000 | 0) / 7)],
  ['u32', 'return g() / vi;', u32of((3000000000 | 0) / 7), H0],
  ['u32', 'return M / vi;', u32of((3000000000 | 0) / 7), 'let M = 3000000000|0;\n'],
  [
    'u32',
    'let a = (3000000000|0);\n  let c = a + 0;\n  return c / vi;',
    u32of((3000000000 | 0) / 7),
  ],
  // B3: two readings through arithmetic of a constant.
  ['f32', 'const k = (3000000000|0);\n  return f32(k | 1);', 3000000000 | 0 | 1],
  ['f32', 'return f32(3 / (((vi < 2) ? 3 : 9) << 2));', Math.fround(3 / 36)],
];

describe('the written-integer rules hold over a generated corpus (issue 1261, D1)', () => {
  it(
    "compile() keeps TypeScript's value, the editor agrees, and every named edit set compiles",
    () => {
      const r = rng(SEED);
      const failures: string[] = [];
      let accepted = 0;
      let compared = 0;
      let edits = 0;
      let generics = 0;
      const leading = FIXED.map(([result, body, value, pre]) => ({
        source:
          `"use typeshade";\nconst K = 4;\n${pre ?? ''}export function t(ii: i32, vi: u32, f: f32): ${result} {\n` +
          `  ${body}\n}\n`,
        value,
        lib: 0,
      }));
      const show = (p: Program2): string =>
        p.main.includes('./lib.shade') ? `${p.main}--- lib.shade.ts\n${p.lib}` : p.main;
      for (let i = 0; i < leading.length + CORPUS_SIZE; i++) {
        const built = i < leading.length ? leading[i]! : new Program(r).build();
        const program: Program2 = { main: built.source, lib: LIBS[built.lib]! };
        const ours = compiled(program);
        const theirs = editor(program);
        // 2. Each file's diagnostics agree.
        const keysOf = (ds: readonly Line[]) => ds.map(key).sort();
        if (JSON.stringify(keysOf(ours)) !== JSON.stringify(keysOf(theirs))) {
          failures.push(
            `halves #${String(i)}: compile ${keysOf(ours).join(' ; ')}\neditor ${keysOf(theirs).join(' ; ')}\n${show(program)}`,
          );
        }
        if (ours.length === 0) {
          accepted++;
          if (built.value === undefined) continue;
          let got: unknown;
          try {
            got = compile(program.main, { fileName: FILE, readDocument: readerOf(program) }).eval(
              't',
              [INPUTS.ii, INPUTS.vi, INPUTS.f],
            );
          } catch (e) {
            failures.push(`eval #${String(i)}: ${String(e)}\n${show(program)}`);
            continue;
          }
          compared++;
          const value = built.value;
          const exact = Number.isInteger(value) && Math.abs(value) <= 2 ** 24;
          const ok =
            typeof got === 'number' &&
            (program.main.includes('): f32 {') && !exact
              ? Math.fround(got) === Math.fround(value) ||
                Math.abs(Math.fround(got) - Math.fround(value)) <= 2 ** -21 * Math.abs(value)
              : got === value);
          if (!ok) {
            failures.push(
              `value #${String(i)}: oracle ${String(got)} TypeScript ${String(value)}\n${show(program)}`,
            );
          }
          continue;
        }
        const textOf = (file: string): string => (file === LIB_FILE ? program.lib : program.main);
        // 3. Every named edit, made together at its place, adds no error in either half.
        const changes: Change[] = [];
        const named = new Set<number>();
        let unreadable = false;
        ours.forEach((d, j) => {
          const c = editOf(textOf(d.file), d);
          if (c === 'unreadable') unreadable = true;
          else if (c !== undefined) {
            changes.push(c);
            named.add(j);
          }
        });
        if (unreadable) {
          failures.push(
            `edit #${String(i)}: an edit names no place in the source\n${show(program)}`,
          );
        }
        const addedBy = (fixed: Program2, others: readonly Line[]): [string, Line[]][] => {
          const out: [string, Line[]][] = [];
          for (const [half, after] of [
            ['compile', compiled(fixed)],
            ['editor', editor(fixed)],
          ] as const) {
            const left = new Map<string, number>();
            for (const d of others) left.set(key(d), (left.get(key(d)) ?? 0) + 1);
            const added = after.filter((d) => {
              const n = left.get(key(d)) ?? 0;
              if (n === 0) return true;
              left.set(key(d), n - 1);
              return false;
            });
            out.push([half, added]);
          }
          return out;
        };
        if (changes.length > 0) {
          edits++;
          const fixed = applied(program, changes);
          if (fixed === undefined) {
            failures.push(`edit #${String(i)}: two named edits overlap\n${show(program)}`);
          } else {
            for (const [half, added] of addedBy(
              fixed,
              ours.filter((_, j) => !named.has(j)),
            )) {
              if (added.length > 0) {
                failures.push(
                  `edit #${String(i)} (${half}): ${added.map((d) => d.message).join(' | ')}\n${show(fixed)}`,
                );
              }
            }
          }
        }
        // The program's one error, where it names no edit: each wrap or declaration its generic
        // remedy offers removes it and raises no refusal of its own. A type mismatch it leaves is a
        // use that asks the other type, which D4 of 2026-11-12 leaves to the generic text.
        if (ours.length === 1 && changes.length === 0) {
          const only = ours[0]!;
          const offered = genericEdits(textOf(only.file), only);
          if (offered === undefined) continue;
          generics++;
          const mismatch = (d: Line): boolean =>
            /type mismatch|takes arguments of one type|^Cannot infer/i.test(d.message);
          for (const set of offered) {
            const fixed = set.length === 0 ? undefined : applied(program, set);
            if (fixed === undefined) {
              failures.push(
                `generic #${String(i)}: a wrap names no operand of the span\n${show(program)}`,
              );
              continue;
            }
            for (const [half, added] of addedBy(fixed, [])) {
              const bad = added.filter(
                (d) => !mismatch(d) || (d.file === only.file && d.message === only.message),
              );
              if (bad.length > 0) {
                failures.push(
                  `generic #${String(i)} (${half}): ${bad.map((d) => d.message).join(' | ')}\n${show(fixed)}`,
                );
              }
            }
          }
        }
      }
      if (process.env.DIFF_OUT) writeFileSync(process.env.DIFF_OUT, failures.join('\n====\n'));
      const summary =
        `seed ${String(SEED)}: ${String(leading.length + CORPUS_SIZE)} programs, accepted ` +
        `${String(accepted)}, compared ${String(compared)}, edit sets ${String(edits)}, ` +
        `generic remedies ${String(generics)}, failures ${String(failures.length)}`;
      if (process.env.DIFF_SUMMARY) writeFileSync(process.env.DIFF_SUMMARY, `${summary}\n`);
      if (process.env.DIFF_VERBOSE) console.log(summary);
      // The corpus reaches the accepting path often enough to mean something.
      expect(accepted).toBeGreaterThan(CORPUS_SIZE / 10);
      expect(compared).toBeGreaterThan(CORPUS_SIZE / 20);
      expect(failures).toEqual([]);
    },
    Number(process.env.DIFF_TIMEOUT ?? 120_000),
  );
});
