// === #48: a call cycle must be a diagnostic, not emitted WGSL ===
//
// Every arm in the REJECTING describes below compiled with zero diagnostics and emitted a
// recursive `fn` before the check in `recursion.ts`. (The negative-guard arms are the opposite:
// they compiled before and must still compile now.) Tint's verdict on those emits, measured
// through the same instrument `scripts/compile-gate.ts` uses:
//
//   fn fact(n: i32) -> i32 { … return n * fact(n - 1); }   REJECTED
//       1:1 cyclic dependency found: 'fact' -> 'fact'
//   fn a … return b(…);  fn b … return a(…);               REJECTED
//       1:1 cyclic dependency found: 'a' -> 'b' -> 'a'
//   fn twice(n: i32) -> i32 { return n * 2; }              ACCEPTED
//
// The third line is the instrument check: the harness that produced the two rejections also
// accepts a non-recursive module, so the rejections are verdicts and not a broken probe.

import { describe, expect, it } from 'vitest';
import { compileTsSource } from './source-file.js';
import { compileTsSources } from './module.js';

const fs = (body: string): string =>
  `"use typeshade"\n${body}\n@fragment\nexport function main_fs(): vec4 { return vec4(0., 0., 0., 1.) }\n`;

const errorsOf = (src: string): { code?: string; message: string; line: number }[] =>
  compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => ({ code: d.code, message: d.message, line: d.line }));

