// A differential test of the written-integer rules of issue 1261 (change 0134, D-b, Amendment
// A6; the owner's decision of 2026-11-12, D1: "build a differential test first, then fix").
//
// A fixed-seed generator writes `"use typeshade"` programs over bit trees (negative ones among
// them), untyped constants (module, function-local and imported), `let` chains and reassignment,
// compound assignment, builtins, `?:`, written conversions alone and inside arithmetic, typed
// peers and the operators `/ % < <= == != >> >>> + - * & | ^ <<`, with an `f32`, `i32` or `u32`
// result. Three properties hold over the corpus:
//
//   1. Where `compile()` accepts a program with no diagnostic, the CPU oracle's value is the value
//      the same source has as TypeScript, with `i32()` ToInt32 of the truncation, `u32()`
//      ToUint32 of it, `f32()` `Math.fround`, and a value whose type is declared (a parameter, a
//      conversion) computing in that type (an integer `/` truncates, an integer result wraps). A
//      written number and a value of no declared type keep TypeScript's value (OD-7, Rule 5.1).
//   2. The editor's `getDiagnostics` refuses exactly the programs `compile()` refuses, with the
//      same codes (Rule 12.7).
//   3. The edits the refusals name, made together, compile clean in both halves (Amendment A6).

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
const LIB_VALUES: Record<string, number> = { L: 3, LB: 0xf0000000 | 0 };

const toI32 = (x: number): number => Math.trunc(x) | 0;
const toU32 = (x: number): number => Math.trunc(x) >>> 0;
const wrap = (t: T, x: number): number => {
  if (!Number.isFinite(x)) throw new Skip('not finite');
  // An f32 past 2^24 rounds in each operation, which the oracle and TypeScript's doubles do
  // differently: no comparison is made there.
  if (t === 'f32' && Math.abs(x) > 2 ** 24 && Math.fround(x) !== x) {
    throw new Skip('f32 precision');
  }
  return t === 'i32' ? x | 0 : t === 'u32' ? x >>> 0 : t === 'f32' ? Math.fround(x) : x;
};
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

const COMPARE = new Set(['<', '<=', '==', '!=']);

