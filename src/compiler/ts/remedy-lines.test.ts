// Verifies: Rule 6.2 (docs/language-design.md; traced in reqs/).
// ═══ A refusal that names a line names a line that compiles ═══
//
// WHAT THIS IS FOR. Most of this surface's refusals end with a line to write: `Write "declare
// const src: storage<array<f32>, "read_write">" to write to it.` A sentence like that is a
// promise, and nothing in the tree was checking it. Four of the six blocking findings against
// the change that moved a storage binding's access mode into its type were one defect wearing
// four hats — the quoted line did not compile:
//
//   - the type was spelled with the COMPILER's key, `vec4<f32>` where an author writes `vec4`
//     and `mat2x3<f32>` where an author writes `mat2x3`, so the line was `TS2315 Type 'vec4' is
//     not generic` in the editor the moment it was pasted;
//   - the `declare const` form was named for a CALL-form binding, where pasting it is a second
//     resource of the same name (`TS8023`);
//   - the author's own access word was echoed back unvalidated, so `{ access: "write" }` was
//     answered with `storage<…, "write">`, which the next compile refuses with `TS8002`;
//   - a `uniform` was told to write a two-type-argument `uniform<…>`, which the same file
//     refuses.
//
// Each of those was a true sentence about what is wrong and a false sentence about what to do.
// So this test does what a reader does: it takes the line out of the refusal, writes it into
// the program the refusal came from, and requires the result to compile clean AND to be clean
// in the editor. The editor half is not decoration — three of the four defects above are
// invisible to `compile()` and show only through `createTypeshadeLanguageService`, because
// `SHADE_DTS` is the standard library for these programs and a bare `tsc` reads them wrong.
//
// HOW A REMEDY IS RECOGNISED. It is the quoted text after "write": a sentence that names a line
// quotes a complete declaration, `write "declare const x: …"` or `Write "const x = …()"`. A
// refusal that quotes a FRAGMENT instead (`Write "${prop}: ..." instead.`, `write "(x: f32):
// f32 => ..."`, `Write "class X extends Base"`) is naming a shape, not a line, and there is
// nothing to paste; the last describe below reads the front end's own sources and requires
// every site to be one or the other, so a remedy added later fails here until a case covers it.
//
// HOW A REMEDY IS APPLIED. The quoted line declares a name, and the program has exactly one
// declaration of that name; the line replaces it, keeping the indentation and the semicolon.
// That is the whole mechanism, and it is deliberately the dumbest thing that works: a remedy a
// reader cannot apply by copying one line over another is a remedy this test should not be able
// to apply either.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileTsSource } from './source-file.js';
import { createTypeshadeLanguageService } from '../../language-service/service.js';

/** The quoted declarations in one message. The closing quote is the one followed by the end of
 *  the sentence, because the line itself contains quotes: `storage<array<f32>, "read_write">`.
 *  Only a COMPLETE declaration is a line to write, which is what the three alternatives of the
 *  opening group say; `Write "${got.name}" as the type.` names a type and no line. */
const remedyLines = (message: string): string[] =>
  [...message.matchAll(/[Ww]rite "((?:declare )?(?:const|let) .+?)"(?=\.| to write to it\.)/g)]
    .map((m) => m[1])
    .filter((line) => !line.includes('...') && !line.includes('…'));

/** The name a quoted line declares, which is the declaration it replaces. */
const declaredNameOf = (line: string): string | undefined =>
  /^(?:declare\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)/.exec(line)?.[1];

/** The program with `line` written over the declaration of the name it declares. */
function applyRemedy(program: string, line: string): string {
  const name = declaredNameOf(line);
  expect(name, `the remedy "${line}" declares no name`).toBeDefined();
  const at = new RegExp(`^([ \\t]*)(?:declare\\s+)?(?:const|let)\\s+${name!}\\b.*$`, 'm');
  expect(at.test(program), `no declaration of "${name!}" in the program to replace`).toBe(true);
  return program.replace(at, (whole, indent: string) =>
    whole.trimEnd().endsWith(';') ? `${indent}${line};` : `${indent}${line}`,
  );
}

const errorsOf = (source: string): string[] =>
  compileTsSource(source)
    .diagnostics.filter((d) => d.category === 'error')
    .map((d) => `${d.code} ${d.message}`);

/** Every diagnostic the editor reports, TypeScript's and TypeShade's alike. A remedy that is
 *  clean to `compile()` and red in the editor is still a line an author cannot write. */
