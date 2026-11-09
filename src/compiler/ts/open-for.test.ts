// Every `for` loop TypeScript accepts compiles, except one proved never to end (change 0136).
//
// A `for` that is not counted is an open loop, as a `while` is: the IR `for` with no `counted`.
// Each header below was refused before change 0136, most often with a sentence that said to
// write the loop as a `while`. Read twice, as every program an author writes is (CLAUDE.md, "A
// test reads both halves"): `compile()`'s diagnostics and emit, and the language service's
// diagnostics and hover on the same source. The value each loop computes is held on both CPU
// engines, the oracle and the codegen; the WGSL and the GLSL ES 3.00 each print the loop, and
// the compile gate's open-loop leg holds them to Tint and ANGLE (Rule 13.3).
//
// Verifies: Rule 7.5 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import { compile } from './compile.js';
import { compileModule } from '../../core/oracle.js';
import { compileModuleJs } from '../../core/cpu-codegen.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';
import type { Stmt } from '../../core/ir/nodes.js';

/** A module with one function `f(n: i32): f32`, `body` its statements. */
const module = (body: string): string => `"use typeshade";
interface U { n: i32; m: u32 }
declare const u: uniform<U>;
export function f(n: i32): f32 {
${body}
}
`;

const errorsOf = (src: string): string[] =>
  compile(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

const editorErrorsOf = (src: string): string[] => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', src);
  return service
    .getDiagnostics('a.shade.ts')
    .filter((d) => d.severity === 'error')
    .map((d) => `${String(d.code)} ${d.message}`);
};

/** The hover text at the `offset`th character of the first `needle` in `src`. */
const hoverAt = (src: string, needle: string, offset = 0): string | undefined => {
  const service = createTypeshadeLanguageService();
  service.openDocument('a.shade.ts', src);
  const before = src.slice(0, src.indexOf(needle) + offset).split('\n');
  return service.getHover('a.shade.ts', {
    line: before.length - 1,
    character: before[before.length - 1]!.length,
  })?.contents;
};

/** Every `for` statement of the module's functions, outermost first. */
function loopsOf(src: string): (Stmt & { s: 'for' })[] {
  const out: (Stmt & { s: 'for' })[] = [];
  const walk = (body: readonly Stmt[]): void => {
    for (const s of body) {
      if (s.s === 'for') {
        out.push(s);
        walk(s.body);
      } else if (s.s === 'if') {
        s.arms.forEach((a) => walk(a.body));
        if (s.elseBody) walk(s.elseBody);
      }
    }
  };
  for (const fn of compile(src).module.funcs) walk(fn.body);
  return out;
}

/** The headers of item 1 of change 0136 that were refused only for not being counted, the body
 *  each runs, and what `f(n)` returns for each `n` of `[n, value]`. */