function binary(op: string, a: V, b: V): V {
  if (COMPARE.has(op)) {
    unify(a, b);
    const r =
      op === '<' ? a.v < b.v : op === '<=' ? a.v <= b.v : op === '==' ? a.v === b.v : a.v !== b.v;
    return { t: 'bool', v: r ? 1 : 0 };
  }
  // A shift computes in its left operand's type.
  const t = op === '<<' || op === '>>' || op === '>>>' ? a.t : unify(a, b);
  if (t === 'bool') throw new Skip('bool');
  const [x, y] = [a.v, b.v];
  const integer = t === 'i32' || t === 'u32';
  if (t === 'f32' && ['&', '|', '^', '<<', '>>', '>>>'].includes(op)) throw new Skip('f32 bits');
  let r: number;
  switch (op) {
    case '+':
      r = x + y;
      break;
    case '-':
      r = x - y;
      break;
    case '*':
      r = integer && Number.isInteger(x) && Number.isInteger(y) ? Math.imul(x, y) : x * y;
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
    case '>>':
      r = t === 'u32' ? (x >>> 0) >>> (y & 31) : x >> (y & 31);
      break;
    default:
      r = x >>> (y & 31);
  }
  return { t, v: wrap(t, r) };
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
  imported = false;
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
    if (t === 'f32')
      return this.pick([() => this.name('f'), () => this.conv('f32', this.leaf('k'))])();
    const consts = [...this.env.keys()].filter(
      (k) => /^[KkL]/.test(k) && this.env.get(k)!.t === 'k',
    );
    return this.pick([
      () => lit(this.pick([2, 3, 4, 7, 9])),
      () => this.tree(),
      () => this.tree(),
      () => (consts.length > 0 ? this.name(this.pick(consts)) : lit(4)),
    ])();
  }

  conv(to: 'i32' | 'u32' | 'f32', a: Expr): Expr {
    return {
      text: `${to}(${a.text})`,
      value: () => {
        const x = a.value().v;
        // A float outside the integer type converts as WGSL defines (it saturates), not as
        // ToInt32 wraps; the language refuses it where it is constant (Rule 5.4). No comparison.
        if (to !== 'f32' && (!Number.isInteger(x) || a.value().t === 'f32')) {
          const t = Math.trunc(x);
          if (to === 'u32' ? t < 0 || t > 4294967295 : t < -(2 ** 31) || t > 2 ** 31 - 1) {
            throw new Skip('float conversion out of range');
          }
        }
        return { t: to, v: to === 'i32' ? toI32(x) : to === 'u32' ? toU32(x) : Math.fround(x) };
      },
    };
  }

  bin(op: string, a: Expr, b: Expr): Expr {
    return { text: `(${a.text} ${op} ${b.text})`, value: () => binary(op, a.value(), b.value()) };
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
            if (t === 'f32') throw new Skip('bits f32');
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

  /** An expression of type `t` (or of no declared type, `k`), `depth` levels deep. */
  expr(t: T, depth: number): Expr {
    if (depth <= 0 || this.chance(0.25)) return this.leaf(t);
    const peer = (): T => (t === 'k' || this.chance(0.4) ? 'k' : t);
    const kind = this.r();
    if (kind < 0.55) {
      const ops =
        t === 'f32'
          ? ['/', '%', '+', '-', '*']
          : ['/', '/', '%', '+', '-', '*', '&', '|', '^', '<<', '>>', '>>>'];
      const op = this.pick(ops);
      const side = this.chance(0.5);
      const a = this.expr(side ? t : peer(), depth - 1);
      const b =
        op === '<<' || op === '>>' || op === '>>>'
          ? lit(this.pick([1, 2, 4]))
          : this.expr(side ? peer() : t, depth - 1);
      return this.bin(op, a, b);
    }
    if (kind < 0.7) {
      const fn = this.pick(['abs', 'min', 'max', 'clamp', 'countOneBits', 'sign', 'select']);
      if (fn === 'select') {
        return this.call('select', [
          this.expr(t, depth - 1),
          this.expr(peer(), depth - 1),
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
    if (kind < 0.8)
      return this.cond(
        this.compare(depth - 1),
        this.expr(t, depth - 1),
        this.expr(peer(), depth - 1),
      );
    if (kind < 0.9 && t !== 'k') {
      // A written conversion inside arithmetic: `i32(2) + 1`.
      const to = t === 'bool' ? 'i32' : t;
      return this.bin(
        this.pick(['+', '-']),
        this.conv(to as 'i32' | 'u32' | 'f32', lit(2)),
        lit(1),
      );
    }
    return this.leaf(t);
  }

  compare(depth: number): Expr {
    const t = this.pick<T>(['k', 'i32', 'u32']);
    return this.bin(this.pick(['<', '<=', '==', '!=']), this.expr(t, depth), this.expr('k', depth));
  }

  /** The program as source, and its reference value (`undefined`: no comparison is made). */
  build(): { source: string; result: T; value: number | undefined } {
    for (const [k, v] of Object.entries(INPUTS)) {
      this.env.set(k, { t: k === 'ii' ? 'i32' : k === 'vi' ? 'u32' : 'f32', v });
    }
    // Untyped constants: at module scope, in the function and imported.
    const steps: (() => void)[] = [];
    if (this.chance(0.4)) {
      const e = this.tree();
      this.pre.push(`const K = ${e.text};`);
      steps.push(() => this.env.set('K', e.value()));
    }
    if (this.chance(0.3)) {
      this.imported = true;
      this.pre.unshift(`import { L, LB } from "./lib.shade";`);
      this.env.set('L', { t: 'k', v: LIB_VALUES.L! });
      this.env.set('LB', { t: 'k', v: LIB_VALUES.LB! });
    }
    for (const s of steps) s();
    if (this.chance(0.4)) {
      const e = this.pick([() => lit(this.pick([4, 7])), () => this.tree()])();
      this.lines.push(`const k = ${e.text};`);
      this.env.set('k', e.value());
    }
    // A `let` chain with a reassignment or a compound assignment.
    const result = this.pick<T>(['f32', 'i32', 'u32']);
    const ty = this.pick<T>(['k', 'k', 'k', 'k', 'i32', 'u32', 'f32']);
    let value: (() => V) | undefined;
    if (this.chance(0.6)) {
      // A start that is an integer only by inference: a tree, a builtin or `?:` over one.
      const init = this.chance(0.3)
        ? this.pick([
            () => this.tree(),
            () => this.call('abs', [this.tree()]),
            () => this.call('min', [this.tree(), lit(9)]),
            () => this.call('select', [lit(3), this.tree(), this.compare(0)]),
            () => this.cond(this.compare(0), this.tree(), lit(3)),
          ])()
        : this.expr(ty, 2);
      this.lines.push(`let a = ${init.text};`);
      const later: (() => void)[] = [() => this.env.set('a', init.value())];
      if (this.chance(0.5)) {
        this.lines.push('let b = a;');
        later.push(() => this.env.set('b', this.env.get('a')!));
      }
      if (this.chance(0.6)) {
        const op = this.pick(['/', '/', '/', '%', '>>', '+', '*', '-']);
        const rhs = this.pick([
          () => lit(this.pick([2, 3, 4])),
          () =>
            this.name(
              this.pick(
                ['K', 'k', 'L', 'vi', 'ii'].filter(
                  (n) =>
                    n === 'vi' ||
                    n === 'ii' ||
                    this.env.has(n) ||
                    this.pre.some((p) => p.includes(`const ${n} `)) ||
                    this.lines.some((p) => p.includes(`const ${n} `)),
                ),
              ),
            ),
          () => this.conv(this.pick(['i32', 'u32', 'f32'] as const), lit(2)),
          () => this.bin('+', this.conv(this.pick(['i32', 'u32', 'f32'] as const), lit(2)), lit(1)),
        ])();
        const compound = this.chance(0.5);
        this.lines.push(compound ? `a ${op}= ${rhs.text};` : `a = a ${op} ${rhs.text};`);
        later.push(() => {
          const before = this.env.get('a')!;
          const next = binary(op, before, rhs.value());
          // An assignment keeps the variable's type: a declared one wraps the value.
          if (before.t !== 'k' && next.t !== before.t) throw new Skip('assignment type');
          this.env.set('a', { t: before.t, v: before.t === 'k' ? next.v : wrap(before.t, next.v) });
        });
      }
      const use = this.chance(0.5)
        ? this.name(this.lines.some((l) => l.startsWith('let b')) ? 'b' : 'a')
        : this.expr(result, 1);
      const ret = this.chance(0.5)
        ? this.bin(this.pick(['/', '+', '*', '%']), this.name('a'), use)
        : use;
      value = () => {
        for (const s of later) s();
        return ret.value();
      };
      this.lines.push(`return ${this.wrapResult(result, ret.text)};`);
    } else {
      const e = this.expr(this.pick<T>(['k', 'k', result]), 3);
      value = () => e.value();
      this.lines.push(`return ${this.wrapResult(result, e.text)};`);
    }
    const source =
      '"use typeshade";\n' +
      (this.pre.length > 0 ? `${this.pre.join('\n')}\n` : '') +
      `export function t(ii: i32, vi: u32, f: f32): ${result} {\n  ${this.lines.join('\n  ')}\n}\n`;
    let expected: number | undefined;
    try {
      const v = value();
      if (v.t === 'bool') throw new Skip('bool result');
      if (result !== 'f32' && (!Number.isInteger(v.v) || v.t === 'f32')) {
        const t = Math.trunc(v.v);
        if (result === 'u32' ? t < 0 || t > 4294967295 : t < -(2 ** 31) || t > 2 ** 31 - 1) {
          throw new Skip('float conversion out of range');
        }
      }
      expected = result === 'i32' ? toI32(v.v) : result === 'u32' ? toU32(v.v) : Math.fround(v.v);
      if (v.t !== 'k' && v.t !== result && !this.lines.at(-1)!.includes(`${result}(`)) {
        throw new Skip('result type');
      }
    } catch (e) {
      if (!(e instanceof Skip)) throw e;
      expected = undefined;
    }
    return { source, result, value: expected };
  }

  wrapResult(result: T, text: string): string {
    return this.chance(0.5) ? `${result}(${text})` : text;
  }
}

const read = (uri: string): string | undefined => (uri.includes('lib.shade') ? LIB : undefined);
const FILE = '/p/a.shade.ts';

function editor(source: string): { code: string; message: string }[] {
  const s = createTypeshadeLanguageService({ readDocument: read });
  s.openDocument(FILE, source);
  return (
    s
      .getDiagnostics(FILE)
      .filter((d) => d.severity === 'error' || d.severity === undefined)
      .map((d) => ({ code: String(d.code), message: String(d.message) }))
      // TypeScript's own checks (`4 != 7` has no overlap, TS2367) are the editor's alone.
      .filter((d) => d.code.startsWith('TS'))
  );
}

/** The program with every edit the refusals name made: `undefined` where none is named. */
function edited(source: string, messages: readonly string[]): string | undefined {
  let out = source;
  let any = false;
  for (const m of messages) {
    const tree =
      /no operand of "(.*?)" has a declared type, .*Write "(.*)" for the (?:float|integer) division\.$/.exec(
        m,
      );
    const decl = /^"(.*?)" is .* Write "((?:let|const) (\w+): \w+ = .*)" for the/.exec(m);
    const readings =
      /^"(.*)" is \d+ on its u32 bits .* Write "(u32\(.*\))" for the u32 value\.$/.exec(m);
    // The edits the module's check proves are the ones of a refused division (Amendment A6);
    // the edit of a value with two readings (D2) is checked by its own tests.
    if (readings !== null || (decl === null && tree === null)) return undefined;
    if (decl !== null && /^(let|const) /.test(decl[2]!)) {
      const plain = decl[2]!.replace(/: \w+ =/, ' =');
      if (!out.includes(plain)) return undefined;
      out = out.replace(plain, decl[2]!);
      any = true;
    } else if (tree !== null) {
      if (!out.includes(tree[1]!)) return undefined;
      out = out.replace(tree[1]!, tree[2]!);
      any = true;
    } else if (readings !== null) {
      const at = out.includes(`(${readings[1]!})`) ? `(${readings[1]!})` : readings[1]!;
      if (!out.includes(at)) return undefined;
      out = out.replace(at, readings[2]!);
      any = true;
    }
  }
  return any ? out : undefined;
}

/** The programs the twelfth review found, with TypeScript's value at the inputs: they lead the
 *  corpus, so a run shows each of them (F1 a written conversion folded away, F2 a reassigned
 *  `/` over values that are integers by inference, F3 the two readings of a tree, D2). */
const u32of = (x: number): number => Math.trunc(x) >>> 0;
const FIXED: readonly (readonly [string, string, number])[] = [
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
];

export const CORPUS_SIZE = Number(process.env.DIFF_SIZE ?? 600);

describe('the written-integer rules hold over a generated corpus (issue 1261, D1)', () => {
  it("compile() keeps TypeScript's value, the editor agrees, and every named edit set compiles", () => {
    const r = rng(1261);
    const failures: string[] = [];
    let accepted = 0;
    let compared = 0;
    const leading = FIXED.map(([result, body, value]) => ({
      source:
        `"use typeshade";\nconst K = 4;\nexport function t(ii: i32, vi: u32, f: f32): ${result} {\n` +
        `  ${body}\n}\n`,
      value,
    }));
    for (let i = 0; i < leading.length + CORPUS_SIZE; i++) {
      const { source, value } = i < leading.length ? leading[i]! : new Program(r).build();
      const result = compile(source, { fileName: FILE, readDocument: read });
      const errors = result.diagnostics.filter((d) => d.category === 'error');
      const ours = errors.map((d) => d.code).sort();
      const theirs = editor(source)
        .map((d) => d.code)
        .sort();
      if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
        failures.push(
          `halves #${String(i)}: compile ${ours.join(',')} editor ${theirs.join(',')}\n${source}`,
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
        const ok =
          typeof got === 'number' &&
          (got === value || Math.abs(got - value) <= 1e-5 * Math.max(1, Math.abs(value)));
        if (!ok)
          failures.push(
            `value #${String(i)}: oracle ${String(got)} TypeScript ${String(value)}\n${source}`,
          );
        continue;
      }
      const fixed = edited(
        source,
        errors.map((d) => d.message),
      );
      if (fixed === undefined) continue;
      const after = compile(fixed, { fileName: FILE, readDocument: read }).diagnostics.filter(
        (d) => d.category === 'error',
      );
      const afterEditor = editor(fixed);
      if (after.length > 0 || afterEditor.length > 0) {
        failures.push(
          `edit #${String(i)}: ${after.map((d) => d.message).join(' | ')} / editor ${afterEditor.map((d) => d.message).join(' | ')}\n${fixed}`,
        );
      }
    }
    // The corpus reaches the accepting path often enough to mean something.
    if (process.env.DIFF_VERBOSE) {
      console.log(`accepted ${String(accepted)}, compared ${String(compared)}`);
      console.log(failures.join('\n====\n'));
    }
    expect(accepted).toBeGreaterThan(CORPUS_SIZE / 10);
    expect(compared).toBeGreaterThan(CORPUS_SIZE / 20);
    expect(failures).toEqual([]);
  }, 120_000);
});