function editorDiagnostics(source: string): string[] {
  const service = createTypeshadeLanguageService();
  service.openDocument('remedy.ts', source);
  return service.getDiagnostics('remedy.ts').map((d) => `${d.source} ${d.code} ${d.message}`);
}

/** The lines a program's refusals name, asserted non-empty — a case whose program stopped being
 *  refused would otherwise pass here by saying nothing — and asserted to be ONE PER
 *  DECLARATION.
 *
 *  The second assertion closes a hole in this test itself. `checkRemedies` reduces
 *  {@link applyRemedy} over the set, so when two refusals named two DIFFERENT lines for one
 *  declaration the second overwrote the first and only the last was ever compiled. Measured:
 *  with the `{ access }` word check reverted, `{ access: "write" }` drew `TS8099` quoting
 *  `storage<…, "write">` and `TS8005` quoting `storage<…, "read_write">`, the good line landed
 *  on top of the bad one, and this file stayed green on a remedy that does not compile. Two
 *  lines for one declaration is also a refusal an author cannot act on — they paste one — so
 *  it is a defect in its own right, and this is where it is caught. */
function remediesOf(program: string): string[] {
  const lines = [
    ...new Set(compileTsSource(program).diagnostics.flatMap((d) => remedyLines(d.message))),
  ];
  expect(lines, 'the program is refused by no sentence that names a line').not.toEqual([]);
  for (const name of new Set(lines.map(declaredNameOf))) {
    expect(
      lines.filter((line) => declaredNameOf(line) === name),
      `two refusals name two different lines for "${String(name)}": an author pastes one of ` +
        'them, and this test would measure only the last',
    ).toHaveLength(1);
  }
  return lines;
}

/** What the editor still says once a remedy has been applied, and why that is not the remedy's
 *  fault. A case without one of these must come back clean from both layers; a case with one
 *  pins the exact residue, so the day the hole closes this test says so rather than staying
 *  quietly green on a sentence that no longer needs the excuse. */
interface EditorHole {
  readonly diagnostics: readonly string[];
  readonly why: string;
}

/** Applies every line a program's refusals name, then requires both layers to be clean — the
 *  compiler always, the editor except for a recorded hole. */
function checkRemedies(program: string, hole?: EditorHole): string[] {
  const lines = remediesOf(program);
  const fixed = lines.reduce(applyRemedy, program);
  expect(errorsOf(fixed), `after writing ${JSON.stringify(lines)}`).toEqual([]);
  expect(
    editorDiagnostics(fixed),
    hole === undefined ? `after writing ${JSON.stringify(lines)}` : hole.why,
  ).toEqual(hole?.diagnostics ?? []);
  return lines;
}

/** The one editor hole this change opens.
 *
 *  A WHOLE-BINDING WRITE. `s = 1.` on a scalar, vector, struct or emulated-double binding is
 *  `var<storage, read_write> s: f32; s = 1.0;` in WGSL and the compiler takes it, but a
 *  binding is `declare const` now (design rule 6.1) and TypeScript will not assign to a
 *  `const` whatever its type is. No ambient declaration can close this: `const` is the
 *  keyword's own meaning, not the value type's. On `main` the writable form was `declare let`,
 *  so this is the price of the keyword, measured and recorded in surface §49 and in Appendix
 *  B's row for design rule 12.7 rather than left for an author to find. A write through an
 *  index or a field — what a compute kernel actually does — is unaffected.
 *
 *  It also inherited one, now closed. A SQUARE MATRIX COLUMN, `m4[0] = vec4(1.)`, was `TS2322
 *  … not assignable to type 'never'`: the square aliases resolved their element with `T extends
 *  f64`, which read `mat4` as a matrix of doubles. They key on `keyof` now, and the square
 *  matrix case below comes back clean from both layers. */
const constWholeWrite = (name: string): EditorHole => ({
  diagnostics: [`typescript 2588 Cannot assign to '${name}' because it is a constant.`],
  why:
    `a whole-binding write is TS2588 in the editor because a binding is declared const; ` +
    `the compiler takes it, and surface §49 has the row`,
});

// ── The type a remedy spells is the type an author writes ──
//
// `typeKey` is the compiler's key and NOT a spelling: `vec4<f32>`, `mat2x3<f32>` and
// `vec2<f64>` are three types no ambient alias declares generically, and `struct:Params` is not
// TypeScript at all. Every shape a binding can hold gets a row, with the line the refusal must
// name; `checkRemedies` then proves that line is one an author can write.

