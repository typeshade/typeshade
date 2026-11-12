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
// result. Three properties hold over the corpus:
//
//   1. Where `compile()` accepts a program with no diagnostic, the CPU oracle's value is the value
//      the same source has as TypeScript, with `i32()` ToInt32 of the truncation, `u32()`
//      ToUint32 of it, `f32()` `Math.fround`, and a value whose type is declared (a parameter, a
//      conversion, an annotation) computing in that type (an integer `/` truncates, an integer
//      result wraps). A written number and a value of no declared type keep TypeScript's value
//      (OD-7, Rule 5.1); once such a value is no integer, the author's TypeScript keeps the
//      double. Integer results compare exactly; an `f32` compares after `Math.fround` on both
//      sides, exactly where it is an integer of at most 2^24.
//   2. The editor's `getDiagnostics` gives exactly the diagnostics `compile()` gives: the same
//      codes and the same text (Rule 12.7).
//   3. Every edit the refusals name (a division's, a value with two readings', a value form),
//      made together at its diagnostic's place, adds no error in either half: the edited
//      program's errors are the unedited program's other errors, by line and text (Amendment
//      A6, "name only verified edits").

import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

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
const LIB = '"use typeshade";\nexport const L = 3;\nexport const LB = 0xF0000000 | 0;\n';

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
  readonly fns: { name: string; call: (args: Expr[]) => Expr; arity: number }[] = [];
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
        Array.from({ length: f.arity }, () => this.expr(this.pick<T>(['k', 'i32']), depth - 1)),
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
    if (this.chance(0.2)) {
      const e = this.tree();
      this.pre.push(`let M = ${e.text};`);
      this.bind('M', 'k', () => e.value());
    }
    if (this.chance(0.25)) {
      this.pre.unshift(`import { L, LB } from "./lib.shade";`);
      this.bind('L', 'k', () => ({ t: 'k', v: 3 }));
      this.bind('LB', 'k', () => ({ t: 'k', v: 0xf0000000 | 0 }));
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
            if (!Number.isInteger(a.v) || !inRange('i32', a.v)) throw new Skip('argument value');
            return { t: 'i32', v: (a.v + 1) | 0 };
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
    return { t, v: t === 'f32' ? Math.fround(next.v) : convert(t as 'i32' | 'u32', next) };
  }

  /** The program as source, and its reference value (`undefined`: no comparison is made). */
  build(): { source: string; value: number | undefined } {
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
    const form = this.r();
    let ret: Expr;
    if (form < 0.45) {
      // A `let` chain, annotated or not, with a reassignment or a compound assignment.
      const annotated = this.chance(0.25) ? this.pick<T>(['i32', 'u32', 'f32']) : undefined;
      const ty = annotated ?? this.pick<T>(['k', 'k', 'k', 'k', 'i32', 'u32', 'f32']);
      const init = this.chance(0.3)
        ? this.pick([
            () => this.tree(),
            () => this.call('abs', [this.tree()]),
            () => this.call('min', [this.tree(), lit(9)]),
            () => this.call('select', [lit(3), this.tree(), this.compare(0)]),
            () => this.cond(this.compare(0), this.tree(), lit(3)),
          ])()
        : this.expr(annotated ?? ty, 2);
      this.lines.push(`let a${annotated !== undefined ? `: ${annotated}` : ''} = ${init.text};`);
      const target: T = annotated ?? 'k';
      this.bind('a', target, () => this.assign(target, { t: 'k', v: 0 }, undefined, init.value()));
      if (this.chance(0.4)) {
        this.lines.push('let b = a;');
        this.bind('b', 'k', () => this.env.get('a')!);
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
      expected = result === 'f32' ? Math.fround(v.v) : convert(result as 'i32' | 'u32', v);
    } catch (e) {
      if (!(e instanceof Skip)) throw e;
      expected = undefined;
    }
    return { source, value: expected };
  }
}

const read = (uri: string): string | undefined => (uri.includes('lib.shade') ? LIB : undefined);
const FILE = '/p/a.shade.ts';

interface Line {
  readonly code: string;
  readonly message: string;
  readonly line: number;
}

function compiled(source: string): Line[] {
  return compile(source, { fileName: FILE, readDocument: read })
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => ({ code: d.code ?? '', message: d.message, line: d.line }));
}

function editor(source: string): Line[] {
  const s = createTypeshadeLanguageService({ readDocument: read });
  s.openDocument(FILE, source);
  return (
    s
      .getDiagnostics(FILE)
      .filter((d) => d.severity === 'error' || d.severity === undefined)
      .map((d) => ({
        code: String(d.code),
        message: String(d.message),
        line: d.range.start.line + 1,
      }))
      // TypeScript's own checks (`4 != 7` has no overlap, TS2367) are the editor's alone.
      .filter((d) => d.code.startsWith('TS'))
  );
}

const key = (d: Line): string => `${String(d.line)}|${d.code}: ${d.message}`;

/** The edit a diagnostic names, as a change of the source: at its span, or at the declaration a
 *  declaration edit names. `undefined`: the diagnostic names no edit. */