describe('#48 — a call cycle is rejected at the call site that closes it', () => {
  it('direct self-recursion', () => {
    const src = fs(`export function fact(n: i32): i32 {
  if (n <= 1) { return i32(1) }
  return n * fact(n - 1)
}`);
    const errors = errorsOf(src);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('TS8031');
    expect(errors[0]?.message).toContain('"fact" -> "fact"');
    // Nothing is emitted: the whole point is that this WGSL never reaches a driver.
    expect(compileTsSource(src).wgsl).toBeUndefined();
  });

  it('mutual recursion, which the noRecursion lint rule does not see', () => {
    // `noRecursion` tests `e.fn === fn.name` — a function calling ITSELF — so moving it into
    // CORE_RULES would leave this arm compiling and emitting. Tint rejects it all the same.
    const errors = errorsOf(
      fs(`export function a(n: i32): i32 {
  if (n <= 0) { return i32(0) }
  return b(n - 1)
}
export function b(n: i32): i32 {
  if (n <= 0) { return i32(1) }
  return a(n - 1)
}`),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('"a" -> "b" -> "a"');
  });

  it('a three-hop cycle names every hop', () => {
    const errors = errorsOf(
      fs(`export function a(n: i32): i32 { if (n <= 0) { return i32(0) } return b(n - 1) }
export function b(n: i32): i32 { if (n <= 0) { return i32(0) } return c(n - 1) }
export function c(n: i32): i32 { if (n <= 0) { return i32(0) } return a(n - 1) }`),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('"a" -> "b" -> "c" -> "a"');
  });

  it('reports the CALL, not the directive — the whole reason this is not a core rule', () => {
    // A core-rule failure arrives as one TS8015 anchored on the first statement. Line 4 here is
    // the `return n * fact(n - 1)`; line 1 would be `"use typeshade"`.
    const errors = errorsOf(
      `"use typeshade";
export function fact(n: i32): i32 {
  if (n <= 1) { return i32(1); }
  return n * fact(n - 1);
}
@fragment
export function main_fs(): vec4 { return vec4(0., 0., 0., 1.); }
`,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('TS8031');
    expect(errors[0]?.line).toBe(4);
  });

  it('one diagnostic per cycle, however many functions reach it', () => {
    // Three entry points all reach the same `a -> b -> a`. A per-edge or per-entry report would
    // give three copies of the same problem.
    const errors = errorsOf(
      fs(`export function a(n: i32): i32 { if (n <= 0) { return i32(0) } return b(n - 1) }
export function b(n: i32): i32 { if (n <= 0) { return i32(0) } return a(n - 1) }
export function p(n: i32): i32 { return a(n) }
export function q(n: i32): i32 { return b(n) }
export function r(n: i32): i32 { return p(n) + q(n) }`),
    );
    expect(errors).toHaveLength(1);
  });
});

describe('#48 — a call in statically dead code is still a cycle, deliberately', () => {
  // These are the one class where this check is STRICTER than the target language. On `main`
  // each compiled, the emitter's `deadBranch`/DCE dropped the call, and the emitted `fn f` was
  // non-recursive and accepted by Tint. They are rejected now, and that is the decision — not
  // an oversight — because matching the optimizer would make the rule unpredictable: measured,
  // `if (false)` IS folded and `if (DEBUG)` for `const DEBUG: bool = false` is NOT, so the two
  // spellings of one idea would get opposite answers. See `recursion.ts`'s header.
  const rejects = (body: string): void => {
    const errors = errorsOf(fs(body));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('TS8031');
  };

  it('a call under a literal-false branch', () => {
    rejects(`export function f(n: i32): i32 { if (false) { return f(n - 1) } return n }`);
  });

  it('a call under a condition that folds to false', () => {
    rejects(`export function f(n: i32): i32 { if (1 > 2) { return f(n - 1) } return n }`);
  });

  it('a call bound to a name nobody reads', () => {
    rejects(`export function f(n: i32): i32 { const unused = f(n - 1)\n return n }`);
  });

  it('the contrast case, which the optimizer does NOT fold, is rejected for the ordinary reason', () => {
    // `const DEBUG: bool = false` is not const-folded into the branch, so `main` emitted
    // genuinely recursive WGSL here. Same verdict as the three above, different reason — which
    // is exactly the point: one rule, not two.
    rejects(`const DEBUG: bool = false
export function f(n: i32): i32 { if (DEBUG) { return f(n - 1) } return n }`);
  });
});

describe('#48 — what is NOT a cycle still compiles', () => {
  it('a shared helper called twice from one function', () => {
    const src = fs(
      `export function twice(n: i32): i32 { return n * i32(2) }
export function quad(n: i32): i32 { return twice(twice(n)) }`,
    );
    expect(errorsOf(src)).toEqual([]);
    expect(compileTsSource(src).wgsl).toContain('fn quad');
  });

  it('a diamond — two callers of one callee — is not a cycle', () => {
    const src = fs(
      `export function leaf(n: i32): i32 { return n + i32(1) }
export function l(n: i32): i32 { return leaf(n) }
export function r(n: i32): i32 { return leaf(n) }
export function top(n: i32): i32 { return l(n) + r(n) }`,
    );
    expect(errorsOf(src)).toEqual([]);
  });

  it('intrinsic and constructor calls are not graph edges', () => {
    // `sin`, `vec2` and friends resolve to no user function, so they must not become edges —
    // a resolver that returned the callee text unconditionally would make `sin` call itself.
    const src = fs(
      `export function wave(x: f32): f32 { return sin(x) * length(vec2(x, x)) }
export function twice(x: f32): f32 { return wave(x) + wave(x) }`,
    );
    expect(errorsOf(src)).toEqual([]);
  });

  it('a long acyclic chain is not mistaken for a cycle', () => {
    // Depth is not a cycle. A DFS that marked a node grey and never blackened it, or that
    // keyed on "seen before" rather than "on the stack", would fail here and nowhere above.
    const chain = Array.from(
      { length: 12 },
      (_, i) =>
        `export function f${String(i)}(n: i32): i32 { return ${i === 11 ? 'n' : `f${String(i + 1)}(n)`} }`,
    ).join('\n');
    expect(errorsOf(fs(chain))).toEqual([]);
  });
});

describe('#48 — the cycle is reported once, not once per caller', () => {
  it('a self-recursive function called from two places is still one diagnostic', () => {
    const errors = errorsOf(
      fs(`export function down(n: i32): i32 { if (n <= 0) { return i32(0) } return down(n - 1) }
export function p(n: i32): i32 { return down(n) }
export function q(n: i32): i32 { return down(n) }`),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('"down" -> "down"');
  });
});

describe('#48 — across files, where a cycle can be spelled through an import', () => {
  const file = (fileName: string, source: string): { fileName: string; source: string } => ({
    fileName,
    source,
  });

  it('catches a cycle whose hop goes through an import ALIAS', () => {
    // `helper as h` is why the resolver goes through each file's callee map rather than
    // matching identifier text against function names: the call reads `h`, the cycle is
    // `top -> helper -> top`, and the message must name the emitted functions.
    const r = compileTsSources([
      file(
        'a.ts',
        `"use typeshade";
import { helper as h } from "./b";
export function top(n: i32): i32 { if (n <= 0) { return i32(0); } return h(n - 1); }
`,
      ),
      file(
        'b.ts',
        `"use typeshade";
import { top } from "./a";
export function helper(n: i32): i32 { if (n <= 0) { return i32(1); } return top(n - 1); }
`,
      ),
    ]);
    const errors = r.diagnostics.filter((d) => d.category === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('TS8031');
    expect(errors[0]?.message).toContain('"top" -> "helper" -> "top"');
    // Anchored in the file that closes the cycle, not the one the walk started in.
    expect(errors[0]?.fileName).toBe('b.ts');
    expect(r.wgsl).toBeUndefined();
  });

  it('the path doc-snippets certifies the docs through checks too', () => {
    // This arm was written against `sources.ts`, the second `compileTsSources`, because that
    // was the one `doc-snippets.test.ts` used and it had no recursion check at all: measured
    // before #49, both of these emitted their bodies with zero diagnostics. There is one
    // compiler now, so the arm points at it — which is the stronger statement, since the docs
    // gate and every other caller are certified by the same code path rather than by two.
    const self = compileTsSources([
      file(
        'a.ts',
        `"use typeshade";
export function fact(n: i32): i32 { if (n <= 1) { return i32(1); } return n * fact(n - 1); }
@fragment
export function fs(): vec4 { return vec4(f32(fact(i32(5))), 0., 0., 1.); }
`,
      ),
    ]);
    const selfErrors = self.diagnostics.filter((d) => d.category === 'error');
    expect(selfErrors).toHaveLength(1);
    expect(selfErrors[0]?.code).toBe('TS8031');
    expect(self.wgsl).toBeUndefined();

    const cross = compileTsSources([
      file(
        'a.ts',
        `"use typeshade";
import { helper as h } from "./b";
export function top(n: i32): i32 { if (n <= 0) { return i32(0); } return h(n - 1); }
`,
      ),
      file(
        'b.ts',
        `"use typeshade";
import { top } from "./a";
export function helper(n: i32): i32 { if (n <= 0) { return i32(1); } return top(n - 1); }
`,
      ),
    ]);
    const crossErrors = cross.diagnostics.filter((d) => d.category === 'error');
    expect(crossErrors).toHaveLength(1);
    expect(crossErrors[0]?.message).toContain('"top" -> "helper" -> "top"');
    expect(cross.wgsl).toBeUndefined();
  });

  it('an acyclic multi-file program still emits through that same path', () => {
    const r = compileTsSources([
      file(
        'a.ts',
        `"use typeshade";
import { helper as h } from "./b";
export function top(n: i32): i32 { return h(n); }
`,
      ),
      file('b.ts', `"use typeshade"\nexport function helper(n: i32): i32 { return n * i32(2) }\n`),
    ]);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('fn top');
  });

  it('a same-named node in another file contributes its edges rather than vanishing', () => {
    // Two files each declare `helper`, the second recursive. Keeping only the first node meant
    // the second's calls left the graph and nothing was reported. The emit is separately
    // invalid here (Tint: `redeclaration of 'helper'`) because the multi-file compiler does
    // not check duplicates ACROSS files — that is the real defect underneath, and not this
    // change's to fix — but the graph must not lose a node silently.
    const errors = compileTsSources([
      {
        fileName: 'a.ts',
        source: `"use typeshade"\nexport function helper(n: i32): i32 { return n + i32(1) }\n`,
      },
      {
        fileName: 'b.ts',
        source: `"use typeshade";
export function helper(n: i32): i32 { if (n <= 0) { return i32(0); } return helper(n - 1); }
`,
      },
    ]).diagnostics.filter((d) => d.category === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('TS8031');
  });

  it('an acyclic import chain still emits', () => {
    const r = compileTsSources([
      file(
        'a.ts',
        `"use typeshade";
import { helper as h } from "./b";
export function top(n: i32): i32 { return h(n); }
`,
      ),
      file('b.ts', `"use typeshade"\nexport function helper(n: i32): i32 { return n * i32(2) }\n`),
    ]);
    expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(r.wgsl).toContain('fn top');
  });
});