const write = (decl: string, body: string): string =>
  `"use typeshade"
interface Params { scale: f32 }
${decl}
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  ${body}
}
`;

describe('the type a remedy spells is the one an author writes', () => {
  const shapes: readonly {
    what: string;
    decl: string;
    body: string;
    names: string;
    hole?: EditorHole;
  }[] = [
    {
      what: 'a scalar',
      decl: 'declare const s: storage<f32>',
      body: 's = 1.',
      names: 'declare const s: storage<f32, "read_write">',
      hole: constWholeWrite('s'),
    },
    {
      what: 'an f32 vector',
      decl: 'declare const v: storage<vec2>',
      body: 'v.x = 1.',
      names: 'declare const v: storage<vec2, "read_write">',
    },
    {
      what: 'an integer vector',
      decl: 'declare const iv: storage<vec4i>',
      body: 'iv.x = 1',
      names: 'declare const iv: storage<vec4i, "read_write">',
    },
    {
      what: 'a vector inside an array',
      decl: 'declare const a: storage<array<vec4>>',
      body: 'a[gid.x] = vec4(1.)',
      names: 'declare const a: storage<array<vec4>, "read_write">',
    },
    {
      what: 'a matrix',
      decl: 'declare const m: storage<mat2x3>',
      body: 'm[0] = vec3(1.)',
      names: 'declare const m: storage<mat2x3, "read_write">',
    },
    {
      what: 'a square matrix, whose alias is the shorthand',
      decl: 'declare const m4: storage<mat4>',
      body: 'm4[0] = vec4(1.)',
      names: 'declare const m4: storage<mat4x4, "read_write">',
    },
    {
      what: 'an emulated double',
      decl: 'declare const d: storage<f64>',
      body: 'd = f64(1.)',
      names: 'declare const d: storage<f64, "read_write">',
      hole: constWholeWrite('d'),
    },
    {
      what: 'an emulated-double vector',
      decl: 'declare const dv: storage<array<vec2f64>>',
      body: 'dv[gid.x] = vec2f64(f64(1.), f64(2.))',
      names: 'declare const dv: storage<array<vec2f64>, "read_write">',
    },
    {
      what: 'a struct',
      decl: 'declare const p: storage<Params>',
      body: 'p.scale = 1.',
      names: 'declare const p: storage<Params, "read_write">',
    },
    {
      what: 'an array of structs',
      decl: 'declare const ps: storage<array<Params>>',
      body: 'ps[gid.x].scale = 1.',
      names: 'declare const ps: storage<array<Params>, "read_write">',
    },
    {
      what: 'a sized array',
      decl: 'declare const xs: storage<array<f32, 4>>',
      body: 'xs[0] = 1.',
      names: 'declare const xs: storage<array<f32, 4>, "read_write">',
    },
    {
      what: 'an atomic, which only the compiler refuses (Appendix B, rule 6.2)',
      decl: 'declare const bins: storage<array<atomic<u32>>>',
      body: 'atomicAdd(bins[gid.x], 1)',
      names: 'declare const bins: storage<array<atomic<u32>>, "read_write">',
    },
  ];

  for (const shape of shapes) {
    it(`${shape.what}: ${shape.names}`, () => {
      const program = write(shape.decl, shape.body);
      expect(remediesOf(program)).toEqual([shape.names]);
      checkRemedies(program, shape.hole);
    });
  }
});

// ── Every other refusal that names a line ──

