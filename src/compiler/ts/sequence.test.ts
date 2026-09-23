// A call that writes, inside a larger expression, runs in source order on every target
// (Rule 7.9). `sequence.ts` binds each such call to a `let` of its own ahead of the statement,
// binds an operand that reads what the call changes ahead of the call, and turns an arm that
// TypeScript runs conditionally into an `if`. What is pinned here: the WGSL and GLSL ES 3.00
// each shape emits, the oracle, the codegen and the debugger agreeing with the order the source
// says (a host-side model of the generator is the expected value), the two things the passes
// after this one would otherwise do to such a call (fold it away, spell it twice), a helper
// that writes a module variable, the one refusal, and a debugger stepping each call.
//
// Measured on `main` before this: every shape below but the helper was TS8035 (a method that
// changes its object could not return a value); the helper's `next() + next()` compiled, with
// its operands in GLSL's unspecified order, and `const unused = next()` vanished from both
// emits while the oracle ran it.

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { TS_CODES } from './codes.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { startDebugSession } from '../../core/debug/session.js';

const RNG = `"use typeshade";
class Rng {
  state: u32;
  constructor(seed: u32) {
    this.state = seed;
  }
  bits(): u32 {
    this.state = this.state * 747796405 + 2891336453;
    return this.state >> 8;
  }
  next(): f32 {
    return f32(this.bits()) / 16777216.;
  }
}
`;

/** The generator on the host: its state after each step, from `seed`. */
function states(seed: number, n: number): number[] {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 747796405) + 2891336453) >>> 0;
    out.push(s);
  }
  return out;
}

/** The first `n` draws of `next()` from `seed`: the top 24 bits, scaled to [0, 1). */
const draws = (seed: number, n: number): number[] =>
  states(seed, n).map((s) => (s >>> 8) / 16777216);

/** Compile, and hold the oracle, the codegen and the debugger to one answer, which is returned. */
function agree(src: string, args: readonly unknown[]): unknown {
  const r = compile(src);
  expect(r.diagnostics).toEqual([]);
  const oracle = r.eval('fs', args);
  expect(compileModuleJs(r.module).fns['fs']!(...(args as never[]))).toEqual(oracle);
  const s = startDebugSession(r.module, 'fs', args as never[]);
  s.continue();
  expect(s.result).toEqual(oracle);
  return oracle;
}

const fragment = (body: string): string =>
  `${RNG}@fragment\nexport function fs(@location(0) uv: vec2): vec4 {\n  let rng = new Rng(u32(uv.x * 1000.))\n${body}\n}\n`;