const OPEN: readonly (readonly [string, string, readonly (readonly [number, number])[]])[] = [
  [
    'no condition, left at a break',
    'let a = 0.; for (;;) { a += 1.; if (a > 3.) { break; } } return a;',
    [[0, 4]],
  ],
  [
    'an f32 counter from its initializer',
    'let a = 0.; for (let x = 0.; x < 1.; x += 0.25) { a += x; } return a;',
    [[0, 1.5]],
  ],
  [
    'an annotated f32 counter',
    'let a = 0.; for (let x: f32 = 0.; x < 1.; x += 0.25) { a += x; } return a;',
    [[0, 1.5]],
  ],
  [
    'two declarations and a comma update',
    'let a = 0.; for (let i = 0, j = 10; i < j; i++, j--) { a += 1.; } return a;',
    [[0, 5]],
  ],
  [
    'an assignment as the initializer',
    'let a = 0.; let k: i32 = 0; for (k = 2; k < 6; k++) { a += f32(k); } return a;',
    [[0, 14]],
  ],
  [
    'no initializer',
    'let a = 0.; let k: i32 = 2; for (; k < 6; k++) { a += f32(k); } return a;',
    [[0, 14]],
  ],
  ['no update', 'let a = 0.; for (let i = 0; i < 6;) { i += 2; a += 1.; } return a;', [[0, 3]]],
  [
    'a bound the body writes',
    'let a = 0.; let m: i32 = n; for (let i = 0; i < m; i++) { m -= 1; a += 1.; } return a;',
    [
      [10, 5],
      [0, 0],
    ],
  ],
  [
    'a condition that is not a comparison',
    'let a = 0.; let done = false; for (let i = 0; !done; i++) { a += 1.; if (i > 4) { done = true; } } return a;',
    [[0, 6]],
  ],
  [
    'an exit joined with another test',
    'let a = 0.; for (let i = 0; i < n && a < 3.; i++) { a += 1.; } return a;',
    [
      [10, 3],
      [2, 2],
    ],
  ],
  [
    '!= against a runtime bound',
    'let a = 0.; for (let i = 0; i != n; i++) { a += 1.; } return a;',
    [
      [4, 4],
      [0, 0],
    ],
  ],
  [
    'an update that is not a constant step, with continue',
    'let a = 0.; for (let i = 1; i < 100; i = i * 3 + 1) { if (i == 4) { continue; } a += f32(i); } return a;',
    [[0, 54]],
  ],
  [
    'a shift as the update',
    'let a = 0.; for (let i = n; i !== 0; i >>= 1) { a += 1.; } return a;',
    [
      [37, 6],
      [0, 0],
    ],
  ],
  [
    'a member as the update',
    'let a = 0.; let v = vec2(0., 0.); for (let i = 0; i < 4; v.x += 1.) { a += v.x; if (v.x > 2.) { break; } } return a;',
    [[0, 6]],
  ],
  [
    'two updates and a continue nested in a switch',
    'let a = 0.; for (let i = 0, j = 10; i < j; i++, j--) { switch (i) { case 2: { continue; } default: { a += f32(j); } } } return a;',
    [[0, 32]],
  ],
];