describe('every refusal that names a line names one that compiles', () => {
  const cases: readonly {
    what: string;
    site: string;
    program: string;
    /** The line the refusal must name, where WHICH line it is is the point of the case and
     *  pasting it back cannot show that. {@link applyRemedy} REPLACES the declaration, so a
     *  remedy that names the wrong FORM of the same declaration still produces a program that
     *  compiles: measured, with the call-form arm of `writableRemedy` reverted, the call-form
     *  case below was answered `declare const xs: …`, this test pasted that line over `const
     *  xs = storage<…>(…)` and came back clean, and the whole call-form remedy was pinned by
     *  nothing. An author does not replace their declaration with a `declare` line — they add
     *  one, and that is `TS8023 Duplicate resource`, which the case after the loop measures. */
    names?: string;
    hole?: EditorHole;
  }[] = [
    {
      what: 'a write through a read binding',
      site: 'context.ts writableRemedy, reached from lower/statement.ts',
      program: write('declare const src: storage<array<f32>>', 'src[gid.x] = 1.'),
    },
    {
      what: 'a compound write through a read binding',
      site: 'context.ts writableRemedy, reached from lower/statement.ts',
      program: write('declare const src: storage<array<f32>>', 'src[gid.x] += 1.'),
    },
    {
      what: 'an increment of a read binding',
      site: 'context.ts writableRemedy, reached from lower/control.ts',
      program: write('declare const n: storage<u32>', 'n++'),
      hole: constWholeWrite('n'),
    },
    {
      what: 'a mutating method on a class-typed read binding',
      site: 'context.ts writableRemedy, reached from lower/class-methods.ts',
      program: `"use typeshade";
class Acc {
  total: f32 = 0. as f32;
  add(x: f32): void { this.total = this.total + x; }
}
declare const acc: storage<Acc>;
@compute([64, 1, 1])
export function k(): void {
  acc.add(1.);
}
`,
    },
    {
      what: 'an atomic builtin on a read binding',
      site: 'context.ts writableRemedy, reached from lower/atomics.ts',
      program: write('declare const bins: storage<array<atomic<u32>>>', 'atomicAdd(bins[0], 1)'),
    },
    {
      what: 'a CALL-form binding written through, which names the call form back',
      site: 'context.ts writableRemedy with the call form recorded by bindings.ts',
      program: write('const xs = storage<array<f32>>({ binding: 3 })', 'xs[gid.x] = 1.'),
      names: 'const xs = storage<array<f32>, "read_write">({ binding: 3 })',
    },
    {
      what: 'a CALL-form binding with no options, whose empty argument list is kept',
      site: 'context.ts writableRemedy with the call form recorded by bindings.ts',
      program: write('const xs = storage<array<f32>>()', 'xs[gid.x] = 1.'),
      names: 'const xs = storage<array<f32>, "read_write">()',
    },
    {
      what: 'a CALL-form binding whose slot is positional, which the remedy carries',
      site: 'context.ts writableRemedy with the call form recorded by bindings.ts',
      program: write('const xs = storage<array<f32>>(1, 2)', 'xs[gid.x] = 1.'),
      names: 'const xs = storage<array<f32>, "read_write">(1, 2)',
    },
    {
      what: 'declare let on a storage binding',
      site: 'bindings.ts fromType, the keyword arm',
      program: write('declare let counts: storage<array<u32>>', 'counts[gid.x] = 1'),
    },
    {
      what: 'declare let on a storage binding that asked for read',
      site: 'bindings.ts fromType, the keyword arm reading the access word',
      program: write('declare let counts: storage<array<u32>, "read">', 'let n = counts[0]'),
    },
    {
      what: 'declare let on a uniform binding',
      site: 'bindings.ts fromType, the keyword arm',
      program: write('declare let gain: uniform<f32>', 'let n = gain * 2.'),
    },
    {
      what: 'a call-form storage binding declared let',
      site: 'bindings.ts fromCall, the keyword arm',
      program: write('let xs = storage<array<f32>>()', 'xs[gid.x] = 1.'),
    },
    {
      what: 'a call-form uniform binding declared let',
      site: 'bindings.ts fromCall, the keyword arm',
      program: write('let gain = uniform<f32>()', 'let n = gain * 2.'),
    },
    {
      what: 'the retired { access } option',
      site: 'bindings.ts fromCall, the option arm',
      program: write(
        'const ys = storage<array<f32, 4>>({ binding: 3, access: "read_write" })',
        'ys[0] = 1.',
      ),
    },
    {
      what: 'the retired { access } option with a word that is not one of the two',
      site: 'bindings.ts fromCall, the option arm, through the word check',
      program: write(
        'const ys = storage<array<f32, 4>>({ binding: 3, access: "write" })',
        'ys[0] = 1.',
      ),
    },
    {
      what: 'the retired { access } option on a uniform, which has no mode to move',
      site: 'bindings.ts fromCall, the option arm, the uniform sentence',
      program: write(
        'const cam = uniform<f32>({ binding: 3, access: "read_write" })',
        'let n = cam',
      ),
    },
    {
      what: 'an atomic in a uniform binding',
      site: 'bindings.ts fromType, the atomic arm',
      program: write('declare const bins: uniform<array<atomic<u32>>>', 'atomicAdd(bins[0], 1)'),
    },
    {
      what: 'a sampler wrapped in an address space',
      site: 'bindings.ts fromType, the handle arm',
      program: `"use typeshade";
declare const tex: texture_2d<f32>;
declare const smp: uniform<sampler>;
@fragment
export function f(@builtin("position") pos: vec4): vec4 {
  return textureSample(tex, smp, pos.xy);
}
`,
    },
    {
      what: 'a resource type on a plain top-level let, which needs declare',
      site: 'module-vars.ts lowerPlain',
      program: `"use typeshade";
let src: storage<array<f32>>;
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  let n = src[gid.x];
}
`,
      names: 'declare const src: storage<array<f32>, "read_write">',
    },
    {
      // THE BODY WRITES, and that is the whole case. The sibling above reads, so the line it
      // was answered with — the author's text, verbatim, with no mode — happened to close the
      // program, and the defect this pins was invisible: a WRITE body pasted `declare const
      // dst: storage<array<f32>>`, kept a refused program (`TS8005`, with a second remedy
      // naming the writable form), and turned one mistake into two steps. The keyword is a
      // top-level `let`, and `bindings.ts` reads the same keyword the same way.
      what: 'a resource type on a plain top-level let, WRITTEN through',
      site: 'module-vars.ts lowerPlain, the access mode the keyword asked for',
      program: `"use typeshade";
let dst: storage<array<f32>>;
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  dst[gid.x] = 1.;
}
`,
      names: 'declare const dst: storage<array<f32>, "read_write">',
    },
    {
      // A mode the author NAMED is quoted back as written: the compiler chooses one only when
      // the declaration does not, and `"read"` beside a write is a second, separate mistake
      // with its own sentence (`TS8005`) and its own line.
      what: 'a plain top-level let that already named its access mode',
      site: 'module-vars.ts lowerPlain, quoting the author back',
      program: `"use typeshade";
let src: storage<array<f32>, "read">;
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  let n = src[gid.x];
}
`,
      names: 'declare const src: storage<array<f32>, "read">',
    },
    {
      what: 'a uniform on a plain top-level let, which has no mode to name',
      site: 'module-vars.ts lowerPlain',
      program: `"use typeshade";
let gain: uniform<f32>;
@compute([64, 1, 1])
export function k(@builtin("global_invocation_id") gid: vec3u): void {
  let n = gain * 2.;
}
`,
      names: 'declare const gain: uniform<f32>',
    },
  ];

  for (const c of cases) {
    it(`${c.what} (${c.site})`, () => {
      const lines = checkRemedies(c.program, c.hole);
      if (c.names !== undefined) expect(lines).toEqual([c.names]);
    });
  }

  // WHY THE CALL FORM IS NAMED AT ALL, which pasting cannot show. `applyRemedy` REPLACES the
  // declaration, and a reader does not replace a `const xs = storage<…>(…)` with a `declare
  // const xs: …` — a declaration is a line they ADD. Added, it is a second resource of the same
  // name. So the call form is pinned by the line the case above asserts, and by this.
  it('names the call form because the declare form is a second resource beside it', () => {
    const call = 'const xs = storage<array<f32>>({ binding: 3 })';
    const decl = 'declare const xs: storage<array<f32>, "read_write">';
    const program = write(call, 'xs[gid.x] = 1.');
    // Added ABOVE the call and added BELOW it, because a reader adds a declaration wherever
    // the file's declarations are and neither placement closes the program.
    expect(errorsOf(program.replace(call, `${decl}\n${call}`))).toEqual([
      'TS8023 Duplicate resource "xs".',
    ]);
    expect(errorsOf(program.replace(call, `${call}\n${decl}`))).toEqual([
      'TS8023 Duplicate resource "xs".',
      'TS8005 Cannot assign to "xs" — it is a read-only resource. Write ' +
        '"const xs = storage<array<f32>, "read_write">({ binding: 3 })" to write to it.',
    ]);
  });

  // The other half of the promise: a refusal that a writable declaration would NOT close must
  // not name one. `.length` is a read of the array's size on every target, so no access mode
  // makes it a place, and the read-only sentence used to be appended to it anyway — with the
  // named declaration the program is still refused, `TS8018`.
  it('names no line for a write no access mode would permit', () => {
    const program = write('declare const src: storage<array<f32>>', 'src.length = 2');
    const messages = compileTsSource(program)
      .diagnostics.filter((d) => d.category === 'error')
      .map((d) => `${d.code} ${d.message}`);
    expect(messages).toEqual([
      'TS8018 Cannot assign to "src.length" — it is not a field, component or element.',
    ]);
    expect(messages.flatMap(remedyLines)).toEqual([]);
  });

  // And the third: a declaration the compiler cannot COMPLETE. `let s: storage` needs `declare`
  // and a type argument, and the type argument is one only the author knows. Quoting their text
  // back named `declare const s: storage`, which the next compile refuses — so the sentence
  // quotes the SHAPE, with the ellipsis this surface uses for one, and names no line.
  it('names a shape, not a line, for a resource with no type argument', () => {
    const storage = errorsOf(write('let s: storage', 'let n = 1.'));
    expect(storage).toEqual([
      'TS8033 "s" is a storage binding the host provides, and needs declare: write ' +
        '"declare const s: storage<...>".',
    ]);
    const uniform = errorsOf(write('let u: uniform', 'let n = 1.'));
    expect(uniform).toEqual([
      'TS8033 "u" is a uniform binding the host provides, and needs declare: write ' +
        '"declare const u: uniform<...>".',
    ]);
    expect([...storage, ...uniform].flatMap(remedyLines)).toEqual([]);
  });
});