describe('a call that writes, inside a larger expression, in source order', () => {
  it('two draws in one constructor are two lets, first to last', () => {
    const src = fragment('  return vec4(rng.next(), rng.next(), 0., 1.)');
    const r = compile(src);
    expect(r.wgsl).toContain(
      '  let _seq0 = Rng_next(&rng);\n  let _seq1 = Rng_next(&rng);\n  return vec4<f32>(_seq0, _seq1, 0.0, 1.0);',
    );
    expect(r.glsl!.fragment).toContain(
      '  float _seq0 = Rng_next(rng);\n  float _seq1 = Rng_next(rng);\n  _ret = vec4(_seq0, _seq1, 0.0, 1.0);',
    );
    const [a, b] = draws(500, 2);
    expect(agree(src, [[0.5, 0]])).toEqual([a, b, 0, 1]);
  });

  it('an operand read before the call keeps the value it had', () => {
    // `rng.state` is read first in TypeScript and in WGSL. GLSL ES 3.00 may evaluate the
    // right operand of `-` first (§5.11), so the read is taken ahead of the call.
    const src = fragment(
      '  const d = f32(rng.state % 1000) - f32(rng.bits() % 1000)\n  return vec4(d, 0., 0., 1.)',
    );
    const r = compile(src);
    expect(r.wgsl).toContain(
      '  let _seq0 = f32((rng.state % 1000u));\n  let _seq1 = Rng_bits(&rng);\n  let d = (_seq0 - f32((_seq1 % 1000u)));',
    );
    const [s1] = states(500, 1);
    expect(agree(src, [[0.5, 0]])).toEqual([500 - ((s1! >>> 8) % 1000), 0, 0, 1]);
  });

  it('an arm of ?: runs only when it is chosen, which select would not do', () => {
    const src = fragment(
      '  const x = uv.y > 0.5 ? rng.next() : 0.\n  return vec4(x, rng.next(), 0., 1.)',
    );
    const r = compile(src);
    expect(r.wgsl).toContain(
      '  var _seq0: f32;\n  if ((uv.y > 0.5)) {\n    _seq0 = Rng_next(&rng);\n  } else {\n    _seq0 = 0.0;\n  }\n  let x = _seq0;',
    );
    expect(r.wgsl).not.toContain('select(');
    const [a, b] = draws(500, 2);
    expect(agree(src, [[0.5, 0.75]])).toEqual([a, b, 0, 1]);
    // Not chosen: no draw, so the second call makes the first draw.
    expect(agree(src, [[0.5, 0.25]])).toEqual([0, a, 0, 1]);
  });

  it('the right operand of && and || runs only when the left one does not decide', () => {
    const and = fragment(
      '  const hit = uv.y > 0.5 && rng.next() > 0.5\n  return vec4(select(0., 1., hit), rng.next(), 0., 1.)',
    );
    expect(compile(and).wgsl).toContain(
      '  var _seq0: bool = (uv.y > 0.5);\n  if (_seq0) {\n    let _seq1 = Rng_next(&rng);\n    _seq0 = (_seq1 > 0.5);\n  }\n  let hit = _seq0;',
    );
    const [a, b] = draws(500, 2);
    expect(agree(and, [[0.5, 0.75]])).toEqual([a! > 0.5 ? 1 : 0, b, 0, 1]);
    expect(agree(and, [[0.5, 0.25]])).toEqual([0, a, 0, 1]);
    const or = fragment(
      '  const miss = uv.y > 0.5 || rng.next() > 0.5\n  return vec4(select(0., 1., miss), rng.next(), 0., 1.)',
    );
    expect(compile(or).wgsl).toContain('  if ((_seq0 == false)) {');
    expect(agree(or, [[0.5, 0.75]])).toEqual([1, a, 0, 1]);
  });

  it('an else-if condition that draws opens the else, where it is evaluated', () => {
    const src = fragment(`  let c = 0.
  if (uv.y > 0.5) {
    c = 1.
  } else if (rng.next() > 0.5) {
    c = 2.
  } else {
    c = 3.
  }
  return vec4(c, rng.next(), 0., 1.)`);
    expect(compile(src).wgsl).toContain(
      '  } else {\n    let _seq0 = Rng_next(&rng);\n    if ((_seq0 > 0.5)) {\n      c = 2.0;\n    } else {\n      c = 3.0;\n    }\n  }',
    );
    const [a, b] = draws(500, 2);
    expect(agree(src, [[0.5, 0.75]])).toEqual([1, a, 0, 1]);
    expect(agree(src, [[0.5, 0.25]])).toEqual([a! > 0.5 ? 2 : 3, b, 0, 1]);
  });

  it('an assignment reads its target index before the value is evaluated', () => {
    // Both targets evaluate the left of `=` first (GLSL ES 3.00 §5.8); the CPU paths evaluated
    // the value first, so `xs[c.n] = c.bump()` stored into the element after the one written.
    const src = `"use typeshade";
class Counter {
  n: i32;
  bump(): i32 {
    this.n = this.n + 1;
    return this.n * 10;
  }
}
@fragment
export function fs(): vec4 {
  let c = new Counter();
  let xs: array<i32, 2> = [0, 0];
  xs[c.n] = c.bump();
  return vec4(f32(xs[0]), f32(xs[1]), f32(c.n), 1.);
}
`;
    expect(compile(src).wgsl).toContain('  let _seq0 = c.n;\n  xs[_seq0] = Counter_bump(&c);');
    expect(agree(src, [])).toEqual([10, 0, 1, 1]);
  });

  it('a compound assignment reads the old value before a call that changes it', () => {
    const src = `"use typeshade";
class Acc {
  total: f32;
  n: f32;
  take(): f32 {
    this.n = this.n + 1.;
    this.total = this.total * 2.;
    return this.n;
  }
  add(): void {
    this.total += this.take();
  }
}
@fragment
export function fs(): vec4 {
  let a = new Acc();
  a.total = 1.;
  a.add();
  return vec4(a.total, a.n, 0., 1.);
}
`;
    expect(compile(src).wgsl).toContain(
      'fn Acc_add(self_: ptr<function, Acc>) {\n  let _seq0 = (*self_).total;\n  (*self_).total = (_seq0 + Acc_take(self_));\n}',
    );
    // The old total, 1, plus what `take` returns, 1: the doubling `take` did is overwritten.
    expect(agree(src, [])).toEqual([2, 1, 0, 1]);
  });
});

