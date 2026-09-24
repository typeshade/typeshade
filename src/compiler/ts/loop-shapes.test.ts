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
// Verifies: Rule 7.5, Rule 12.6 (docs/language-design.md; traced in reqs/).

import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { compileTsSource, type TsCompilerDiagnostic } from './source-file.js';
import { compile } from './compile.js';
import { LoweringScope } from './context.js';
import { lowerStatements } from './lower/statement.js';
import { checkDocuments } from '../../language-service/check.js';

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

/** Every error the editor shows for a whole module, as code and text (Rule 12.7). */
function editorErrorsOf(src: string): { code?: string; message: string }[] {
  return checkDocuments([{ path: 'loop.shade.ts', uri: '/p/loop.shade.ts', text: src }])
    .diagnostics.filter((d) => d.severity === 'error')
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
    for (const update of ['zz += 1', 'zz++']) {
      const src = kernel(`for (let i: i32 = 0; i < 16; ${update}) { out[0] = 5.; }`);
      expect(errorsOf(src), update).toEqual([unknown]);
    }
    // A read of the name on the right is a use of its own, said as the same statement in a body
    // says it, and as the editor's TS2304 at each use (Rule 2.1, Rule 12.7).
    const src = kernel('for (let i: i32 = 0; i < 16; zz = zz + 1) { out[0] = 5.; }');
    expect(errorsOf(src)).toEqual([
      unknown,
      { code: 'TS8022', message: 'Unknown identifier "zz".' },
    ]);
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

  it('adds nothing to the refusal of a declaration the header reads (Rule 12.4)', () => {
    // A refused declaration binds no name, and a read of it says nothing more (#171). The
    // header then did not lower, nothing new was reported, and the invariant above added a
    // TS8099 claiming that no diagnostic said why, beside the one that does.
    const g = 'function g(x: i32): i32 { return x; }';
    for (const [top, declaration, header] of [
      ['declare const n: i32;', '', 'let i: i32 = 0; i < n; i++'],
      ['declare const n: i32;', '', 'let i: i32 = n; i < 8; i++'],
      ['declare const n: i32;', '', 'let i: i32 = 0; i < 8 && n > 0; i++'],
      ['declare const n: i32;', '', 'let i: i32 = 0; i < 8; i = i + n'],
      [g, 'const s: i32 = g(1.5);', 'let i: i32 = 0; i < 8; i += s'],
      ['declare const zz: i32;', '', 'let i: i32 = 0; i < 8; zz += 1'],
    ]) {
      const alone = kernel(declaration, top);
      const src = kernel(`${declaration} for (${header}) { out[0] = 5.; }`, top);
      expect(errorsOf(alone), header).toHaveLength(1);
      expect(errorsOf(src), header).toEqual(errorsOf(alone));
      // The editor too; `zz += 1` is also TypeScript's TS2588, a write to a `const`.
      if (!header.includes('zz')) expect(editorErrorsOf(src), header).toEqual(errorsOf(alone));
    }
  });

  it('adds nothing to the refusal of a function the header calls (Rule 12.4)', () => {
    // A call of a function whose signature was refused says nothing more, so the header did
    // not lower and the invariant added `TS8099 for loop could not be lowered, and no other
    // diagnostic says why`, false beside the refusal of the signature.
    const optional = {
      code: 'TS8020',
      message:
        'Optional parameter "x" is not supported: a shader value is always present, so there ' +
        'is no "absent" for the body to test. Give it a default instead, "x: T = ...", which a ' +
        'call that omits it fills in.',
    };
    const unknownType = {
      code: 'TS8002',
      message:
        'Unknown type "Foo". Declare it in this file, or import it from another shader module.',
    };
    for (const [top, expected] of [
      ['function lim(x?: i32): i32 { return 1; }', optional],
      ['function lim(x: Foo): i32 { return 1; }', unknownType],
      ['function lim(x: i32): Foo { return 1; }', unknownType],
    ] as const) {
      for (const header of [
        'let i: i32 = 0; i < lim(1); i++',
        'let i: i32 = lim(1); i < 8; i++',
        'let i: i32 = 0; i < 8; i += lim(1)',
        'let i: i32 = 0; i < 8 && lim(1) > 0; i++',
      ]) {
        const src = kernel(`for (${header}) { out[0] = 5.; }`, top);
        expect(errorsOf(src), `${top} ${header}`).toEqual([expected]);
        expect(editorErrorsOf(src), `${top} ${header}`).toEqual([expected]);
      }
    }
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

  it('types i + c as the same assignment in a body is typed (Rule 7.1)', () => {
    // Only the step was lowered, then retyped to the counter's type, so each of these compiled
    // in the header, the conversion the author wrote dropped from the emit, while the same
    // assignment in the body was TS8003.
    const mismatch = (a: string, b: string): { code: string; message: string } => ({
      code: 'TS8003',
      message:
        b === 'u32'
          ? `Type mismatch: cannot + ${a} and ${b} — WGSL has no implicit integer conversion. ` +
            'Cast one side: i32(…) or u32(…), e.g. a + i32(b).'
          : `Type mismatch: cannot + ${a} and ${b} — no implicit int/float conversion. Cast ` +
            'explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
    });
    for (const [step, top, error] of [
      ['i + 2.', '', mismatch('i32', 'f32')],
      ['i + 2.5', '', mismatch('i32', 'f32')],
      ['i + f32(2)', '', mismatch('i32', 'f32')],
      ['f32(2) + i', '', mismatch('f32', 'i32')],
      ['i + u32(1)', '', mismatch('i32', 'u32')],
      ['i + s', 'const s: u32 = 2;', mismatch('i32', 'u32')],
    ] as const) {
      const header = kernel(`for (let i: i32 = 0; i < 8; i = ${step}) { out[0] = 5.; }`, top);
      const body = kernel(`let i: i32 = 0; i = ${step};`, top);
      expect(errorsOf(header), step).toEqual([error]);
      expect(errorsOf(body), step).toEqual([error]);
    }
    // A step of the counter's own type is the step, as it is in `i += c`.
    expect(trips('let i: u32 = 0; i < 16; i = i + u32(4)')).toBe(4);
  });

  it('refuses what i += c refuses', () => {
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
    expect(errorsOf(loop('let i: i32 = 0; i < 8 && !(a > 4.); i++'))[0]?.message).toContain(
      '"if (a > 4.) { break; }"',
    );
  });

  it('keeps the parentheses that make a clause one clause', () => {
    // The clauses were joined bare: "a > 0 || b > 0 && c > 0" is `a > 0 || (b > 0 && c > 0)`,
    // not the test the author wrote, and its `break` ran 8 trips where the header ran none.
    const src = `"use typeshade";
      export function f(a: i32, b: i32, c: i32): i32 {
        let n: i32 = 0;
        for (let i: i32 = 0; i < 8 && (a > 0 || b > 0) && c > 0; i++) { n++; }
        return n;
      }
    `;
    expect(errorsOf(src)).toEqual([
      {
        code: 'TS8006',
        message:
          'for exit joins the bound "i < 8" with "(a > 0 || b > 0) && c > 0", and a counted ' +
          'loop\'s exit is its bound alone. Make "if (!((a > 0 || b > 0) && c > 0)) { break; }" ' +
          "the body's first statement, or write the loop as a while.",
      },
    ]);
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
    // The header as the while it is, beside the for loop the diagnostic writes, on the CPU:
    // the two count the same trips for every input.
    for (const exit of [
      'i < 8 && i !== a + 2',
      'i !== b + 1 && i < 8',
      'i < 8 && i < a + 3',
      'i < 8 && (a > 0 || b > 0) && c > 0',
      'i < 8 && (a > 0 ? b > 0 : c > 0) && b > 0',
      'i < 8 && (a > 0 || b > 0) && (c > 0 || a > 1)',
      'i < 8 && !(a > 0 && b > 0)',
    ]) {
      const refused = `"use typeshade";
        export function f(a: i32, b: i32, c: i32): i32 {
          let n: i32 = 0;
          for (let i: i32 = 0; ${exit}; i++) { n++; }
          return n;
        }
      `;
      const [error] = errorsOf(refused);
      const remedy = /Make "(if \(.*\) \{ break; \})" the body's first statement/.exec(
        error?.message ?? '',
      )?.[1];
      expect(remedy, exit).toBeDefined();
      const bound = /joins the bound "([^"]*)"/.exec(error!.message)![1];
      const c = compile(`"use typeshade";
        export function header(a: i32, b: i32, c: i32): i32 {
          let n: i32 = 0;
          let i: i32 = 0;
          while (${exit}) { n++; i++; }
          return n;
        }
        export function remedy(a: i32, b: i32, c: i32): i32 {
          let n: i32 = 0;
          for (let i: i32 = 0; ${bound}; i++) { ${remedy} n++; }
          return n;
        }
      `);
      expect(
        c.diagnostics.filter((d) => d.category === 'error'),
        exit,
      ).toEqual([]);
      for (const a of [0, 1, 2]) {
        for (const b of [0, 1, 2]) {
          for (const k of [0, 1]) {
            const args = [a, b, k];
            expect(c.eval('remedy', args), `${exit} at ${args.join(',')}`).toBe(
              c.eval('header', args),
            );
          }
        }
      }
    }
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
    // A const copied from one holds the same value.
    expect(
      errorsOf(kernel('const go = ON; while (go) { out[0] = 5.; }', 'const ON = true;')),
    ).toEqual([never('go')]);
  });

  it('refuses a condition that is true through !, && or a comparison', () => {
    // Each read as a runtime condition, as `while (ON)` did.
    const top = 'const ON = true; const OFF = false; const PAUSED = false; const N = 4;';
    for (const cond of ['!OFF', '!false', '!PAUSED', 'ON && ON', 'OFF || ON', 'N > 0']) {
      expect(errorsOf(kernel(`while (${cond}) { out[0] = 5.; }`, top)), cond).toEqual([
        never(cond),
      ]);
    }
  });

  it('accepts one with a way out, and one that is false', () => {
    const top = 'const ON = true; const OFF = false; const N = 4;';
    expect(
      errorsOf(kernel('while (ON) { if (out[0] > 3.) { break; } out[0] += 1.; }', top)),
    ).toEqual([]);
    expect(
      errorsOf(kernel('while (!OFF) { if (out[0] > 3.) { break; } out[0] += 1.; }', top)),
    ).toEqual([]);
    for (const cond of ['OFF', '!ON', 'ON && OFF', 'N < 0', 'ON && out[0] < 3.']) {
      expect(errorsOf(kernel(`while (${cond}) { out[0] += 1.; }`, top)), cond).toEqual([]);
    }
  });

  it('reads a float comparison as the target computes it, in f32', () => {
    // Folded in doubles, each of these held, and the loop was refused as one that never
    // ends. In f32, on both targets, 0.1 + 0.2 is 0.3, and 16777217. and 1e-46 are 16777216.
    // and 0., so the condition fails and the loop runs no trip.
    const top =
      'const A = 0.1; const B = 0.2; const C = 0.3; const X = 16777217.; const E = 1e-46;';
    for (const cond of ['A + B > 0.3', 'A + B !== C', 'X > 16777216.', 'E > 0.', 'A > 0.1']) {
      const src = kernel(`while (${cond}) { out[0] += 1.; }`, top);
      expect(errorsOf(src), cond).toEqual([]);
      expect(editorErrorsOf(src), cond).toEqual([]);
    }
    // A local is its initializer, which the target computes in f32 again: 1 + 2^-30 is 1
    // there, so `L` is 0, where the doubles made it 2^-30.
    const local = kernel(
      'const L = (A + B) - A; while (L > 0.) { out[0] += 1.; }',
      'const A = 1.; const B = 1. / 1073741824.;',
    );
    expect(errorsOf(local)).toEqual([]);
    // A value f32 holds exactly is the same value there, so its comparison still decides.
    const exact = 'const H = 0.5; const Q = -0.25;';
    for (const cond of ['H > 0.', 'H > Q', '-Q === 0.25', '1. > 0.']) {
      expect(errorsOf(kernel(`while (${cond}) { out[0] = 5.; }`, exact)), cond).toEqual([
        never(cond),
      ]);
    }
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

  it('is not the name of a function or a struct the loop uses', () => {
    // The counter took the name `_w` or `_i` while a function or a struct of the file had it,
    // so the call or the type in the body reached the counter: Tint refused each module,
    // `cannot use 'var _w' as call target` or `as type`, and the compiler said nothing.
    const c = compile(`"use typeshade";
      function _w(x: f32): f32 { return x * 2.; }
      function _i(x: f32): f32 { return x + 1.; }
      export function f(): f32 {
        let k = 0.;
        while (k < 4.) { k = _w(k) + 1.; }
        let xs: array<f32, 2> = [1., 2.];
        for (const y of xs) { k += _i(y); }
        return k;
      }
    `);
    expect(c.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(c.wgsl).toContain('for (var _w_1: i32 = 0;');
    expect(c.wgsl).toContain('for (var _i_1: u32 = 0u;');
    expect(c.eval('f', [])).toBe(12); // 0 → 1 → 3 → 7, then 7 + 2 + 3
    const struct = compile(`"use typeshade";
      class _w { a: f32 = 0.; }
      export function f(): f32 {
        let k = 0.;
        while (k < 4.) { const q = new _w(); q.a = k; k = q.a + 1.; }
        return k;
      }
    `);
    expect(struct.diagnostics.filter((d) => d.category === 'error')).toEqual([]);
    expect(struct.wgsl).toContain('for (var _w_1: i32 = 0;');
    expect(struct.eval('f', [])).toBe(4);
  });
});

describe('the editor says what compile() says of a loop (Rules 12.4, 12.7)', () => {
  it('shows each refusal of this change as the one diagnostic compile() gives', () => {
    const top = 'const ON = true; const PAUSED = false;';
    const never = (cond: string): { code: string; message: string } => ({
      code: 'TS8007',
      message:
        `while (${cond}) has no break or return in its body, so it never ends. Leave it with ` +
        'a break, or write the exit into the condition.',
    });
    for (const [body, expected] of [
      ['let v = vec2(0., 0.); for (let i: i32 = 0; i < 16; v.x += 1.) { }', NOT_A_STEP],
      ['let xs: array<i32, 2> = [0, 0]; for (let i: i32 = 0; i < 8; xs[0] += 1) { }', NOT_A_STEP],
      ['for (let i: i32 = 0; i < 8; i <<= 1) { }', NOT_A_STEP],
      [
        'for (let i: i32 = 0; i < 8; zz += 1) { }',
        { code: 'TS8022', message: 'Cannot assign to unknown name "zz".' },
      ],
      [
        'for (let i: i32 = 0; i < 8; i = i + 2.) { }',
        {
          code: 'TS8003',
          message:
            'Type mismatch: cannot + i32 and f32 — no implicit int/float conversion. Cast ' +
            'explicitly: f32(intVal) or i32(floatVal) / u32(floatVal).',
        },
      ],
      [
        'for (let i: i32 = 0; i < 8 && i !== 3; i++) { }',
        {
          code: 'TS8006',
          message:
            'for exit joins the bound "i < 8" with "i !== 3", and a counted loop\'s exit is its ' +
            'bound alone. Make "if (i === 3) { break; }" the body\'s first statement, or write ' +
            'the loop as a while.',
        },
      ],
      ['while (ON) { out[0] = 5.; }', never('ON')],
      ['while (!PAUSED) { out[0] = 5.; }', never('!PAUSED')],
    ] as const) {
      const src = kernel(body, top);
      expect(errorsOf(src), body).toEqual([expected]);
      expect(editorErrorsOf(src), body).toEqual([expected]);
    }
  });
});
