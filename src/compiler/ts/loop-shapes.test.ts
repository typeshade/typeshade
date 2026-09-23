// Loop diagnostics and the multiplicative step (#8 A15).
//
// Two things were wrong with the way this surface answered a `for` loop. A loop that exits
// too LATE was reported as one that does not exit at all, because the trip counter walked the
// sequence and could only look `MAX_LOOP_TRIPS + 2` steps ahead — so a policy violation wore
// the words of a non-terminating loop. And `i *= 2`, an ordinary counted loop that reaches its
// bound in six iterations, was "Unsupported for-update" because nothing lowered it.
//
// The multiplicative step has no `fn()` EDSL spelling: `forRange` builds an additive loop and
// nothing else, so ir-equality.test.ts cannot pin `i *= 2` against a twin the way it pins the
// rest of this surface. Until `forRange` takes a step operation, the CPU count below is what
// stands in for that: the interpreter and the generator both run the emitted loop and both
// have to agree with the sequence written out beside the assertion.
//
// What a loop is told beside that (change 0008): an update none of the counted forms is one
// sentence and is never dropped, `while (ON)` is `while (true)`, an `&&` exit names its extra
// clause, and a loop's hidden counter is a name the source cannot reach.
//
// Verifies: Rule 7.5 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { compileTsSource, type TsCompilerDiagnostic } from './source-file.js';
import { compile } from './compile.js';
import { LoweringScope } from './context.js';
import { lowerStatements } from './lower/statement.js';

/** One loop, as a whole module, with `head` spliced into the `for`. */
function loop(head: string): string {
  return `"use typeshade";
    export function f(): f32 {
      let a = 0.;
      for (${head}) {
        a += 1.;
      }
      return a;
    }
  `;
}

function diagnose(head: string): string {
  const r = compileTsSource(loop(head));
  expect(r.diagnostics.length).toBeGreaterThan(0);
  return r.diagnostics[0]!.message;
}

/** Every error of a whole module, as code and text (Rule 12.5). */
function errorsOf(src: string): { code?: string; message: string }[] {
  return compileTsSource(src)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => ({ code: d.code, message: d.message }));
}

/** The TS8008 sentence, for the counter `i`: one wording for every update none of the forms. */
const NOT_A_STEP = {
  code: 'TS8008',
  message: 'for-update must be i++ / i += <const>, or i *= / /= <const>.',
};