// ── A line the compiler could not make good on is not named at all ──
//
// Round two found four remedies that do not compile when pasted, and three of them named a
// type the author had ALREADY been refused: `storage<mat2x3, "read_write">` for a
// `mat2x3<f64>` whose `<f64>` the sentence silently dropped, `storage<array, "read_write">`
// for an `array<vec2h>` whose type argument it dropped entirely, and `storage<mat3x3<f64>,
// "read_write">` for a matrix that cannot be indexed on any access mode. Two rules answer
// them, and each row below fails without the one it names.
//
// A TYPE THE COMPILER COULD NOT READ NAMES NO LINE. `bindings.ts` measures whether mapping the
// declared type drew a refusal and records the binding as RECOVERED; `writableRemedy` then says
// nothing. The first sentence already names the mistake the author has to fix, and a second one
// built from a type the compiler could not read is noise at best and a wrong line at worst.
//
// A TARGET THAT IS NO PLACE ON EITHER MODE ANSWERS THE SAME ON BOTH. The read-only check runs
// AFTER the target is known to be a place, for element targets as it already did for member
// ones (`src.length = 2`). So `md[0] = …` on an f64 matrix reads `Cannot index mat3x3<f64>`
// whatever the mode is — which is what `main` said for the writable form, and what this tree
// now says for both.