describe('a for that is not counted is an open loop (Rule 7.5, change 0136)', () => {
  for (const [name, body, runs] of OPEN) {
    it(`compiles ${name}, in both halves and on both CPU engines`, () => {
      const src = module(body);
      expect(errorsOf(src)).toEqual([]);
      expect(editorErrorsOf(src)).toEqual([]);
      const c = compile(src);
      expect(c.wgsl).toMatch(/\bfor \(/);
      expect(c.glsl?.fragment ?? '').toMatch(/\bfor \(/);
      // The open loop carries no counted fact; the proof of a kernel function reads that.
      expect(loopsOf(src).every((l) => l.counted === undefined)).toBe(true);
      for (const make of [compileModule, compileModuleJs]) {
        const fn = make(c.module).fns['f']!;
        for (const [n, value] of runs) expect(fn(n), `${make.name}(${n})`).toBe(value);
      }
    });
  }

  it('keeps a counted header counted, with the emit it had', () => {
    const src = module('let a = 0.; for (let i = 0; i < 10; i++) { a += 1.; } return a;');
    expect(loopsOf(src)[0]!.counted).toEqual({
      name: 'i',
      op: 'add',
      step: 1,
      start: 0,
      bound: 10,
      trips: 10,
    });
    // A float literal against an integer bound is the i32 counter it was before the change.
    const float = module('let a = 0.; for (let i = 0.; i < 10; i++) { a += f32(i); } return a;');
    expect(loopsOf(float)[0]!.counted?.trips).toBe(10);
    expect(compile(float).eval('f', [0])).toBe(45);
  });

  it('keeps one header in the shape of WGSL when it fits, and runs the rest at the end of the body', () => {
    const f32Counter = compile(
      module('let a = 0.; for (let x = 0.; x < 1.; x += 0.25) { a += x; } return a;'),
    );
    expect(f32Counter.wgsl).toContain('for (var x: f32 = 0.0; (x < 1.0); x += 0.25) {');
    expect(f32Counter.glsl?.fragment ?? '').toContain(
      'for (float x = 0.0; (x < 1.0); x += 0.25) {',
    );
    const two = compile(
      module(
        'let a = 0.; for (let i = 0, j = 10; i < j; i++, j--) { if (i == 2) { continue; } a += f32(j); } return a;',
      ),
    );
    expect(two.wgsl).toContain('var i: i32 = 0;\n  var j: i32 = 10;\n  for (var _w: i32 = 0;');
    expect(two.wgsl).toContain('i = (i + 1);\n      j = (j - 1);\n      continue;');
  });

  it('emits for (;;) as it emits while (true)', () => {
    const loop = (head: string): string | undefined =>
      compile(
        module(
          `let r = 1.; ${head} { const next = 0.5 * (r + 4. / r); if (abs(next - r) < 0.0001) { break; } r = next; } return r;`,
        ),
      ).wgsl;
    expect(loop('for (;;)')).toBe(loop('while (true)'));
  });

  it('reads the counter in a local function as a per-trip binding would', () => {
    // ECMAScript gives a `let` of a `for` header a fresh binding on each trip; a local function
    // (Rule 8.17) called in the trip reads the trip's value either way.
    const src = module(`let a = 0.;
  for (let x = 0.; x < 1.; x += 0.25) {
    function twice(): f32 { return x * 2.; }
    a += twice();
  }
  return a;`);
    expect(errorsOf(src)).toEqual([]);
    expect(compile(src).eval('f', [0])).toBe(3);
  });
});

describe('a loop proved never to end stays refused (Rule 7.5, change 0136)', () => {
  const ROWS: readonly (readonly [string, string])[] = [
    [
      'let a = 0.; for (;;) { a += 1.; } return a;',
      'TS8007 for (;;) has no break or return in its body, so it never ends. Leave it with a break, or write the exit into the condition.',
    ],
    [
      'let a = 0.; for (let i = 0; true; i++) { a += 1.; } return a;',
      'TS8007 for (let i = 0; true; i++) has no break or return in its body, so it never ends. Leave it with a break, or write the exit into the condition.',
    ],
    [
      'let a = 0.; for (let i = 0; i < 10; i += 0) { a += 1.; } return a;',
      'TS8007 for step "i += 0" never advances "i": a step of 0 leaves it where it is.',
    ],
    [
      'let a = 0.; for (let i = 0; i < 10; i--) { a += 1.; } return a;',
      'TS8007 for (i = 0; i < 10; i -= 1) does not exit.',
    ],
    [
      'let a = 0.; for (let i: u32 = 0; i <= 4294967295; i++) { a += 1.; } return a;',
      'TS8006 for (i = 0; i <= 4294967295; i += 1) walks "i" outside the range of u32 before the condition fails.',
    ],
  ];
  for (const [body, sentence] of ROWS) {
    it(`refuses ${body.slice(12, 60)}, in both halves`, () => {
      const src = module(body);
      expect(errorsOf(src)).toEqual([sentence]);
      expect(editorErrorsOf(src)).toEqual([sentence]);
    });
  }

  it('keeps the rules that are not Rule 7.5', () => {
    // An increment used as a value is a statement, not a value, in a `for` as in a `while`.
    const src = module('let a = 0.; for (let i = 0; i++ < 5;) { a += 1.; } return a;');
    expect(errorsOf(src)).toEqual(['TS8099 ++/-- is a statement, not a value.']);
    expect(editorErrorsOf(src)).toEqual(['TS8099 ++/-- is a statement, not a value.']);
  });

  it('compiles a typing mistake in a counted header as an open loop, the cost change 0136 records', () => {
    const src = module(
      'let a = 0.; let j = 0; for (let i = 0; i < n; j++) { a += 1.; if (j > 5) { break; } } return a;',
    );
    expect(errorsOf(src)).toEqual([]);
    expect(loopsOf(src)[0]!.counted).toBeUndefined();
  });
});

describe('the editor shows the counter the compiler counts with (Rule 12.7)', () => {
  const src = `"use typeshade";
declare const xs: storage<array<f32>>;
export const fs = fragment(function fs(uv: location<0, vec2>): vec4 {
  let a = 0.;
  for (let i = 0; i < 10; i++) { a += 1.; }
  for (let k = 0; k < xs.length; k++) { a += xs[k]; }
  for (let x = 0.; x < 1.; x += 0.25) { a += x; }
  for (let p = 0, q = 10; p < q; p++, q--) { a += f32(q); }
  return vec4(a, uv.x, 0., 1.);
});
`;
  it('hovers an integer-literal counter as i32, against a storage length as u32, and a float one as f32', () => {
    expect(hoverAt(src, 'let i', 4)).toContain('let i: i32');
    expect(hoverAt(src, 'let k', 4)).toContain('let k: u32');
    expect(hoverAt(src, 'let x', 4)).toContain('let x: f32');
    expect(hoverAt(src, 'let p', 4)).toContain('let p: i32');
    expect(hoverAt(src, 'q = 10', 0)).toContain('q: i32');
  });
});