function accepts(head: string): void {
  const r = compileTsSource(loop(head));
  expect(r.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
}

/** How many times the loop's body runs, on the CPU, once the header is accepted. */
function trips(head: string): unknown {
  const c = compile(loop(head));
  expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
  return c.eval('f', []);
}

describe('a trip count has no ceiling (Rule 7.5, #203)', () => {
  it('accepts a loop of any length, where 256 trips used to be the most', () => {
    // These were `for trip count N exceeds 256.` Neither target limits a trip count, and
    // nothing downstream read the ceiling but the check itself (#203).
    expect(trips('let i: i32 = 0; i < 1024; i++')).toBe(1024);
    expect(trips('let i: u32 = u32(0); i < u32(100000); i++')).toBe(100000);
    expect(trips('let i: i32 = 0; i < 4096; i += 4')).toBe(1024);
    expect(trips('let i: i32 = 257; i > 0; i -= 1')).toBe(257);
    // A loop whose condition is false at the start runs zero times and is not an error.
    expect(trips('let i: i32 = 8; i < 4; i++')).toBe(0);
  });

  it('keeps "does not exit" for a loop that really does not', () => {
    expect(diagnose('let i: i32 = 0; i < 16; i -= 1')).toBe(
      'for (i = 0; i < 16; i -= 1) does not exit.',
    );
    // 0 * 2 is 0 forever, so this one is genuinely stuck even though the factor advances.
    expect(diagnose('let i: i32 = 0; i < 64; i *= 2')).toBe(
      'for (i = 0; i < 64; i *= 2) does not exit.',
    );
  });
});

describe('a multiplicative step is a counted loop', () => {
  it('accepts *= and /=, and emits the update as written', () => {
    const r = compileTsSource(loop('let i: i32 = 1; i < 64; i *= 2'));
    expect(r.diagnostics).toEqual([]);
    expect(r.wgsl).toContain('i *= 2');
    const down = compileTsSource(loop('let i: i32 = 64; i > 1; i /= 2'));
    expect(down.diagnostics).toEqual([]);
    expect(down.wgsl).toContain('i /= 2');
  });

  it('accepts -= too, which was refused for the same reason', () => {
    accepts('let i: i32 = 8; i > 0; i -= 1');
    accepts('let i: i32 = 16; i > 0; i -= 4');
  });

  it('runs the right number of times on the CPU', () => {
    const c = compile(`
      "use typeshade";
      export function doubling(): f32 {
        let a = 0.;
        for (let i: i32 = 1; i < 64; i *= 2) {
          a += 1.;
        }
        return a;
      }
      export function halving(): f32 {
        let a = 0.;
        for (let i: i32 = 64; i > 1; i /= 2) {
          a += 1.;
        }
        return a;
      }
      export function down(): f32 {
        let a = 0.;
        for (let i: i32 = 8; i > 0; i -= 2) {
          a += 1.;
        }
        return a;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.eval('doubling', [])).toBe(6); // 1 2 4 8 16 32
    expect(c.eval('halving', [])).toBe(6); // 64 32 16 8 4 2
    expect(c.eval('down', [])).toBe(4); // 8 6 4 2
  });

  it('refuses a step that cannot advance, each for its own reason', () => {
    // One message — "step of i is 0" — used to cover a case it did not fit and three it never
    // reached, since the other three could not be spelled at all.
    expect(diagnose('let i: i32 = 0; i < 16; i += 0')).toBe(
      'for step "i += 0" never advances "i": a step of 0 leaves it where it is.',
    );
    expect(diagnose('let i: i32 = 1; i < 64; i *= 1')).toBe(
      'for step "i *= 1" never advances "i": multiplying or dividing by 1 leaves it where it is.',
    );
    expect(diagnose('let i: i32 = 1; i < 64; i *= 0')).toBe(
      'for step "i *= 0" never advances "i": multiplying by 0 pins it at 0.',
    );
    // Not "undefined on both targets": WGSL DEFINES integer `x / 0` as `x`, which is exactly
    // why the loop is stuck rather than unpredictable.
    expect(diagnose('let i: i32 = 64; i > 1; i /= 0')).toBe(
      'for step "i /= 0" never advances "i": dividing by 0 cannot move it.',
    );
  });

  it('refuses a step the induction type cannot hold, at the source', () => {
    // These used to be retyped to a literal the type cannot spell — `{ op: 'lit', type: i32,
    // value: 2.5 }` — and only the BACKEND caught them, as an SD0017 out of compile() naming
    // a literal the author's source does not contain. `fitsTarget` is the predicate #8 A3
    // uses at a declaration, so a step and an initializer agree on what an integer holds.
    expect(diagnose('let i: i32 = 1; i < 64; i *= 2.5')).toBe(
      'for step "i *= 2.5" does not fit "i", which is i32: 2.5 is not a whole number.',
    );
    expect(diagnose('let i: i32 = 0; i < 16; i += 3000000000')).toBe(
      'for step "i += 3000000000" does not fit "i", which is i32: 3000000000 is outside its range.',
    );
    expect(diagnose('let i: u32 = u32(0); i < u32(16); i += -1')).toBe(
      'for step "i += -1" does not fit "i", which is u32: -1 is outside its range.',
    );
    // A step WRITTEN as a float but valued as a whole number is still accepted, because it was
    // before: `i += 2.0` emitted `i += 2` on the merge base and still does. Refusing it here
    // would take back source that compiles.
    accepts('let i: i32 = 0; i < 16; i += 2.0');
    accepts('let i: i32 = 0; i < 16; i += (1.5 + 1.5)');
  });

  it('names the forms it takes when the update is none of them', () => {
    // `%=` is not one of the four the update table takes — a remainder step is a fixed point
    // after one application, so no `for` it heads exits — and an assignment that is not a
    // step spelled out is not an update shape at all. Each stops in lowerUpdate, before the
    // counting, and used to be `TS8099 Unsupported for-update.`, which named no form; it now
    // says what the counter says of `j += 1`, so one mistake reads one way (Rule 12.4).
    for (const update of ['i %= 3', 'i = i * i', 'i = i * 2', 'i <<= 1', 'i++, a++', '-i']) {
      expect(errorsOf(loop(`let i: i32 = 1; i < 16; ${update}`)), update).toEqual([NOT_A_STEP]);
    }
    // A step that lowers but is not a compile-time constant reaches the counter, which names
    // the forms it can read.
    const r = compileTsSource(`"use typeshade";
      export function f(n: i32): f32 {
        let a = 0.;
        for (let i: i32 = 1; i < 64; i *= n) {
          a += 1.;
        }
        return a;
      }
    `);
    expect(r.diagnostics.map((d) => ({ code: d.code, message: d.message }))).toEqual([NOT_A_STEP]);
  });
});

describe('the exact count handles every comparison', () => {
  it('counts <, <=, > and >= and the step sizes between them', () => {
    accepts('let i: i32 = 0; i < 16; i += 3'); // 0 3 6 9 12 15
    accepts('let i: i32 = 0; i <= 16; i += 3');
    accepts('let i: i32 = 16; i > 0; i -= 3');
    accepts('let i: i32 = 16; i >= 0; i -= 3');
    // An exact count for each of the four thresholds, so the loop the closed form accepts is
    // the loop that runs. `>=` and `<=` run the extra trip that lands ON the bound.
    expect(trips('let i: i32 = 0; i <= 1024; i += 2')).toBe(513);
    expect(trips('let i: i32 = 0; i < 1024; i += 2')).toBe(512);
    expect(trips('let i: i32 = 0; i > -1024; i--')).toBe(1024);
    expect(trips('let i: i32 = 0; i >= -1024; i -= 1')).toBe(1025);
  });

  it('counts !== as hitting a value, not as crossing a threshold', () => {
    accepts('let i: i32 = 0; i !== 16; i += 2');
    expect(trips('let i: i32 = 0; i !== 1024; i++')).toBe(1024);
    // A bound the step steps straight over is never reached.
    // The message prints the IR's own comparison tag, which is WGSL's `!=`.
    expect(diagnose('let i: i32 = 0; i !== 9; i += 2')).toBe(
      'for (i = 0; i != 9; i += 2) does not exit.',
    );
    // `!==` needs no induction-range check of its own, unlike the four thresholds: it only
    // counts when the walk lands EXACTLY on the bound, so every value it visits lies between
    // the start and the bound and the last one IS the bound. A bound the type cannot hold is
    // therefore a bound LITERAL the type cannot hold, and it is refused where it is spelled:
    // an integer literal outside i32 does not take the induction variable's type (#8 A3), so
    // it stays f32 and the comparison itself is what says no. Pinned here so that "this arm
    // has no range check" stays a fact about a covered case.
    expect(diagnose('let i: i32 = 2147483645; i !== 2147483650; i += 1')).toBe(
      'Type mismatch: cannot compare i32 and f32 — no implicit int/float conversion. ' +
        'Cast explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
    );
  });

  it('separates a loop that never exits from one that runs out of the type', () => {
    // 1 3 9 … 1162261467, and the next value is 3486784401, which an i32 cannot hold. The
    // loop does reach its bound; what the hardware does on the way is overflow, not an exit.
    // One `undefined` used to cover this and the genuinely stuck loop above, so both were
    // told "does not exit", and only one of them was.
    expect(diagnose('let i: i32 = 1; i < 2147483647; i *= 3')).toBe(
      'for (i = 1; i < 2147483647; i *= 3) walks "i" outside the range of i32 before the condition fails.',
    );
    // The closed form has the same case: the value AFTER the final trip is computed before the
    // condition rejects it, and 2147484000 is not an i32.
    expect(diagnose('let i: i32 = 2147483000; i < 2147483647; i += 1000')).toBe(
      'for (i = 2147483000; i < 2147483647; i += 1000) walks "i" outside the range of i32 before the condition fails.',
    );
    // A u32 loop that walks down to exactly 0 stays inside its own range and is accepted.
    accepts('let i: u32 = u32(4); i > u32(0); i -= 1');
  });
});

/** A compute module whose one entry holds `body`, beside a written storage array `out`. */
function kernel(body: string, top = ''): string {
  return `"use typeshade";
    declare const out: storage<array<f32>, "read_write">;
    ${top}
    @compute([64])
    export function main(): void {
      ${body}
      out[1] = 2.;
    }
  `;
}

describe('a for update is lowered or refused, never dropped (Rules 7.5, 12.6)', () => {
  // Each of these compiled with no diagnostic, and the whole loop, body and all, was missing
  // from the WGSL and the GLSL: `lowerUpdate` returned nothing for a compound assignment to
  // a member, an element or an unknown name, and nothing said so.
  it('refuses a member or an element with the sentence `v.x++` and `j += 1` get', () => {
    const member = kernel(`
      let v = vec2(0., 0.);
      for (let i: i32 = 0; i < 16; v.x += 1.) { out[0] = 5.; }
    `);
    expect(errorsOf(member)).toEqual([NOT_A_STEP]);
    const element = kernel(`
      let xs: array<i32, 2> = [0, 0];
      for (let i: i32 = 0; i < 8; xs[0] += 1) { out[0] = 5.; }
    `);
    expect(errorsOf(element)).toEqual([NOT_A_STEP]);
    // The two it already matched, so the three read as one.
    expect(
      errorsOf(kernel('let v = vec2(0., 0.); for (let i: i32 = 0; i < 8; v.x++) { }')),
    ).toEqual([NOT_A_STEP]);
    expect(errorsOf(kernel('let j: i32 = 0; for (let i: i32 = 0; i < 8; j += 1) { }'))).toEqual([
      NOT_A_STEP,
    ]);
  });

  it('refuses an unknown name with the sentence `zz++` gets', () => {
    const unknown = { code: 'TS8022', message: 'Cannot assign to unknown name "zz".' };
    for (const update of ['zz += 1', 'zz = zz + 1', 'zz++']) {
      const src = kernel(`for (let i: i32 = 0; i < 16; ${update}) { out[0] = 5.; }`);
      expect(errorsOf(src), update).toEqual([unknown]);
    }
  });

  it('leaves an error for every for loop it does not lower', () => {
    // The invariant, over every refused header shape above: a loop missing from the module is
    // a loop some error names. Any accepted one is in the WGSL.
    for (const head of [
      'let i: i32 = 0; i < 16; v.x += 1.',
      'let i: i32 = 0; i < 16; xs[0] += 1',
      'let i: i32 = 0; i < 16; zz += 1',
      'let i: i32 = 0; i < 16; i = i * 2',
      'let i: i32 = 0; i < 16; i %= 3',
      'let i: i32 = 0; i < 8 && i !== 3; i++',
      'let i: i32 = 0; i < 16; i = i + 1',
    ]) {
      const r = compile(
        kernel(`let v = vec2(0., 0.); let xs: array<i32, 2> = [0, 0];
        for (${head}) { out[0] = 5.; }`),
      );
      const failed = r.diagnostics.some((d) => d.category === 'error');
      expect(failed || /for \(var i: i32/.test(r.wgsl ?? ''), head).toBe(true);
    }
  });

  it('refuses the loop, with a reason, when a refusal inside it said nothing', () => {
    // Every refusal of a for loop reports its own sentence, so the fallback cannot be reached
    // from source. A diagnostics list that keeps only TS8099 stands in for a refusal that
    // reports nothing: the loop is still refused, not dropped.
    const sourceFile = ts.createSourceFile(
      'dropped.ts',
      'function f() {\nfor (let i: i32 = 0; i < 16; zz += 1) { }\n}',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const body = (sourceFile.statements[0] as ts.FunctionDeclaration).body!.statements;
    const silent: TsCompilerDiagnostic[] = [];
    const push = silent.push.bind(silent);
    silent.push = (...ds) => push(...ds.filter((d) => d.code === 'TS8099'));
    expect(lowerStatements(body, sourceFile, new LoweringScope(), silent)).toEqual([]);
    expect(silent.map((d) => ({ code: d.code, message: d.message }))).toEqual([
      {
        code: 'TS8099',
        message:
          'for loop could not be lowered, and no other diagnostic says why. It is refused ' +
          'rather than left out of the module; report it as a compiler bug.',
      },
    ]);
  });
});

describe('i = i + c is the step i += c spelled out (Rule 7.5)', () => {
  it('counts i = i + c, i = c + i and i = i - c', () => {
    // `analyzeCountedFor` already read the assign-of-binop `i++` lowers to; the source spelling
    // was refused only because nothing lowered it (`TS8099 Unsupported for-update.`).
    expect(trips('let i: i32 = 0; i < 8; i = i + 1')).toBe(8);
    expect(trips('let i: i32 = 0; i < 8; i = 2 + i')).toBe(4);
    expect(trips('let i: i32 = 8; i > 0; i = i - 1')).toBe(8);
    expect(trips('let i: u32 = 0; i < 16; i = i + 4')).toBe(4);
    expect(compileTsSource(loop('let i: i32 = 0; i < 8; i = i + 1')).wgsl).toContain('i = (i + 1)');
  });

  it('refuses what i += c refuses, spelling the update as written', () => {
    expect(errorsOf(loop('let i: i32 = 0; i < 16; i = i + 2.5'))).toEqual([
      {
        code: 'TS8003',
        message:
          'for step "i = i + 2.5" does not fit "i", which is i32: 2.5 is not a whole number.',
      },
    ]);
    expect(errorsOf(loop('let i: i32 = 0; i < 16; i = i - 1'))).toEqual([
      { code: 'TS8007', message: 'for (i = 0; i < 16; i -= 1) does not exit.' },
    ]);
    // `c - i` is not a step: it does not move `i` by a constant.
    expect(errorsOf(loop('let i: i32 = 0; i < 16; i = 1 - i'))).toEqual([NOT_A_STEP]);
  });
});

describe('an && exit names the clause that is not the bound (Rules 7.5, 12.1)', () => {
  it('names the extra clause and the break that says it', () => {
    // It was `for exit must compare "i" to a bound`, which it does.
    expect(errorsOf(loop('let i: i32 = 0; i < 8 && i !== 3; i++'))).toEqual([
      {
        code: 'TS8006',
        message:
          'for exit joins the bound "i < 8" with "i !== 3", and a counted loop\'s exit is its ' +
          'bound alone. Make "if (i === 3) { break; }" the body\'s first statement, or write ' +
          'the loop as a while.',
      },
    ]);
    // On either side of the `&&`, and negated whole where one comparison would not be exact:
    // a float `>` is not the opposite of `<=` for a NaN.
    expect(errorsOf(loop('let i: i32 = 0; i !== 3 && i < 8; i++'))[0]?.message).toContain(
      '"if (i === 3) { break; }"',
    );
    expect(errorsOf(loop('let i: i32 = 0; i < 8 && a < 4.; i++'))[0]?.message).toContain(
      '"if (!(a < 4.)) { break; }"',
    );
  });

  it('types an unannotated counter from the clause that compares it', () => {
    // It was `TS8003 cannot compare i32 and u32`, about a counter type the author never wrote.
    const src = kernel(
      'for (let i = 0; i < data.length && data[i] > 0.; i++) { out[0] = 5.; }',
      'declare const data: storage<array<f32>>;',
    );
    expect(errorsOf(src)).toEqual([
      {
        code: 'TS8006',
        message:
          'for exit joins the bound "i < data.length" with "data[i] > 0.", and a counted ' +
          'loop\'s exit is its bound alone. Make "if (!(data[i] > 0.)) { break; }" the ' +
          "body's first statement, or write the loop as a while.",
      },
    ]);
    const fixed = kernel(
      'for (let i = 0; i < data.length; i++) { if (!(data[i] > 0.)) { break; } out[0] = 5.; }',
      'declare const data: storage<array<f32>>;',
    );
    expect(errorsOf(fixed)).toEqual([]);
  });

  it('offers a remedy that compiles and runs the trips the header meant', () => {
    const c = compile(`"use typeshade";
      export function f(): f32 {
        let a = 0.;
        for (let i: i32 = 0; i < 8; i++) {
          if (i === 3) { break; }
          a += 1.;
        }
        return a;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.eval('f', [])).toBe(3); // 0 1 2
  });
});

describe('while on a constant that is true (Rule 7.5)', () => {
  const never = (cond: string): { code: string; message: string } => ({
    code: 'TS8007',
    message:
      `while (${cond}) has no break or return in its body, so it never ends. Leave it with a ` +
      'break, or write the exit into the condition.',
  });

  it('refuses while (ON) as it refuses while (true)', () => {
    // `while (ON)` read as a runtime condition: no diagnostic, and a loop that never ends.
    expect(errorsOf(kernel('while (true) { out[0] = 5.; }'))).toEqual([never('true')]);
    expect(errorsOf(kernel('while (ON) { out[0] = 5.; }', 'const ON = true;'))).toEqual([
      never('ON'),
    ]);
    expect(
      errorsOf(kernel('while (C.ON) { out[0] = 5.; }', 'class C { static readonly ON = true; }')),
    ).toEqual([never('C.ON')]);
    expect(
      errorsOf(kernel('while (N.ON) { out[0] = 5.; }', 'namespace N { export const ON = true; }')),
    ).toEqual([never('N.ON')]);
    // A const copied from one holds the same value, in a body and at the top of the file.
    expect(
      errorsOf(kernel('const go = ON; while (go) { out[0] = 5.; }', 'const ON = true;')),
    ).toEqual([never('go')]);
    expect(
      errorsOf(kernel('while (GO) { out[0] = 5.; }', 'const ON = true; const GO = ON;')),
    ).toEqual([never('GO')]);
  });

  it('accepts one with a way out, and one that is false', () => {
    const top = 'const ON = true; const OFF = false;';
    expect(
      errorsOf(kernel('while (ON) { if (out[0] > 3.) { break; } out[0] += 1.; }', top)),
    ).toEqual([]);
    expect(errorsOf(kernel('while (OFF) { out[0] = 5.; }', top))).toEqual([]);
  });
});

describe("a loop's hidden counter is the compiler's own name (Rule 2.2)", () => {
  it('lets an author name a local _w beside a while, and write two whiles', () => {
    // Both failed in the backend, `TS8015 ... '_w' is declared more than once in fn 'main'`,
    // anchored on the directive: the counter was written as `_w` outright.
    const c = compile(`"use typeshade";
      export function f(): i32 {
        let i: i32 = 0;
        while (i < 4) { i++; }
        let _w: i32 = 10;
        while (i < 8) { i++; }
        while (_w < 13) { _w++; }
        return i + _w;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.eval('f', [])).toBe(21);
  });

  it("reads an author's _i inside a for-of, not the counter", () => {
    // It read the counter, with no diagnostic: 1 + 2 + 3 + 4 plus 0 + 1 + 2 + 3 was 16.
    const c = compile(`"use typeshade";
      export function f(): f32 {
        let xs: array<f32, 4> = [1., 2., 3., 4.];
        let s = 0.;
        let _i: u32 = 7;
        for (const y of xs) { s += y + f32(_i); }
        return s;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.eval('f', [])).toBe(38);
    // And one nothing declares is an unknown name, as the editor already said.
    expect(
      errorsOf(`"use typeshade";
        export function g(): f32 {
          let xs: array<f32, 2> = [1., 2.];
          let s = 0.;
          for (const y of xs) { s += y + f32(_i); }
          return s;
        }
      `),
    ).toEqual([{ code: 'TS8022', message: 'Unknown identifier "_i".' }]);
  });
});