describe('a refusal names no line when it could not make the line good', () => {
  const noPlace: readonly {
    what: string;
    read: string;
    writable: string;
    body: string;
    says: readonly string[];
  }[] = [
    {
      what: 'an f64 matrix, which no access mode makes indexable',
      read: 'declare const md: storage<mat3<f64>>',
      writable: 'declare const md: storage<mat3<f64>, "read_write">',
      body: 'md[0] = vec3f64(f64(1.), f64(2.), f64(3.))',
      says: ['TS8003 Cannot index mat3x3<f64>.'],
    },
    {
      what: 'a matrix with no emulated-double form, recovered',
      read: 'declare const mnd: storage<mat2x3<f64>>',
      writable: 'declare const mnd: storage<mat2x3<f64>, "read_write">',
      body: 'mnd[0] = vec3f64(f64(1.), f64(2.), f64(3.))',
      says: [
        'TS8027 mat2x3<f64> has no emulated-double form',
        'TS8003 Cannot index struct:mat2x3.',
      ],
    },
    {
      what: 'an array of an unknown element type, recovered',
      read: 'declare const vh: storage<array<vec2h>>',
      writable: 'declare const vh: storage<array<vec2h>, "read_write">',
      body: 'vh[0] = vec2h(1., 2.)',
      says: ['TS8002 Unknown type "vec2h"', 'TS8003 Cannot index struct:array.'],
    },
    {
      what: 'a lane of an emulated-double vector, which is a read on either mode',
      read: 'declare const dv: storage<array<vec2f64>>',
      writable: 'declare const dv: storage<array<vec2f64>, "read_write">',
      body: 'dv[0].x = f64(1.)',
      says: ['TS8018 Cannot assign to the lane ".x" of a vec2<f64>'],
    },
    {
      what: 'a multi-component swizzle, which WGSL writes one component at a time',
      read: 'declare const v: storage<vec4>',
      writable: 'declare const v: storage<vec4, "read_write">',
      body: 'v.xy = vec2(1., 2.)',
      says: ['TS8018 Cannot assign to the swizzle ".xy"'],
    },
  ];

  for (const row of noPlace) {
    it(`${row.what}: the same sentences on either mode, and no line`, () => {
      const messages = errorsOf(write(row.read, row.body));
      expect(messages).toHaveLength(row.says.length);
      row.says.forEach((open, i) => expect(messages[i]).toContain(open));
      expect(messages.flatMap(remedyLines), 'a line the pasted program would refuse').toEqual([]);
      // The mode is not what is wrong with this program, so the mode does not change what it
      // is told. This is the assertion that fails if the read-only check moves back ahead of
      // the "is this a place" one: the read form then answers `TS8005` and the writable form
      // answers the sentence above.
      expect(errorsOf(write(row.writable, row.body))).toEqual(messages);
    });
  }

  const recovered: readonly { what: string; decl: string; body: string; first: string }[] = [
    {
      what: 'a matrix with no emulated-double form',
      decl: 'declare const mnd: storage<mat2x3<f64>>',
      body: 'mnd = mat2x3(vec3(1.), vec3(2.))',
      first: 'TS8027 mat2x3<f64> has no emulated-double form',
    },
    {
      what: 'a scalar this surface does not have',
      decl: 'declare const q: storage<f16>',
      body: 'q = 1.',
      first: 'TS8002 Unknown type "f16"',
    },
    {
      what: 'a scalar this surface does not have, incremented',
      decl: 'declare const nn: storage<u64>',
      body: 'nn++',
      first: 'TS8002 Unknown type "u64"',
    },
  ];

  for (const row of recovered) {
    it(`${row.what}: the read-only sentence, and no line built from it`, () => {
      const name = /const (\w+)/.exec(row.decl)![1]!;
      const messages = errorsOf(write(row.decl, row.body));
      expect(messages).toHaveLength(2);
      expect(messages[0]).toContain(row.first);
      // Ends at the em-dash clause: no second sentence, because there is no line to name.
      expect(messages[1]).toBe(`TS8005 Cannot assign to "${name}" — it is a read-only resource.`);
      expect(messages.flatMap(remedyLines)).toEqual([]);
    });
  }
});

