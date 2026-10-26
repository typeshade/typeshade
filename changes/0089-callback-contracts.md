---
id: '0089'
title: A shader library declares the functions and the bindings that the importing program supplies, and the program supplies them at its own declarations
status: accepted
rules:
  - '3.9'
  - '6.1'
  - '8.20'
  - '8.26'
surface:
  - 1
  - 14
  - 64
  - 68
exports: []
exports-removed: []
codes: []
examples: []
downstream:
  - repo: typeshade.github.io
    what: The functions and resources guides, en and ko, teach a library that declares a function or a binding for the program to supply, and the program that supplies it. Playground multi-file examples gain one such pair. Record 0089 in compiler-changes.md when the pin moves.
  - repo: vscode-typeshade
    what: The skill's language reference stops saying that `declare function` is refused, and teaches the supplied function and the refined binding. Not read in this draft. Record 0089 in compiler-changes.md when the pin moves.
---

<!-- doc-refs: skip-file — a draft proposal names a rule, a test file and a journey that a later implementation adds, and files of TypePlot, which this tree does not have -->

**Document control**

| Field                         | Record                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity and status           | Proposal 0089. Front-matter status is `accepted`: the owner approved it on 2026-10-26, UTC (Approval and plan record), and the merge of PR #766 records the decision. No implementation exists. The front matter is the authority for the identity and the lifecycle state.                                                                                                                                                                                                                                                          |
| Date and attribution          | Authored 2026-10-26, UTC. The date is the authorship date. It is not an approval date. A Claude Code agent drafted the file. Git authorship is not an approval signature.                                                                                                                                                                                                                                                                                                                                                            |
| Request source                | The owner, Seungup, asked in a Claude Code session on 2026-10-26 which compiler improvements the work on TypePlot revealed. The owner then said "진행하세요" (proceed) to the drafting of proposals. This records the request. It is not an approval of this proposal. No GitHub issue is recorded for this draft.                                                                                                                                                                                                                   |
| Applicability / Effectivity   | The linker (`src/compiler/ts/link.ts`), the lowering of a body-less function (`src/compiler/ts/lower/function.ts`), the binding reader (`src/compiler/ts/bindings.ts`), the host face (`src/compiler/ts/host-face.ts`) and the language service's merge of their diagnostics. Rules 3.9, 6.1 and 8.20 (amended) and 8.26 (new) of `docs/language-design.md`. Sections 1, 14, 64 and 68 of `docs/use-typeshade-surface.md`. All targets: WGSL, GLSL ES 3.00 and the CPU paths read the linked module. No release version is assigned. |
| Review baseline               | `origin/main` at `e03ff7ea74bb8d6c7398d2310b2a53cc7e582227` ("Merge pull request #760 from typeshade/fix/current-main-windows-validation"), read on 2026-10-26. TypePlot was read at `2f9e8bff7c4bbaf6ddd4f6fb0becd6e0f45ac5b4` (its `package.json` pins the compiler at `91c2fe31de045ebf0e5f2c333ac98b95cc460280`). typeshade.github.io was read at `f1eb89c001779151bbaeec0a2e8fc843c440caa4`. vscode-typeshade was not read.                                                                                                     |
| Review and revision authority | [#766](https://github.com/typeshade/typeshade/pull/766) is the proposal-only pull request. Git records the revisions of this file. The owner's approval of 2026-10-26 and the merge of PR #766 with `status: accepted` record the decision (Approval and plan record). This file does not name the hash of the commit that contains it.                                                                                                                                                                                              |

## What changes

### Before

A shader library can export functions, types and bindings (Rule 3.9). It cannot leave a function
for the importing program to write, and it cannot let the program add fields to a binding it
declares:

- A `declare function` is refused in every file, with `TS8020` ("Function "sample" needs a body
  (no ambient declarations).") in `compile()` and in the editor (measured, below).
- Two bindings of one name in one program are refused with `TS8023`, naming both files (Rule 3.9,
  change 0022). So the program cannot declare a binding that extends the library's.
- An entry point cannot take a function (Rule 8.18, `TS8020`). So a library's entry cannot take
  the program's callback.

A library that needs a callback and an extensible uniform therefore leaves its entries to the
program. The program writes each entry, calls the library with the callback and the uniform, and
the library threads the uniform through a parameter `u` of each function. TypePlot does this with
generated text (Why).

### Proposed

Two forms of one mechanism. In each, a file the program imports makes an exported `declare`
declaration, and the root file supplies it with an exported declaration of the same name. The
root file is the file a compile starts from (Rule 3.9).

**A supplied function (Rule 8.26, new).** An imported file declares a function without a body:

```ts
// scalar.shade.ts, a library file
"use typeshade";
export declare function sample(x: f32): f32;

@fragment
export function draw(@location(0) uv: vec2): vec4 {
  return vec4(sample(uv.x));
}
```

The root file supplies it:

```ts
// curve.shade.ts, the root file
"use typeshade";
export * from './scalar.shade.ts';

export function sample(x: f32): f32 {
  return sin(x);
}
```

- The library calls `sample`, hands it to a parameter of function type (Rule 8.18), and reads its
  type, as it does for a function it declares with a body. Every call reaches the root's function.
- The root's function must be assignable to the declared signature as TypeScript assigns one
  function type to another: the same parameter types, `@inout` and `@out` qualifiers (Rule 8.25)
  and result type, with trailing parameters allowed to be left off. A function that does not fit
  is refused at the root's declaration, and the sentence names both signatures.
- `export * from` keeps the library's entries in the module (Rule 3.9). The root's own `export`
  of `sample` takes precedence over the star export, as ECMAScript resolves a local export before
  a star export. TypeScript reports no error for that program (measured, below).
- A declared function that the root does not supply is unsupplied. An entry the root re-exports
  that reaches an unsupplied function is refused at the re-export, naming the function and the
  file that declares it. An entry of the root file itself that reaches an unsupplied function of
  the root file is left out of the module, and the host view declares it `never` with the reason
  (D4). This lets a library compile and type-check as its own root.
- A declared function may not be generic, may not be an overload set, and may not carry a
  decorator. Each stays refused with the existing code.

**A refined binding (Rule 6.1 and Rule 3.9, amended).** An imported file exports a binding whose
type is a struct:

```ts
// plot.shade.ts, a library file
"use typeshade";
export class PlotUniforms {
  resolution: vec2;
  plotSpan: vec2;
}
export declare const u: uniform<PlotUniforms>;

export function plotSize(): vec2 {
  return u.resolution / u.plotSpan;
}
```

The root file refines it with a binding of the same name, kind and access mode, whose type is the
library's struct or a class or interface that extends it (Rule 6.9):

```ts
// curve.shade.ts, the root file
"use typeshade";
import { PlotUniforms } from './plot.shade.ts';
export * from './scalar.shade.ts';

class Uniforms extends PlotUniforms {
  amplitude: f32;
}
export declare const u: uniform<Uniforms>;

export function sample(x: f32): f32 {
  return u.amplitude * sin(x);
}
```

- The program has one binding `u`, of type `Uniforms`, at the root's slot. `reflect()`, the
  manifest and an entry call's `bindings` (Rule 8.24) report the root's type.
- Each file reads `u` with the type its own declaration names, as TypeScript types it. The library
  reads `u.plotSpan`. It cannot name `u.amplitude`. The root reads both.
- A field read in the library is a read of the one binding. A base's fields are the first fields
  of the derived struct (Rule 6.9), so their offsets do not move, and no conversion runs.
- Where the library uses `u` as a whole value of the base type (an argument, a spread, a return),
  the read-only base view of Rule 8.9 (change 0038) converts it, as today.
- A method call on `u` in the library runs the body of the root's type, as TypeScript runs the
  body of the object's class. A uniform is read-only, so no receiver write is lost.
- The first delivery admits `uniform<T>` and `storage<T, A>` with a struct `T` (D3). Textures,
  samplers and overrides of one name in two files stay `TS8023`. So does a binding that is not
  exported, so two private bindings never merge by chance.

### What stays

- A program that compiles today compiles to the same module. Both forms take programs that are
  refused today (`TS8020` and `TS8023`), so no program changes meaning (Rule 13.10 does not apply).
- Rule 8.18 does not change. An entry still takes no function.
- The emitted names, the slot order of the bindings the root does not refine, the GLSL stages and
  the CPU oracle do not change.
- No author-facing name is added. `declare`, `function`, `export *` and `extends` are ECMAScript
  as TypeScript spells it (Rule 2.1, §9 of `docs/language-design.md`).

### Excluded

- A function type on a module-level `const` (`export const sample: ScalarCurve = (x) => ...`),
  alternative (d) below. It is a separate change.
- A new spelling for an entry template, alternative (b).
- A compiler API that generates wrapper text, alternative (c).
- A supply from a file other than the root file (D2).
- Navigation in the editor from a declared function to the root's function (D7).

## Why

### The evidence from TypePlot

TypePlot is a plotting library on TypeShade. It is not in `DOWNSTREAM_REPOS` of
`scripts/changes.ts`, so it owes nothing under this proposal. It is the evidence. Facts, read at
TypePlot `2f9e8bf`:

- `src/plot-source.ts` builds the program's root file as template text. The text is the string
  `wrapper` (lines 197 to 216) and the strings it interpolates (from line 121). It imports the
  user's callback (`import { sample as callback } from "./curve.shade.ts"`). It declares
  `class Uniforms extends PlotUniforms { <parameters>: f32; }` and
  `declare const u: uniform<Uniforms>;`. It defines `sample` or `trajectory` over the callback.
- The template text holds 24 `@fragment export function` templates for the three plot kinds
  (scalar, parametric, surface), 12 to 18 for one kind, and one `@vertex` entry. Each passes the
  callback and `u` to the shared library (`plot2D(sample, uv, u, jumps)`,
  `prepareCurveSeeds(trajectory, position, u)`).
- The same file places the shared library in a virtual directory and rewrites its imports by
  string replacement (`.replace('"./font.shade.ts"', '"./__typeplot-font.shade.ts"')`).
- 79 functions in `shaders/plot.shade.ts` take `u: PlotUniforms` as a parameter
  (`grep -cE '^(export )?function .*u: PlotUniforms'` gives 79).
- 11 call sites in `shaders/plot.shade.ts` pass a derived value instead of `u`: `axesUniforms(u)`
  nine times and `flatView(u)` twice. These functions build a new `PlotUniforms` value.
- The library already declares bindings of its own (`declare const query: uniform<PickUniforms>`,
  `declare const sceneMaterial: uniform<SceneMaterial>`, five `texture_2d<u32>`). Only the binding
  that the program extends cannot be the library's.
- The reserved parameter names are copied by hand twice: `reserved` in `src/plot-source.ts` and
  `RESERVED` in `src/procedural-plot.ts`. Each mirrors the fields of `PlotUniforms`.
- The callback types (`type ScalarCurve = (x: f32) => f32` and two more) are declared in
  `shaders/plot.shade.ts` and are not exported.

### What the language does today (measured)

Measured on 2026-10-26, UTC, at `e03ff7e`, in this worktree, with Bun 1.4.4 and TypeScript 5.6.3.
Each program ran through `compile()` (the compiler's half) and
`createTypeshadeLanguageService().getDiagnostics` (the editor's half), on the same files. The
programs were scratch scripts, not tests of the repository:

1. **A wrong callback through a wrapper.** The root imports a user's
   `sample(x: f32, a: vec2): f32` and calls it as `callback(t, u.a)` with an `f32`. Both halves
   report `TS8003` "Argument 2 of "curve_sample" type mismatch." on the wrapper's line. The
   sentence names no type, and it names the emitted name `curve_sample`, not the author's
   `sample`. TypePlot's wrapper is a file that does not exist on disk, so the user sees an error
   at a line they never wrote.
2. **The upcast at each entry.** A root with `class Uniforms extends Base { a: f32 }` and
   `declare const u: uniform<Uniforms>` passes `u` to a library function that takes `u: Base`.
   The WGSL declares `fn Uniforms_as_Base(value: Uniforms) -> Base` and each entry calls
   `plot_sample(uv, Uniforms_as_Base(u))`. The GLSL ES 3.00 fragment stage of one entry lists the
   fields three times (`struct Base`, `struct Uniforms_value` and the `uniform Uniforms` block) and
   copies twice: `Uniforms_as_Base(Uniforms_value(u.span, u.center, u.scale, u.a))`. TypePlot's
   `PlotUniforms` has 33 fields (11 in `PlotViewport`, 22 of its own).
3. **A function-typed parameter.** `plot(sample: Curve, ...)` called with a module function is
   compiled once for it (`plot_sample`), as Rule 8.18 states. This works today.
4. **`export declare function sample(x: f32): f32;` in a library.** Both halves report `TS8020`
   "Function "sample" needs a body (no ambient declarations)." on the library's line. The
   compiler's sentence names the emitted `lib_sample`.
5. **A binding of one name in the root and the library.** `compile()` reports `TS8023` "Binding
   "u" is declared in both "/p/curve.shade.ts" and "/p/lib.shade.ts". …" on the library's line.
   The editor showed no diagnostic on either file in this measurement.
6. **An exported binding imported by the root.** `export declare const u: uniform<Base>` in a
   library, imported and read by the root, compiles clean on both halves to one binding.
7. **`export *` and a local export of one name.** The root re-exports a library that exports
   `sample` and declares its own `export function sample`. Both halves accept it, and the root's
   entry calls the root's `sample`.
8. **A function type on a module-level `const`.** `export const sample: Curve = (x) => x * 2.;`
   is `TS8020` on both halves ("its types are written on its own parameters …"). With a wrong
   parameter type, the editor's TypeScript half adds `TS2322` at the user's line, naming both
   types.
9. **A function-typed parameter on an entry.** Both halves report `TS8020` ("An entry's parameters
   come from the pipeline, and a function is nothing the pipeline can supply …").
10. **`declare module "./lib.shade.ts" { interface Base { a: f32; } }`.** Both halves report
    `TS8014` "A namespace is declared with a plain name, "namespace Palette { ... }"."
11. **`drawT.bind(undefined, sample)` at the top level.** The compiler reports `TS8022` "Unknown
    identifier "drawT"." The editor adds `TS2339`: `bind` does not exist on the function's type.
12. **A derived class that declares a base field again with the same type.** The compiler accepts
    it and emits one field. The editor reports TypeScript's `TS2612` ("Property 'scale' will
    overwrite the base property …"). With another type, both halves report `TS8010`.

Inference from items 1, 2 and 5: TypePlot's wrapper exists because the root cannot supply a
function to a library and cannot extend a library's binding. Its errors land in the wrapper
because the only check of the callback is the wrapper's call.

### The choice

The design spells both forms with `declare`. Rule 6.1 already reads `declare` as TypeScript's word
for "a value that exists elsewhere": the host supplies a resource. Under this proposal the
program's root also supplies a declaration. The scope stays TypeScript's (Rule 3.9): the library
names its own declaration, and only the value comes from elsewhere. The supply check runs in
`linkProgram`, which both halves run (Rule 3.9, Enforced by), so the editor reports a mismatch at
the root's declaration, where the author wrote it. Change 0022 put each diagnostic on the file
that holds its location (its decision 7). The root file is the file the author has open.

What TypePlot could remove, as an inference that this draft did not measure:

- The 24 entry templates and the callback adapters become `export *` of one library module per
  plot kind.
- `u` becomes the library's exported binding, refined by the root. A library function that only
  forwards `u` can read the binding instead of a parameter. The 11 calls with a derived value keep
  a value parameter by design. How many of the 79 functions only forward `u` is not measured.
- The conversion at each entry goes, because no entry passes `u` as a base value.
- A parameter named like a library field is refused at the user's line, by the compiler
  (`TS8010`, another type) or by the editor (`TS2612`, the same type; item 12). TypePlot could
  then derive its reserved names from `reflect()` of the library instead of two copies.
- The callback's extra parameters (`callback(t, u.a)`) become fields that the user's root reads
  from `u`. That is a change to TypePlot's API, which TypePlot decides.
- A value that the template text inlines (`jumps`) could become an override constant (Rule 6.4,
  change 0028) that the host sets by name.

### Alternatives

- **(a) Abstract module members resolved at link time.** This proposal is a form of (a). A wider
  form, a module with type parameters or a generic module, has no TypeScript spelling, so the
  editor could not check it (Rule 12.7). This proposal resolves by name against the root's exports.
- **(b) An entry template instantiated by a new call, `instantiate(plotEntries, { sample })`.**
  `instantiate` is not WGSL and not ECMAScript. Rule 9.6 keeps the extension table shrink-only,
  and Rule 13.6 admits a new name only from WGSL or ECMAScript. So (b) needs a change to §9 and
  to Rule 9.6. An ECMAScript spelling, `Function.prototype.bind`, is refused on both halves today
  (item 11). It also needs an entry that takes a function (item 9), and it moves one line per
  entry into the user's file. Not chosen.
- **(c) Keep the wrappers, and add a compiler API that generates them with a source map.** This
  moves a wrapper's error to the user's line. The wrapper text, the string rewrite of import paths,
  the threaded `u` and the conversion at each entry stay. The API would be a new export (the
  exports criterion of `changes/README.md`). Not chosen as the design. A smaller fix is separate:
  `TS8003` for a function argument could name both types and the author's name (Rule 12.1). That
  is a candidate issue, outside this record.
- **(d) TypeScript-native checking of an exported function against an exported function type.**
  `export const sample: ScalarCurve = (x) => ...` gives the editor's own `TS2322` at the user's
  line (item 8). It needs a module-level `const` that holds an arrow function, refused today by
  Rule 8.18 ("A function type anywhere else (… a variable) … must be refused"). It checks only an
  author who opts in, and it removes no wrapper. It is a separate change to Rules 8.17 and 8.18,
  so it is not in this record. Under this proposal an author can still write the type alias for
  readers.
- **(e) Module augmentation for the uniform.** A `declare module` block that holds
  `interface PlotUniforms { amplitude: f32 }` is TypeScript's own way to add fields to another
  module's type, and the editor merges it. It needs `declare module` blocks in the compiler (refused today,
  item 10), class-interface merging, and an order for the merged fields. It changes the library's
  struct for every file of the program, and a user's callback must import `u` from the library.
  Not chosen. It is the alternative to D3.
- **(f) A compiler optimization that passes a read-only binding by reference.** It could remove
  the copy when a library function takes `u` by value. It removes no parameter and no wrapper, and
  it is an internal change that needs no proposal. It is independent of this record.

### One record or two

The request names two needs: a callback contract and an extensible uniform. This draft carries
both in one record, because one rule serves both: the root supplies an imported file's exported
`declare`. They touch one linker step and one diagnostic family. A library that needs only one of
them uses only one. The owner confirmed one record (D1, decided on 2026-10-26).

## What it touches

- **Rule 3.9 (amended).** The program-level rule: an exported `declare` of an imported file is
  supplied by an exported declaration of the same name in the root file. Two bindings of one name
  stay `TS8023` unless the second refines the first under Rule 6.1.
- **Rule 6.1 (amended).** A resource of an imported file that is exported may be refined by the
  root's exported resource of the same name, kind and access mode, whose type is the same struct
  or extends it. The binding takes the root's type and slot.
- **Rule 8.20 (amended).** A `declare function` is not callable from a host. An export that
  reaches an unsupplied function is declared `never` in the host view, with the reason.
- **Rule 8.26 (new).** A declared function: what may be declared, how the root supplies it, the
  signature check, the unsupplied case. The number 8.26 is fixed at acceptance: on 2026-10-26 it
  was free on `origin/main` at `fbf67d3427600535d0ea6a3cd3d1d1ef69baebfc`, and neither 0087
  (PR #764) nor 0088 (PR #765) claims it.
- **Surface §1.** One paragraph: a library's exported binding that the root refines.
- **Surface §14.** "An overload signature is skipped …" says that `declare function` keeps its
  error. That sentence changes. Proposal 0087 (PR #764, accepted at the same time) also edits
  §14 and Rule 8.18. The two touch different subsections of §14. The implementing pull requests
  of 0087 and 0089 coordinate their §14 edits, and the second to merge rebases on the first.
- **Surface §64.** The host view of a declared function and of an export that reaches an
  unsupplied one.
- **Surface §68.** A new subsection: a library that declares what the program supplies, with the
  two forms, the checks and the refusals.
- **Exports.** None. `compile()`, `reflect()` and the host view keep their shapes.
- **Codes.** None proposed (D5). The refusals reuse `TS8020` (an unsupplied function an entry
  reaches), `TS8003` (a supplier that does not fit) and `TS8023` (a binding that does not refine).
  Each new sentence is part of the surface (Rule 12.5).
- **Examples.** None (D8). A multi-file example would need `examples/lib/`, and the link tests and
  a journey hold the behaviour.
- **Code.** `src/compiler/ts/link.ts` (the supply step, the signature check, the `TS8023`
  exception), `src/compiler/ts/lower/function.ts` (a body-less `declare function`),
  `src/compiler/ts/bindings.ts` (the refined type), `src/compiler/ts/host-face.ts` (the `never`
  reason), and the comment in `src/core/debug/watch.ts` that says `declare function` is rejected.
- **Tests.** `src/compiler/ts/link.test.ts` and `src/compiler/ts/host-face.test.ts` gain cases. A
  new `src/compiler/ts/supplied-declarations.test.ts` holds both halves on each form and each
  refusal. A journey under `journeys/` holds a packed library and a root on WebGPU, WebGL2 and the
  CPU oracle.
- **Documents.** `AUTHORING.md` (imports), `CHANGELOG.md`, `reqs/` (RULE-0309, RULE-0601,
  RULE-0820, a new RULE-0826, SURF-001, SURF-014, SURF-064, SURF-068) through `bun run reqs:sync`.

### Draft impact estimate

- **Technical work (known).** A link step that resolves each exported `declare` against the root's
  exports, before lowering. Lowering then treats a supplied function as the root's function and a
  refined binding as one binding of the root's type. No IR node, backend operation or runtime
  change is expected.
- **Technical work (assumption).** The lowering of an imported file's body against the refined
  binding's type needs the binding's final type before that file's functions are lowered. Rule
  8.19 already lowers a body on first need. Whether the binding reader can take the root's type
  for a declaration in another file is not read.
- **Compatibility (known).** Additive. Both forms take programs that are refused today.
- **Rule 12.7 (assumption).** The TypeScript half reports nothing for either form (items 6 and 7).
  The supply check is in `linkProgram`, which the editor runs, so both halves report the same
  sentence at the root. Not measured, because the step does not exist.
- **Dependencies.** Changes 0022 and 0024 (implemented), 0038 (implemented), 0016 and 0030
  (implemented; the host face and the typed bindings read the root's type). No package is added.
- **Tools.** None added.
- **Downstream effort.** Unestimated. Guide text in two repositories, two locales on the site.
- **Effort and date.** Unestimated. No milestone is set.

### Decisions

The owner decided D1 to D8 on 2026-10-26, UTC, by taking the draft's recommendation for each
(Approval and plan record). Each item records the decision and the alternative that was not
chosen.

- **D1. One record or two.** Decided: one record (One record or two, above). Alternative: two
  records, the supplied function here and the refined binding in a later proposal.
- **D2. Who supplies.** Decided: the root file only, by an exported declaration of the same
  name. One file decides, so the result does not depend on import order. Alternatives: any file of
  the program (two suppliers would need a rule), or an explicit map such as
  `export { mySample as sample }` (still by name, so no new spelling).
- **D3. Which bindings a root may refine.** Decided: `uniform<T>` and `storage<T, A>` with a
  struct `T`, the same kind and the same access mode, both declarations exported. Alternative:
  module augmentation, (e). Alternative: uniforms only.
- **D4. A library compiled as its own root.** Decided: an entry of the root file that reaches
  an unsupplied function of the root file is left out of the module and is `never` in the host
  view, with no diagnostic. So `tshc check` and the editor accept the library alone. Alternative:
  refuse the entry with `TS8020`. Cost: a library shows an error in its own editor.
- **D5. Codes.** Decided: reuse `TS8020`, `TS8003` and `TS8023` with new sentences.
  Alternative: one new code for every supply refusal, claimed under Rule 13.5 before the
  implementation branch.
- **D6. Exports on both sides.** Decided: both declarations must be exported. A private
  binding of one name stays `TS8023`, so two files never merge by chance.
- **D7. Editor navigation.** Decided: out of the first delivery. Go to definition on a library
  call of `sample` reaches the `declare` line, as TypeScript resolves it. Alternative: the language
  service adds the root's function as a second definition.
- **D8. An example.** Decided: none. Alternative: a pair under `examples/lib/` in the compile
  gate, which changes the set of examples and the site.

### Required validation

Functional, each a test or a gate in this repository:

- Both halves (`CLAUDE.md`, "A test reads both halves") on each accepted program: `compile()` has
  no error, and `getDiagnostics` on the root and on the library is empty. `getHover` on `u` in the
  library shows the library's type, and in the root the root's type.
- Each refusal on both halves, with code and text (Rule 12.5), located in the root: a supplier of
  another signature, an entry that reaches an unsupplied function, a refining binding of another
  kind, access mode or unrelated type, and a private binding of one name.
- Emit: a refined uniform has one declaration in WGSL and one block in GLSL ES 3.00, and no
  conversion function where the library reads only fields. `reflect()` and the manifest report the
  root's type (Rule 6.8).
- One value on every path: WGSL on Tint, GLSL ES 3.00 on WebGL2 and the CPU oracle compute the
  same result for a library entry that calls a supplied function and reads a refined binding
  (`bun run gate:compile`, `bun run gate:journeys`).
- A library compiled alone: its entries that reach an unsupplied function are absent from the
  module and `never` in the host view (D4), and its other entries compile.
- Every existing test passes unchanged, the link tests and the emit goldens included.
- `bun run build`, `bun run lint`, `bun run format:check`, `bun run test`.

Document: `bun run docs:impact`, `bun run docs:refs`, `bun run reqs:sync` and
`python scripts/doorstop-check.py -C` after the rule and surface edits. `bun scripts/changes.ts`
passes on each implementing pull request.

### Draft checks

These checks validate this document, not a behaviour. A Claude Code agent ran them on
2026-10-26, UTC, on the review baseline `e03ff7e` with this file added, with Bun 1.4.4, Node
22.22.0 and TypeScript 5.6.3:

- `bunx vitest run src/changes.test.ts`: 17 tests passed.
- `bun run docs:refs`: 0 dead references in 1306 files. This file skips the check as a whole
  (its first comment), because it names a rule and files that do not exist yet.
- `bunx prettier --check changes/0089-*.md`: passed.
- `bun scripts/doc-impact.ts`: "No prose names what this change removed or touched."

No functional check applies to a proposal-only change.

### Approval and plan record

The owner, Seungup, approved the proposal in the Claude Code conversation on 2026-10-26, UTC, at
about 10:55 UTC as the coordinating agent reported it. The owner replied "진행승인" (approve
proceeding). Asked for the scope, the owner chose "전부 (초안 권장안대로)": all of it, as drafted,
with each decision taking the draft's recommendation. The head of
[PR #766](https://github.com/typeshade/typeshade/pull/766) at the approval was
`1d8afa4915d658aedc0844dabdadf213c16d3927`, committed at 10:47 UTC, the last commit before the
approval. This acceptance commit changes no scope.

The approved scope is the two forms of What changes, the declarations of the front matter and the
required validation above, with these decisions:

- D1: one record carries the supplied function and the refined binding.
- D2: only the root file supplies, by an exported declaration of the same name.
- D3: a root may refine `uniform<T>` and `storage<T, A>` with a struct `T`, of the same kind and
  access mode.
- D4: an entry of a library compiled as its own root that reaches an unsupplied function is left
  out of the module and is `never` in the host view, with no diagnostic.
- D5: no new code. The refusals reuse `TS8020`, `TS8003` and `TS8023` with new sentences.
- D6: both declarations must be exported.
- D7: editor navigation to the root's function is out of the first delivery.
- D8: no example is added.

No decision remains open. The merge of PR #766 with `status: accepted` records the decision. The
proposal must be merged as accepted before implementation begins (`changes/README.md`).

Responsibilities: an agent of this repository implements the proposal in commits that say
`Change: 0089`. typeshade.github.io and vscode-typeshade do their work when their pins move. No
milestone date is assigned. No duration or cost estimate was agreed. Acceptance of this plan is
not evidence that the implementation works: every check in Required validation remains required.

### Configuration and validation record

This record does not apply yet. Delivery will require the implementing commits with
`Change: 0089`, the delivered configuration, the functional and document validation listed above
with their observed results, and the disposition of each deviation. The checks in Required
validation are requirements, not results.

## What it owes downstream

Each item is expected work. No downstream change exists.

- **typeshade.github.io.** Read at `f1eb89c`. The functions guide
  (`src/components/pages/LanguageFunctionsPage.astro`) and the resources guide
  (`src/components/pages/LanguageResourcesPage.astro`), en and ko, gain the library pattern. The
  Playground's multi-file examples (`src/lib/playground-examples.ts`) gain one library and one
  root. A search of `src` for `declare function` and "needs a body" found no page that states the
  refusal. That limited search does not prove that no other page is affected. Record 0089 in
  `compiler-changes.md` when the pin moves.
- **vscode-typeshade.** Not read in this draft. The skill's language reference is expected to
  describe imports and functions, and it must teach both forms. Record 0089 in
  `compiler-changes.md` when the pin moves.
- **radiance, typenn, typecv.** Not declared. The change is additive and removes no name, so
  `scripts/downstream-impact.ts` finds nothing for them. A repository that adopts the pattern does
  so in its own change.

## Open items

- **`TS8003` for a function argument.** It names no type and names the emitted name (item 1). A
  candidate issue under Rule 12.1, outside this record.
- **A Rule 12.7 gap.** A derived class that declares a base field again with the same type
  compiles and is `TS2612` in the editor (item 12), measured on 2026-10-26 at `e03ff7e`. Rule 12.7
  says a program the compiler accepts draws no editor error. A candidate issue, outside this
  record.
- **`TS8014` for `declare module`.** Its sentence names a fixed example (`namespace Palette`) that
  the author did not write (item 10). A candidate issue, outside this record.
- **`TS8023` in the editor.** In item 5 the editor showed no diagnostic on either file. Whether
  the editor should show the library-located diagnostic when the root is open is not decided here.
- **Alternative (d).** A function type on a module-level `const`. A candidate proposal of its own.