describe('what the passes after it would have done to such a call', () => {
  it('an integer difference of two draws is not folded to zero', () => {
    // The algebraic pass folds `i - i` to 0 on a structural match, which two calls are.
    const src = fragment(
      '  const d = rng.bits() - rng.bits()\n  return vec4(f32(d % 7), 0., 0., 1.)',
    );
    expect(compile(src).wgsl).toContain(
      '  let _seq0 = Rng_bits(&rng);\n  let _seq1 = Rng_bits(&rng);\n  let d = (_seq0 - _seq1);',
    );
    const [s1, s2] = states(500, 2);
    const d = ((s1! >>> 8) - (s2! >>> 8)) >>> 0;
    expect(agree(src, [[0.5, 0]])).toEqual([d % 7, 0, 0, 1]);
  });

  it("GLSL's float % spells each operand twice, and the call is made once", () => {
    const g = compile(fragment('  const m = rng.next() % 0.25\n  return vec4(m, 0., 0., 1.)')).glsl!
      .fragment;
    const main = g.slice(g.indexOf('void main'));
    expect(main.match(/Rng_next\(rng\)/g)).toHaveLength(1);
    expect(main).toContain('  float _seq0 = Rng_next(rng);\n');
  });

  it('an unread draw still advances the generator', () => {
    const src = fragment('  const skipped = rng.next()\n  return vec4(rng.next(), 0., 0., 1.)');
    expect(compile(src).wgsl).toContain('  Rng_next(&rng);\n  let _seq0 = Rng_next(&rng);');
    expect(agree(src, [[0.5, 0]])).toEqual([draws(500, 2)[1], 0, 0, 1]);
  });

  it('a copy taken before the call keeps the value before it', () => {
    // Copy propagation read `p` where `before` was written: the effect table named the write
    // by the callee's `self_` rather than by the receiver it lands in.
    const src = `"use typeshade";
class P {
  v: f32;
  bump(): void {
    this.v = this.v + 1.;
  }
}
@fragment
export function fs(): vec4 {
  let p = new P();
  const before = p;
  p.bump();
  return vec4(before.v, p.v, 0., 1.);
}
`;
    expect(compile(src).wgsl).toContain('return vec4<f32>(before.v, p.v, 0.0, 1.0);');
    expect(agree(src, [])).toEqual([0, 1, 0, 1]);
  });

  it('field assignments that draw are not folded into a constructor, which would reorder them', () => {
    const src = `${RNG}class Pair {
  a: f32
  b: f32
}
function pair(seed: u32): Pair {
  let rng = new Rng(seed)
  let o: Pair
  o.b = rng.next()
  o.a = rng.next()
  return o
}
@fragment
export function fs(@location(0) uv: vec2): vec4 {
  const p = pair(u32(uv.x * 1000.))
  return vec4(p.a, p.b, 0., 1.)
}
`;
    expect(compile(src).wgsl).toContain(
      '  o.b = Rng_next(&rng);\n  o.a = Rng_next(&rng);\n  return o;',
    );
    const [first, second] = draws(500, 2);
    expect(agree(src, [[0.5, 0]])).toEqual([second, first, 0, 1]);
  });
});

describe('the same order for a helper that writes a module variable', () => {
  it('reads, calls and the unread call, as the source orders them', () => {
    const src = `"use typeshade";
let counter: u32 = 0;
function next(): u32 {
  counter++;
  return counter;
}
@fragment
export function fs(): vec4 {
  const unused = next();
  return vec4(f32(counter) - f32(next()), f32(next() * 2), 0., 1.);
}
`;
    const r = compile(src);
    expect(r.wgsl).toContain(
      '  next();\n  let _seq0 = f32(counter);\n  let _seq1 = next();\n  let _seq2 = next();\n  return vec4<f32>((_seq0 - f32(_seq1)), f32((_seq2 * 2u)), 0.0, 1.0);',
    );
    // `unused` takes 1; then 1 - 2; then 3 * 2.
    expect(agree(src, [])).toEqual([-1, 6, 0, 1]);
  });
});

describe('a loop condition', () => {
  it('may draw as one side of its comparison', () => {
    const src = fragment(
      '  let n = 0.\n  while (rng.next() < 0.9) {\n    n = n + 1.\n  }\n  return vec4(n, 0., 0., 1.)',
    );
    expect(compile(src).wgsl).toContain('; (Rng_next(&rng) < 0.9); ');
    const all = draws(500, 64);
    expect(agree(src, [[0.5, 0]])).toEqual([all.findIndex((x) => x >= 0.9), 0, 0, 1]);
  });

  it('refuses a draw anywhere deeper, since nothing there can move ahead of the loop', () => {
    const r = compile(
      fragment(
        '  let n = 0.\n  while (rng.next() * 2. < 1.8) {\n    n = n + 1.\n  }\n  return vec4(n, 0., 0., 1.)',
      ),
    );
    expect(r.diagnostics.map((d) => `${d.code} ${d.message}`)).toEqual([
      `${TS_CODES.LOOP_BOUND} A while condition runs "rng.next()" on every iteration, and a call that writes can stand there only as one side of the comparison. Compare the call alone against the bound, or call it into a let at the end of the body and compare that.`,
    ]);
  });
});

describe('the debugger', () => {
  it('stops on each call it binds, then on the statement', () => {
    const src = fragment('  return vec4(rng.next(), rng.next(), 0., 1.)');
    const r = compile(src);
    const s = startDebugSession(r.module, 'fs', [[0.5, 0]]);
    const starts: number[] = [];
    while (s.pause) {
      starts.push(s.pause.span.start);
      s.stepOver();
    }
    const ret = src.indexOf('return vec4');
    const first = src.indexOf('rng.next()', ret);
    const second = src.indexOf('rng.next()', first + 1);
    expect(starts.slice(-3)).toEqual([first, second, ret]);
  });
});