// ── Every site that names a line is covered, or says why it cannot be ──

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every non-test source of the front end, read rather than listed so a new file joins by
 *  existing — the same reason `ambient.test.ts` reads the examples directory. */
function frontEndSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return frontEndSources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

/** The sentences a file builds that quote something after "write". Comments are stripped first
 *  (a comment that quotes a remedy is not one), and the `` ` + ` `` joins of a message split
 *  across lines are closed up, because a template literal broken at the quote is still one
 *  sentence to the reader. */
function remedySitesIn(path: string): string[] {
  const source = readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/`\s*\+\s*`/g, '')
    .replace(/\s*\n\s*/g, ' ');
  return [...source.matchAll(/[Ww]rite \\?"[^`]{0,80}/g)].map((m) => m[0]);
}

describe('every refusal that names a line is pinned above', () => {
  // One row per file that builds such a sentence, with the count, so that a remedy ADDED to a
  // covered file trips this test too. `lines` is how many of them name a whole declaration —
  // the ones the cases above paste back — and the rest are named with the reason they cannot
  // be pasted. A remedy cannot be checked mechanically when the sentence quotes a SHAPE rather
  // than a line: there is no declaration in the program that it replaces.
  const expected: readonly { file: string; sites: number; lines: number; note: string }[] = [
    {
      file: 'bindings.ts',
      sites: 6,
      lines: 6,
      note: 'the keyword arm of each form, the two { access } sentences, the atomic arm and the handle arm',
    },
    {
      file: 'context.ts',
      sites: 2,
      lines: 1,
      note: 'writableRemedy names a line; the second quotes a struct NAME to use as a type, not a declaration',
    },
    {
      file: 'module-vars.ts',
      sites: 1,
      lines: 1,
      note: 'the resource that needs declare; the one sentence names a line, except for a resource with no type argument, where it names a `storage<...>` shape and the case above pins that',
    },
    {
      file: 'generic-structs.ts',
      sites: 2,
      lines: 0,
      note: 'quotes a type argument to add at the use sites, and a `new X<f32>(…)` shape: neither is a declaration line',
    },
    {
      file: 'mixins.ts',
      sites: 1,
      lines: 0,
      note: 'quotes the `class X extends Base` clause to write, not a whole declaration',
    },
    {
      file: 'structs.ts',
      sites: 4,
      lines: 0,
      note: 'quotes a member shape: a field annotation (`name: T`, `name: T = ...`), a `this.name` access, or a static method (`static name(...) { ... }`)',
    },
    {
      file: 'lower/expression-prop.ts',
      sites: 1,
      lines: 0,
      note: 'quotes `name: ...`, the property shape a shorthand should be written as',
    },
    {
      file: 'lower/statement.ts',
      sites: 4,
      lines: 0,
      note: 'the destructuring refusal quotes two EXAMPLE lines (`const x = v.x`) that name no declaration in the program; the do-while refusal quotes a `while (c) { … }` shape; the other two say a body cannot `write "this"`, which is prose and names nothing to write',
    },
    {
      file: 'lower/class-access.ts',
      sites: 3,
      lines: 0,
      note: 'quotes the member access to write instead (`Base.x`, `this.x`), an expression and not a declaration',
    },
    {
      file: 'lower/function.ts',
      sites: 1,
      lines: 0,
      note: 'quotes a setter signature, `set x(v: T)`, a member shape with its type left open, for a setter whose value has no type and no getter that returns one',
    },
    {
      file: 'lower/function-types.ts',
      sites: 1,
      lines: 0,
      note: 'quotes a parameter annotation, `p: f32`, not a declaration',
    },
    {
      file: 'integer-literal-deprecation.ts',
      sites: 1,
      lines: 0,
      note: "quotes the initializer to write, `name = 1.`, which completes the author's own declaration rather than replacing it",
    },
  ];

  it('finds the sites this test was written against, and no others', () => {
    const found = frontEndSources(HERE)
      .map((path) => ({ file: path.slice(HERE.length + 1), sites: remedySitesIn(path) }))
      .filter((row) => row.sites.length > 0)
      .sort((a, b) => a.file.localeCompare(b.file));
    expect(
      found.map((row) => `${row.file} x${row.sites.length}`),
      'a refusal names a line to write and nothing above pastes it back: add a case, or a row ' +
        'with the reason the line cannot be applied mechanically',
    ).toEqual(
      [...expected]
        .sort((a, b) => a.file.localeCompare(b.file))
        .map((row) => `${row.file} x${row.sites}`),
    );
  });

  // A sentence can OFFER a line without quoting one, and then this test cannot see it. There is
  // exactly one, pinned here so that rewriting it as a quoted remedy asks for a case above:
  // `refuseAtomicDeclaration` answers `let c: atomic<u32>` with "declare it inside a storage
  // binding (declare const counters: storage<array<atomic<u32>>, "read_write">) or a workgroup
  // variable (let tile: workgroup<array<atomic<u32>, 64>>)". The line is in PARENTHESES, and it
  // offers a NEW binding rather than a replacement for the declaration the program has, so
  // there is nothing to paste over even by hand: the author moves the variable, which is a
  // rewrite and not a substitution.
  it('sees no quoted line in the refusal that offers one in parentheses', () => {
    const offer = compileTsSource(`"use typeshade";
export function f(): u32 {
  let c: atomic<u32> = 0;
  return 1;
}
`).diagnostics.map((d) => d.message);
    expect(offer).toEqual([
      'atomic<u32> lives in storage or workgroup memory only: declare it inside a storage ' +
        'binding (declare const counters: storage<array<atomic<u32>>, "read_write">) or a ' +
        'workgroup variable (let tile: workgroup<array<atomic<u32>, 64>>), not as a local.',
    ]);
    expect(offer.flatMap(remedyLines)).toEqual([]);
    expect(remedySitesIn(join(HERE, 'lower', 'atomics.ts'))).toEqual([]);
  });

  it('pastes back every sentence that quotes a whole declaration', () => {
    // The two halves have to add up: the cases above cover the `lines` column, and the rest are
    // accounted for by name. A row that claimed a line was unpasteable while the extractor
    // would have taken it is the drift this arm catches.
    expect(expected.reduce((n, row) => n + row.lines, 0)).toBe(8);
  });
});