function editOf(
  source: string,
  d: { readonly message: string; readonly start: number; readonly length: number },
): { start: number; end: number; text: string } | undefined | 'unreadable' {
  const m =
    /[Ww]rite "([^"]*(?:"[^"]*"[^"]*)*?)" for the (?:float division|integer division|u32 value|i32 value)\.$/.exec(
      d.message,
    ) ?? /[Ww]rite "([^"]*)"\.$/.exec(d.message);
  if (m === null) return undefined;
  const edit = m[1]!;
  const decl = /^(let|const) (\w+): (\w+) = /.exec(edit);
  if (decl !== null) {
    const at = new RegExp(`\\b${decl[1]!} ${decl[2]!}(\\s*)=`).exec(source);
    if (at === null) return 'unreadable';
    const start = at.index + decl[1]!.length + 1 + decl[2]!.length;
    return { start, end: start, text: `: ${decl[3]!}` };
  }
  return { start: d.start, end: d.start + d.length, text: edit };
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
  it("compile() keeps TypeScript's value, the editor agrees, and every named edit set compiles", () => {
    const r = rng(SEED);
    const failures: string[] = [];
    let accepted = 0;
    let compared = 0;
    let edits = 0;
    const leading = FIXED.map(([result, body, value, pre]) => ({
      source:
        `"use typeshade";\nconst K = 4;\n${pre ?? ''}export function t(ii: i32, vi: u32, f: f32): ${result} {\n` +
        `  ${body}\n}\n`,
      value,
    }));
    for (let i = 0; i < leading.length + CORPUS_SIZE; i++) {
      const { source, value } = i < leading.length ? leading[i]! : new Program(r).build();
      const result = compile(source, { fileName: FILE, readDocument: read });
      const errors = result.diagnostics.filter((d) => d.category === 'error');
      const ours = compiled(source).map(key).sort();
      const theirs = editor(source).map(key).sort();
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
        failures.push(
          `halves #${String(i)}: compile ${ours.join(' ; ')}\neditor ${theirs.join(' ; ')}\n${source}`,
        );
      }
      if (errors.length === 0) {
        accepted++;
        if (value === undefined) continue;
        let got: unknown;
        try {
          got = result.eval('t', [INPUTS.ii, INPUTS.vi, INPUTS.f]);
        } catch (e) {
          failures.push(`eval #${String(i)}: ${String(e)}\n${source}`);
          continue;
        }
        compared++;
        const exact = Number.isInteger(value) && Math.abs(value) <= 2 ** 24;
        const ok =
          typeof got === 'number' &&
          (source.includes('): f32 {') && !exact
            ? Math.fround(got) === Math.fround(value) ||
              Math.abs(Math.fround(got) - Math.fround(value)) <= 2 ** -21 * Math.abs(value)
            : got === value);
        if (!ok)
          failures.push(
            `value #${String(i)}: oracle ${String(got)} TypeScript ${String(value)}\n${source}`,
          );
        continue;
      }
      // Every named edit, made together at its place, adds no error in either half.
      const changes: { start: number; end: number; text: string }[] = [];
      const named = new Set<number>();
      let unreadable = false;
      errors.forEach((d, j) => {
        const c = editOf(source, d);
        if (c === 'unreadable') unreadable = true;
        else if (c !== undefined) {
          changes.push(c);
          named.add(j);
        }
      });
      if (unreadable)
        failures.push(`edit #${String(i)}: an edit names no place in the source\n${source}`);
      if (changes.length === 0) continue;
      edits++;
      let fixed = source;
      for (const c of [...changes].sort((a, b) => b.start - a.start)) {
        fixed = fixed.slice(0, c.start) + c.text + fixed.slice(c.end);
      }
      const others = new Map<string, number>();
      for (const d of compiled(source).filter((_, j) => !named.has(j))) {
        others.set(key(d), (others.get(key(d)) ?? 0) + 1);
      }
      for (const [half, after] of [
        ['compile', compiled(fixed)],
        ['editor', editor(fixed)],
      ] as const) {
        const left = new Map(others);
        const added = after.filter((d) => {
          const n = left.get(key(d)) ?? 0;
          if (n === 0) return true;
          left.set(key(d), n - 1);
          return false;
        });
        if (added.length > 0) {
          failures.push(
            `edit #${String(i)} (${half}): ${added.map((d) => d.message).join(' | ')}\n${fixed}`,
          );
        }
      }
    }
    if (process.env.DIFF_OUT) writeFileSync(process.env.DIFF_OUT, failures.join('\n====\n'));
    if (process.env.DIFF_VERBOSE) {
      console.log(
        `seed ${String(SEED)}: ${String(leading.length + CORPUS_SIZE)} programs, accepted ` +
          `${String(accepted)}, compared ${String(compared)}, edit sets ${String(edits)}, ` +
          `failures ${String(failures.length)}`,
      );
      console.log(failures.join('\n====\n'));
    }
    // The corpus reaches the accepting path often enough to mean something.
    expect(accepted).toBeGreaterThan(CORPUS_SIZE / 10);
    expect(compared).toBeGreaterThan(CORPUS_SIZE / 20);
    expect(failures).toEqual([]);
  }, 120_000);
});
