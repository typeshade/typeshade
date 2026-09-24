# TypeShade language design rules

Status: normative.
This document prescribes what the `"use typeshade"` surface may contain and how it may change.
`docs/use-typeshade-surface.md` describes what the surface contains today; where the two disagree, this document is the one to fix, and the surface document is the one to bring back into line.
The WGSL specification it is written against is gpuweb/gpuweb at commit `358eebc8e7bf2d6efa41a4b8b3fbc3a715288204`, the commit `src/core/spec-conformance/fixtures/wgsl-names.json` was baked from.
Every link of the form `https://gpuweb.github.io/gpuweb/wgsl/#anchor` names a section of that specification.

## 1. Introduction

### 1.1. What this document is

A rule in this document is a constraint on one of two agents.
_An author_ is the person writing a `"use typeshade"` program.
_The compiler_ is TypeShade: the front end, the passes, the three backends, the CPU oracle, and the language service, together.
A rule is numbered `Rule N.M` so that an issue, a pull request, or a code comment can cite it.
Each rule states one requirement, gives its rationale in one sentence, names what it derives from, and names where the tree enforces it.
"Not enforced" is a debt, and Appendix B lists every such rule with the issue that will pay it, or with "no issue" until one is filed; a row that names no issue is itself a debt, paid by filing one.

### 1.2. Conformance language

The key words "must", "must not", "should", and "may" are to be interpreted as described in RFC 2119.
A "must" on an author is a static requirement: the compiler refuses the program with a diagnostic when it is violated.
A "must" on the compiler is a requirement on the emitted text, on the reported reflection, or on the diagnostics.
A rule marked _open_ is not decided; §14 lists it, and until it is decided the current behaviour of the tree stands.

### 1.3. How to cite

Cite a rule by number, for example "Rule 2.2".
Cite a section of the surface document by its number, for example "surface §28".
Cite the WGSL specification by anchor, for example [Built-in Functions](https://gpuweb.github.io/gpuweb/wgsl/#builtin-functions).
Cite a measurement by the compiler it was made on: Tint for WGSL, a WebGL2 driver (ANGLE through the compile gate) for GLSL ES 3.00, or a named device.

### 1.4. Relation to WGSL

**Rule 1.1.** A `"use typeshade"` program must mean what the WGSL program it emits means, unless a rule in this document says otherwise.

- Rationale: TypeShade is a front end; the language it compiles to is the language whose specification decides the meaning.
- Derives from: [WGSL Module](https://gpuweb.github.io/gpuweb/wgsl/#wgsl-module) and [Introduction](https://gpuweb.github.io/gpuweb/wgsl/#intro).
- Enforced by: the compile gate (`scripts/compile-gate.ts`), which hands every registered example to Tint.

### 1.5. Relation to GLSL ES 3.00

**Rule 1.2.** GLSL ES 3.00 is a target of the compiler; it must not be the definition of a construct.

- Rationale: a construct GLSL ES 3.00 lacks is still a construct of the language; the GLSL writer either lowers it or fails closed (§10).
- Derives from: the roadmap's second rule, "make what does not compile, compile", and `AGENTS.md`.
- Enforced by: `src/core/passes/required-caps.ts` (`assertCaps`), which fails a GLSL emit closed on a capability the writer has no row for.

### 1.6. Relation to the CPU oracle

**Rule 1.3.** The CPU oracle is the reference evaluation of the IR: where WGSL fixes a result, the oracle must produce that result, and where WGSL leaves room (§11), the oracle's answer is one of the permitted ones.

- Rationale: a test that compares a GPU result with the oracle is only meaningful if the oracle is the specification's answer and not a third opinion.
- Derives from: [Floating Point Evaluation](https://gpuweb.github.io/gpuweb/wgsl/#floating-point-evaluation) and `AGENTS.md` ("one IR, three backends").
- Enforced by: `src/core/oracle-backend-parity.test.ts` and `src/core/passes/determinism.test.ts`.

### 1.7. Relation to AGENTS.md and the roadmap

`AGENTS.md` and `src/AGENTS.md` describe the architecture the rules assume: one IR, three backends over one tree walk, the pass pipeline, and the gates.
`docs/roadmap.md` decides the order of work and records the deferrals; a construct the roadmap places after 1.0 is not a construct of the surface today, whatever this document says a construct of its kind must do.
This document decides what a construct may look like once it is picked up.

## 2. Sources of the surface

### 2.1. Definition

An _author-facing name_ is a name a `"use typeshade"` file can write and the compiler will accept: a type, a type generator, a function, a decorator, a constant, or a member of a standard object such as `Math`.
The set of author-facing names is exactly the set of names the ambient library (`SHADE_DTS` in `src/language-service/ambient.ts`, written to `dist/shade.d.ts`) declares.

A _compiler-internal name_ is a name for something the compiler chose and neither WGSL nor ECMAScript defines.
Such a name is one of:

- a representation of a value the compiler emulates (the two `f32` halves that carry an `f64`);
- an operation over such a representation (the split of an `f64` into its halves, the rebuild from them);
- an intermediate of a lowering pass;
- a contract between two passes, or between a pass and a backend;
- a name a backend generates (`df64_add`, `DF64Vec2`, `_cse0`, a mangled or aliased name).

The criterion is what the name denotes, not whether an author's text spells it: declaring such a name in the ambient library, giving it a new id, or giving it a row of §9.3 does not make it an extension, and a name that denotes the same thing under another spelling (`splitF64` lowering to `f64Parts`) is the same internal name.
A spelling is not only an id: a second signature of an allowed name (`f64(hi: f32, lo: f32)` beside `f64(x)`), an overload, or a member of an allowed type that denotes the operation is the same internal name under the allowed id, and the declared signatures of a name are part of what the name denotes.
The question to ask of a name is what it denotes.
A name is internal when it denotes a representation the compiler chose, an operation over such a representation, an intermediate of a pass, a contract between passes, or a generated name.
A row of §9.3 names an operation or a type over WGSL values whose meaning that section writes down with a reason.
The enumeration in the definition above is the test, and a meaning written down elsewhere (in Rule 4.4, in a row's reason) does not take a name out of it.
Part of the set has a mechanical criterion: membership of `PRE_EMIT_INTRINSICS` (`src/core/intrinsics.ts`), the intrinsic ids a pass rewrites away before any backend runs; such an id is internal unless it is also the name of a type of Appendix A.
`f64` is the one id that is both, because `f64(x)` is the value constructor of the `f64` type as WGSL spells `f32(x)`; `f64FromParts` and `f64Parts` are internal, and so is any other spelling of the same two operations.
The rest of the set (a generated backend name, a lowering intermediate, a spelling over an internal representation under an id outside `PRE_EMIT_INTRINSICS`) has no test that can read what a name denotes, and is decided by review under this definition (Rule 9.8).

### 2.2. The three sources

**Rule 2.1.** Every author-facing name must come from exactly one of three sources:

- (a) WGSL, as the specification spells it: a [built-in function](https://gpuweb.github.io/gpuweb/wgsl/#builtin-functions), a [predeclared type or type-generator](https://gpuweb.github.io/gpuweb/wgsl/#predeclared-types) including the predeclared `vecNf`/`vecNi`/`vecNu` aliases, an [attribute](https://gpuweb.github.io/gpuweb/wgsl/#attributes) reached as a decorator, a [built-in value](https://gpuweb.github.io/gpuweb/wgsl/#builtin-inputs-outputs) passed as a string, or an [extension](https://gpuweb.github.io/gpuweb/wgsl/#extensions) name;
- (b) ECMAScript, as TypeScript spells it: a member of `Math`, a method of `console`, a method `Array.prototype` has, written on an array (surface §63), a literal, an operator, the declaration forms `class`, `interface`, `enum`, and `namespace`, the standard-library declarations the ambient file restates for a `lib: []` program, and the shapes surface §14 and §28 admit;
- (c) the TypeShade extensions enumerated in §9.3 of this document, one row per name with its reason.
- Rationale: a name with a source has a meaning an author can look up; a name with no source has only the compiler's word for what it does.
- Derives from: PR #166's body, section "A design rule this lane settled" ("No TypeShade-internal helper becomes an author-facing spelling"), and [Declaration and Scope](https://gpuweb.github.io/gpuweb/wgsl/#declaration-and-scope).
- Enforced by: `src/core/spec-conformance/surface-names.test.ts`, which classifies every declared name against `fixtures/wgsl-names.json`, the running engine's `Math` and `console`, and `TYPESHADE_EXTENSIONS`, and holds each method the library declares on an array to the running engine's `Array.prototype`.

**Rule 2.2.** A compiler-internal name (§2.1) must not be authorable.
It must not be declared in the ambient library, as a name, as a signature or an overload of an allowed name, or as a member of an allowed type.
It must not be given a row of §9.3, under its own id or under any other spelling of the same thing.

- Rationale: an internal helper is a contract between two passes, and an author who can write it can also write it wrong, with no specification to say what wrong means.
- Derives from: the same section of PR #166, written on the `f64FromParts` case (§2.4).
- Enforced by:
  - `surface-names.test.ts` (`no pre-emit intrinsic id is declared or listed`), which asserts that every id of `PRE_EMIT_INTRINSICS` other than the type name `f64` is neither declared in `SHADE_DTS` nor a row of `TYPESHADE_EXTENSIONS`;
  - the same test (`reports an internal helper by name when one reaches the surface`), for the sentence a stray declaration gets;
  - the same test (`the front end resolves no pre-emit id as a builtin`), for the call route, since `resolveMathFn` in `src/compiler/ts/math-alias.ts` resolves an alias only when `isKnownIntrinsic` accepts its id, exempting `f32`, `atan2`, and `mod`, none of which is pre-emit, so `f64Parts(x)` in a shader is `TS8004 Unknown function`;
  - the same test's first case, which catches a generated backend name that is declared, as a stray;
  - the same test (`the f64 family declares only the constructor forms WGSL gives the type it stands in for`), for the overload route, which pins every declared signature of `f64` to one argument and every signature of `vec2f64`, `vec3f64`, and `vec4f64` to WGSL's vector constructor forms (a splat, N components, or a narrower `f64` vector plus components);
  - that same case, which reports `f64(hi: f32, lo: f32)` appended to the library;
  - the same test (`the compiler refuses a second argument to f64`), for the call route of the same overload, `TS8019 f64() expects 1 argument.`;
  - review under §2.1's definition (Rule 9.8), since a name that denotes an internal representation under an id outside `PRE_EMIT_INTRINSICS` passes every case of the test once it has a row.

**Rule 2.3.** A value sometimes has to cross between a representation the compiler chose and one the target has: an `f64` and the two `f32` halves that carry it across an interface of `f32`.
The compiler must either perform the bridge silently or refuse the program in one sentence naming an ordinary remedy.
A spelling of the bridge, under any name, must not be a third option.

- Rationale: the two honest answers to "the target cannot take this as written" are to make it work or to say what to write instead; a third spelling the author has to learn is neither.
- Derives from: the same section of PR #166; the roadmap's first rule, "ordinary TypeScript first".
- Enforced by:
  - `TS8038 F64_ENTRY_IO` (`src/compiler/ts/lower/function.ts`, PR #166) for an `f64` on an entry's `@location` parameter, on an entry I/O struct field, or on an entry's return, one sentence that names `f32(x)` and the uniform or storage binding as the two remedies (surface §39), pinned by `src/compiler/ts/f64-types.test.ts`;
  - a `TS8003` that names no remedy, for an `f64` passed, returned, or assigned where an `f32` is declared (Appendix B);
  - the surface-names test, which catches a spelling of the bridge that is a pre-emit id, a second signature of `f64`, or a non-constructor signature of a `vecNf64`, and the front end, which refuses a call of one;
  - review, for a spelling under a new id, which none of the cases above catches.

**Rule 2.4.** An ECMAScript name that has a WGSL meaning must lower to that meaning, and an ECMAScript name that has no WGSL meaning is still an ECMAScript name, whatever the backend expands it to.

- Rationale: `Math.cbrt` is what a TypeScript author writes; that WGSL has no `cbrt` is the compiler's problem and does not make `cbrt` a TypeShade invention.
- Derives from: [Numeric Built-in Functions](https://gpuweb.github.io/gpuweb/wgsl/#numeric-builtin-functions) for the names that exist there; `src/compiler/ts/math-alias.ts` for the mapping.
- Enforced by: `surface-names.test.ts` (`the Math and console stand-ins declare only members the real ones have`).

### 2.3. Corollary for built-in values

A built-in value such as `position` or `global_invocation_id` is an argument of `@builtin("...")`, not a name of the library.
The compiler checks the string against WGSL's list ([Built-in Inputs and Outputs](https://gpuweb.github.io/gpuweb/wgsl/#builtin-inputs-outputs)) and reports `TS8024` for a name outside it and `TS8025` for a name on the wrong stage.

### 2.4. The worked example: `f64FromParts`

The f64 family needed to carry an `f64` across a boundary that holds only `f32`.
The lowering pass has two internal intrinsic ids for that, `f64FromParts` (two `f32` halves to one `f64`) and `f64Parts` (the reverse), both in `PRE_EMIT_INTRINSICS` and both rewritten before any backend sees them.
The first pass of PR #166 declared both in the ambient library as functions an author could call, because the issue text asked for "an author spelling".
Nothing failed: no test asked where a name came from, so a name from nowhere was indistinguishable from a name from WGSL.
The violation is of Rule 2.2, and the resolution is Rule 2.3: the two declarations were removed from PR #166, and the pass keeps doing the work.
PR #166 is on this tree, and it gives the entry I/O case the sentence Rule 2.3 asks for.
An `f64` on an entry's `@location` parameter, on an entry I/O struct field, or on an entry's return is refused at the front end with `TS8038` (`Parameter "p" carries f64: … Narrow it with f32(x), or compute the double in the stage that needs it`, which goes on to name the uniform or storage binding).
A scalar `f64` vertex attribute, which is a buffer read and not a varying, is admitted (surface §39).
The backend's own refusal (`SD0044`, whose hint now names `f32(x)` first and `toF32(x)` only for the `fn()` EDSL, where that name is an export) sits behind that check and is no longer what an author sees.
An `f64` passed, returned, or assigned where an `f32` is declared is still refused with `TS8003` (`Argument 1 of "g" type mismatch.`; `Function "f" return type mismatch: declared f32, got f64.`), and neither sentence names the remedy, `f32(x)`, which the compiler lowers to the narrowing (`df64_narrow`); that sentence is a debt of Appendix B.
The surface-names test pins the case by running its classifier over a copy of the library with `declare function f64FromParts(hi: f32, lo: f32): f64` appended, and expects exactly one stray; it also asserts that no id of `PRE_EMIT_INTRINSICS` other than `f64` is declared or has a row, which closes the route a row would have opened for `f64Parts`.
The same bridge as a second signature of the one allowed id (`declare function f64(hi: f32, lo: f32): f64` beside `f64(x)`) is not a stray, since the classifier reads names, and not a leak, since `f64` has its row.
It is caught by the test's signature case, which pins every declared signature of `f64` to one argument and every signature of a `vecNf64` to WGSL's constructor forms, and by the compiler, which refuses the call (`TS8019 f64() expects 1 argument.`).
A pull request that changed both the lowering and the library would turn both cases red.
The same bridge under a new id (`declare function splitF64(x: f64): vec2f`, lowered to `f64Parts`, with a row) passes every case of the test, because the test reads ids and not meanings.
It is refused by the definition of §2.1, which review applies to every new authorable name (Rule 9.8).
The name denotes the halves of an emulated value, which is a representation the compiler chose, and a row for it is the violation with a different spelling.

## 3. Textual structure and names

### 3.1. Definition

A _declared name_ is an identifier a `"use typeshade"` file binds: a function, a struct and its fields, a constant, an override, a module variable, a binding, a parameter, or a local.
A _generated name_ is an identifier the compiler writes into an emitted module that no author typed, such as a flattened member name or a name the mangler or the type aliaser produces.
A _claimed number_ is a surface `§` number or a `TS80xx` diagnostic code taken before the text that uses it is written.
This section states how a name may be spelled on each target, and how a number is claimed.

### 3.2. The directive

**Rule 3.1.** A shader file must begin with the directive `"use typeshade"` as its first statement.

- Rationale: the directive is what tells the compiler and the language service that the file is a shader and not host code; the bundler and a host program's `tsconfig` read the file's name first, which Rule 3.8 fixes as `*.shade.ts`, and the directive is what they check it against.
- Derives from: surface §1 and `src/compiler/ts/source-file.ts`.
- Enforced by: `TS8001 MISSING_DIRECTIVE`, which yields an otherwise empty result, for a file with no directive at all; `TS8069 MISPLACED_DIRECTIVE` on a directive after another top-level statement, another string directive included, with the rest of the file still checked (#200, proposal 0012), pinned by `src/compiler/ts/directive-placement.test.ts`.

Roadmap 0.6 item B1 (#97) will let a file hold both a shader and its host half; until it lands, the whole file is the shader.

**Rule 3.8.** A shader module that host code imports is named `*.shade.ts`, and a host import of a `.ts` file that begins with the directive under any other name must be refused with the rename.

- Rationale: the bundler and the host program's `tsconfig` decide what an import is before they read a statement of the file: the Vite plugin picks the modules it compiles by the name, and the host view `name.shade.typeshade.ts` that `tsc` reads in place of the source (surface §64) is named after it, as is the `exclude` that keeps the source out of the host program. A shader under another name would reach the host as its source, which a host program cannot type-check and a bundle would run as JavaScript.
  The name decides how a host imports the file; the directive still decides what a shader is, for the compiler and the language service (Rule 3.1).
- Derives from: change `0009` in `changes/` ("The shader module is picked by its name"); `docs/roadmap.md` item 16.
- Enforced by: the Vite plugin in `src/vite.ts`, which refuses a project `.ts` that begins with the directive and is not named `*.shade.ts` (`… begins with "use typeshade", so it is a shader module, and a host imports a shader module by the name *.shade.ts (Rule 3.8). Rename it to terrain.shade.ts and import it by that name.`), and `typeshade sync`, which writes a view for a `*.shade.ts` only; pinned by `src/vite.test.ts`.

### 3.3. Identifiers

**Rule 3.2.** An identifier is a TypeScript identifier that is also a WGSL identifier: a name that contains `$`, a name that is exactly `_`, and a name that starts with `__` must be refused on the declaration; the compiler must emit a declared name as written, and a member of a class or namespace as the flattened name `Owner_member`.
A private member `#m` is emitted without its `#` (Rule 8.12), and the two halves of an accessor `m` as `Owner_get_m` and `Owner_set_m` (Rule 8.11).

- Rationale: an author reads a diagnostic and an emitted module against the name they typed, so a rename the author cannot predict breaks that, and a name WGSL's identifier profile excludes is one Tint refuses in text the author never sees.
- Derives from: [Identifiers](https://gpuweb.github.io/gpuweb/wgsl/#identifiers) (`<Start> := XID_Start + U+005F`, which admits no `$`; "an identifier must not be `_`"; "an identifier must not start with `__`", each a shader-creation error); surface §26 and §29 for the flattening.
- Enforced by:
  - the emit goldens (`examples/emit-goldens.test.ts`) for the spelling;
  - `TS8068 RESERVED_NAME` (`reportReservedNames` in `src/compiler/ts/reserved-names.ts`, PR #165) for the name that is exactly `_` and for a `__` prefix, pinned by `src/compiler/ts/reserved-names.test.ts`;
  - its two sentences, `"_" is WGSL's phony assignment target, not an identifier, so a local of that name cannot be emitted for the WebGPU target. Rename it.` and `"__a" begins with two underscores, which WGSL reserves, …`;
  - nothing for a `$` in a name, which is not enforced: `let $a: f32` is emitted as written with zero diagnostics (Appendix B).

### 3.4. Reserved words

**Rule 3.3.** A declared name that is a WGSL [keyword](https://gpuweb.github.io/gpuweb/wgsl/#keywords) or [reserved word](https://gpuweb.github.io/gpuweb/wgsl/#reserved-words) must be refused as an error on the declaration.

- Rationale: WGSL is the program; Tint refuses the module, and a refusal at the front end names the line the author wrote instead of generated text.
- Derives from: "A WGSL module must not contain a reserved word" (the section above); the 146 words in `wgsl/wgsl.reserved.plain`, carried in the fixture and transcribed with the 26 keywords as `WGSL_RESERVED` in `src/core/reserved-words.ts`; PR #165's decision 1 (severity follows the target's role).
- Enforced by:
  - `TS8068 RESERVED_NAME` as an error (`"as" is reserved in WGSL, so a local of that name cannot be emitted for the WebGPU target. Rename it.`), from `reportReservedNames` in `src/compiler/ts/reserved-names.ts` over the declared-symbol table, on the name the emit carries (`Cls_member` for a flattened member);
  - the list `WGSL_RESERVED` in `src/core/reserved-words.ts`;
  - `src/compiler/ts/reserved-names.test.ts`, which pins it (surface §62);
  - nothing on the multi-file path `compileTsSources`, which is not checked, as the file's header records.

**Rule 3.4.** A module-surface name (a struct or its fields, a constant, an override, a module variable, a binding) that is a GLSL ES 3.00 reserved word must be reported as a warning, and the GLSL emit must fail closed on it; a local, a parameter, or a function name that collides must be renamed consistently by the GLSL writer.

- Rationale: GLSL is the second target of a module whose WGSL exists, so its shortfall is a warning (§12), and a warning must never be the only thing between a reserved word and a driver.
- Derives from: PR #165's decisions 1 and 4, measured on ANGLE at shader version 300 (`half`, `filter`, `input`, `sample`, `gl_` prefixes, and `__` are refused; `buffer` and `packed` are accepted).
- Enforced by:
  - `sanitizeReservedIdents` in `src/core/backends/glsl-sanitize.ts` for locals, parameters, and function names (the rename);
  - `TS8068 RESERVED_NAME` as a warning, from `reportReservedNames`, for a struct, a field, a constant, an override, a module variable, or a binding, on a module with no compute entry, since a compute kernel has no GLSL form;
  - its sentence, `"half" is reserved in GLSL ES 3.00, so a field of that name cannot be emitted for the WebGL2 target. Rename it.`;
  - the fail-closed step in `glsl-sanitize.ts` (`field 'V.half' is a GLSL ES 3.00 reserved word and cannot be renamed here; pick another name`), reported as the `TS8015` warning of Rule 12.3 with `wgsl` kept;
  - `src/compiler/ts/reserved-names.test.ts`, which pins all three.

**Rule 3.5.** A name the compiler generates (the mangler, the type aliaser) must not be a keyword or reserved word of either target.

- Rationale: a generated `as` is a program the author never wrote and cannot fix.
- Derives from: the same two WGSL sections; `WGSL_RESERVED` and `GLSL_ES300_RESERVED` in `src/core/reserved-words.ts`, from which `RESERVED_WORDS`, the list a generated name is checked against, is built.
- Enforced by: `examples/reserved-word-safety.test.ts`, asserted on the rename maps.

### 3.5. The case of a type name

**Rule 3.6.** A type name an author writes must be lowercase when WGSL declares it and capitalized when TypeShade declares it, so the case of a name says where its meaning comes from.

- Rationale: `f32`, `vec3`, `mat4x4`, `array`, `atomic`, `texture_2d`, `sampler`, `storage` and `uniform` are WGSL's own words, and an author who reads them in the WGSL specification finds the same word here; `Vec64Any`, `MatColumn`, `LaneKeys`, `TextureElem`, `TexelCoord2` and `VecFor3` are names TypeScript needed and WGSL does not have, and the capital says so.
  TypeScript's own convention, lowercase for a primitive and capitalized for an interface, points the other way for `array`, and it loses for a reason the ambient library already shows: `SHADE_DTS` is compiled as the whole library (`lib: []` in `src/language-service/host.ts`, `noLib: true` in `src/compiler/ts/diagnostic.ts`), so it declares the minimal globals TypeScript demands itself, and `interface Array<T>` is already one of them, carrying `length` and an index signature so that a list literal has a type at all.
  The capitalized `Array<T>` is therefore the checker's array, the one the standard library would have supplied, and the lowercase `array<T, N>` is the author's, the one WGSL spells with a size.
  Raising the author's name to `Array` would collide with that, and would have to raise `vec3` and `f32` with it, which is the whole WGSL vocabulary this surface exists to spell.
  What a TypeScript author expects of an array is bought with behaviour instead: the aggregate operations get member forms on that same `interface Array<T>`, which `array<T, N>` picks from by name (`Pick<Array<T>, ArrayOps>`, #177), and a read-only view is `ReadView<T>` mapping the surface's own index signature to a readonly one rather than a borrowed `ReadonlyArray`.
- Derives from: WGSL [Types](https://gpuweb.github.io/gpuweb/wgsl/#types), whose type names are lowercase; `src/language-service/ambient.ts`'s own `interface Array<T>` and the `lib: []` compiler options beside it.
- Enforced by: `surface-names.test.ts`, whose WGSL source check passes only for a name the fixture carries under WGSL's spelling, so a capitalized WGSL name would be reported as unsourced and a lowercase TypeShade name needs a §9.3 row that review reads.

### 3.6. Claim rules for numbers

**Rule 3.7.** A new surface section must take the next free `§` number in `docs/use-typeshade-surface.md` as the current tree makes it, and a new diagnostic must take the next free `TS80xx` code in `src/compiler/ts/codes.ts`.
A branch working in parallel may instead be handed a block of numbers and take the number from the block.
A number must not be renumbered, a retired number must not be reused, and the unused numbers of a block must stay a gap.

- Rationale: a section number and a code are cited from issues, tests, and CHANGELOG entries that do not move when the document does.
- Derives from: #162 ("claim before you write"); PR #165's body, which took its numbers from a block; the numbering comment at the head of `codes.ts` (8011 is retired and stays a gap; `TS8099` is the parked catch-all; after `TS8038`, a block handed to a parallel branch leaves a gap that is never reused).
- Enforced by: review; `src/compiler/ts/codes.ts` is a hot-spot file (Rule 13.5).

PR #165 took `TS8068` and §62 from such a block, and its `codes.ts` records why the sequence has a gap after `TS8038`.
On this tree the sequential codes end at `TS8038` (`F64_ENTRY_IO`, PR #166), `TS8068` is the first block-assigned code, and the surface document runs to §40 in sequence with §62 taken from the block.
A gap a block leaves is recorded by the pull request that lands the block, in the same change, and never before it.
The unused numbers of a block stay unused, as 8011 does.

## 4. Types

### 4.1. Definition

A _shader type_ is a type the compiler can lower to a WGSL type.
Appendix A lists every TypeShade spelling beside the WGSL type it names.

### 4.2. Rules

**Rule 4.1.** Every type an author writes must be a WGSL type under a TypeScript spelling, or a member of the f64 family (Rule 4.4).

- Rationale: the layout, the constructors, and the builtins of a type are WGSL's; a type WGSL does not have has none of those.
- Derives from: [Types](https://gpuweb.github.io/gpuweb/wgsl/#types), [Plain Types](https://gpuweb.github.io/gpuweb/wgsl/#plain-types-section) and [Texture and Sampler Types](https://gpuweb.github.io/gpuweb/wgsl/#texture-sampler-types).
- Enforced by: `SUPPORTED_TYPE_NAMES` in `src/compiler/ts/type-map.ts` (`TS8002 UNKNOWN_TYPE` names the whole list) and `surface-names.test.ts` for the spellings.

**Rule 4.2.** A type alias is another name for its target.
An alias of a scalar, a vector, an array, or a struct must resolve wherever a type may stand, and an alias, an interface, or a class over an object type is one struct.
A builtin type name must win over an alias of the same name, so `type vec3 = f32` does not make `vec3` a scalar.

- Rationale: the first two clauses are what a type alias means in TypeScript and in WGSL alike.
  The third is a recorded divergence from WGSL, where a module-scope declaration hides the predeclared object of the same name.
  It is kept because a file that re-types a builtin name would make every later use of that name mean something no reader of the surface can see.
- Derives from: [Type Aliases](https://gpuweb.github.io/gpuweb/wgsl/#type-aliases) for the resolution; surface §2 (roadmap 0.3 item T2) for the precedence, which reverses [Declaration and Scope](https://gpuweb.github.io/gpuweb/wgsl/#declaration-and-scope) ("predeclared objects, and objects declared at module-scope, are in scope across the entire program source", and the example "Shadowing predeclared objects", where a module-scope `fn min()` hides the builtin).
- Enforced by: `src/compiler/ts/type-alias.test.ts` (resolution, and "an alias cannot shadow a builtin name") and `TS8023 DUPLICATE_SYMBOL` for a second declaration of one struct name, whether or not anything uses the struct (#172), pinned by `src/compiler/ts/type-structs.test.ts`.

**Rule 4.3.** A brand must be erased: `f32 & { readonly [m]: 'm' }` and `{ readonly __brand: 'm' }` are the carrier type, and the brand must reach no emitted text.

- Rationale: the brand exists so that `tsc` distinguishes two uses of one carrier, and `tsc` is where that check belongs.
- Derives from: surface §28.
- Enforced by: `examples/tuple-and-brand.shade.ts` on both halves of the gate.

**Rule 4.4.** The f64 family (`f64`, `vec2f64`, `vec3f64`, `vec4f64`, the short spellings `vec2d`, `vec3d`, and `vec4d` and, by type argument, `mat2<f64>`, `mat3<f64>`, and `mat4<f64>`) is the one numeric type family TypeShade adds that WGSL does not have.
The compiler must emit an `f64` value as a pair of `f32` on every GPU target, and must evaluate it as a double on the CPU oracle.

- Rationale: an emulated double is the one thing a reference evaluation in double precision can offer a GPU target that has no double, and it earns a type because a pair of `f32` with the emulation's invariants is not an `f32` and must not assign to one.
- Derives from: [Floating Point Types](https://gpuweb.github.io/gpuweb/wgsl/#floating-point-types), which lists no 64-bit type; `src/core/passes/fp64-lower.ts`; the allowlist family 1.
- Enforced by: `src/core/passes/fp64-lower.test.ts` and the `emulated` rows of the determinism report (surface §38).

A matrix of `f64` is `matN<f64>` (surface §40), a type argument on a WGSL name and not a name of the family.
A new _type_ of the family that needs a name of its own is a row of §9.3 and follows Rule 13.6.
A function over the family's representation (a split of an `f64` into its halves, a rebuild from them, under whatever name) is not a spelling of the family but a compiler-internal name (§2.1), and never has a row.
The family's surface rules (which builtins take an `f64`, what a mixed `f64 ∘ f32` operand does, whether an `f64` may cross a stage boundary) are surface §39 (#151; Rule 2.3, Rule 5.2), pinned by `src/compiler/ts/f64-types.test.ts`.

**Rule 4.5.** A TypeScript type the GPU has no word for must be refused in one sentence naming the reason and what to write instead; the list is surface §28 and is not repeated here.

- Rationale: the constraint is the target's, and the sentence has to say so at the line the author wrote.
- Derives from: surface §28 (roadmap 0.3 item T10); [Plain Types](https://gpuweb.github.io/gpuweb/wgsl/#plain-types-section) for what a value type is.
- Enforced by: `src/compiler/ts/honest-refusals.test.ts`.

**Rule 4.6.** `number` and `boolean` must not be written as shader types; a number on the GPU has a width, and the boolean is spelled `bool`.

- Rationale: an `f32`, an `i32`, and a `u32` are three types with three layouts, and `number` names none of them.
- Derives from: [Integer Types](https://gpuweb.github.io/gpuweb/wgsl/#integer-types), [Floating Point Types](https://gpuweb.github.io/gpuweb/wgsl/#floating-point-types), [Boolean Type](https://gpuweb.github.io/gpuweb/wgsl/#bool-type).
- Enforced by: `TS8002 UNKNOWN_TYPE` (`A number on the GPU has a width. Write f32 for a float, i32 or u32 for an integer.`; `TypeShade spells the boolean "bool".`), beside the last row of the surface §28 table.

**Rule 4.7.** `f16` and the `h` spellings must not be authorable until the roadmap's After 1.0 row is picked up; the `f16` capability may be declared through the EDSL and nothing an author writes uses it.

- Rationale: a new scalar touches every table in the compiler, and the surface has to freeze first.
- Derives from: `docs/roadmap.md` After 1.0 ("`f16` and the `h` vectors"); #153.
- Enforced by: `src/core/backends/capability-reachability.test.ts`, whose witness table records `f16` as declared-but-unusable.

**Rule 4.8.** Every `matCxR` with `C` and `R` in 2, 3, 4 must be a type, and a square one must also answer to `matN`.
A matrix element must be `f32`, or `f64` on a square shape only.
A two-row matrix (`mat2x2`, `mat3x2`, `mat4x2`) in a uniform block must be refused with the remedy, since WGSL gives its column a stride of 8 and std140 rounds every column to 16, so the two targets would place it and every later field at different offsets.

- Rationale: a shape both targets lay out alike needs no ceremony, and a shape they lay out differently is refused rather than padded, because padding would make the emitted WGSL disagree with the offsets `reflect()` reports (Rule 6.8).
- Derives from: [Matrix Types](https://gpuweb.github.io/gpuweb/wgsl/#matrix-types) (`matCxR<T>`, `T` a floating-point type) and [Memory Layout](https://gpuweb.github.io/gpuweb/wgsl/#memory-layouts) (the column stride is `AlignOf(vecR<T>)`); PR #166, which measured the std140 stride on a WebGL2 driver and on Tint (surface §40); #149.
- Enforced by:
  - `MAT_TYPE_NAMES` in `src/compiler/ts/type-map.ts` for the nine shapes and the three short spellings (`TS8002 UNKNOWN_TYPE` names all twelve);
  - `TS8027 MAT_UNSUPPORTED` for a non-square `matCxR<f64>` (`mat2x3<f64> has no emulated-double form: the fp64 pass carries a square matrix of doubles only (mat2, mat3, mat4). Declare it mat2x3 and narrow, or use a square shape.`);
  - `TS8051 LAYOUT` in `src/compiler/ts/bindings.ts` for the two-row uniform field, at the binding's declaration and with neither target emitted (`"U.m" is in a uniform: mat2x2 in std140 is not supported`, a sentence that goes on to name `mat2x4` and two `vec2` fields as the remedies), pinned by `src/compiler/ts/uniform-layout.test.ts`; `wgslLayout` in `src/core/reflect.ts` throws the same sentence from `src/core/std140.ts` for a std140 layout built another way;
  - `TS8003 TYPE_MISMATCH` for `a * b` on two matrices whose dimensions do not meet, two of one non-square shape among them (`Type mismatch: cannot * mat2x3<f32> and mat2x3<f32>. WGSL's matrix product is matKxR * matCxK -> matCxR: …`), pinned by `src/compiler/ts/matrices.test.ts` (`refuses two matrices of ONE non-square shape, which have one type key`) (#169);
  - `src/compiler/ts/matrices.test.ts`, `src/core/reflect.test.ts`, and `examples/normal-matrix.shade.ts` on both halves of the gate, which pin them.

## 5. Literals and typing

### 5.1. Definition

A _written number_ is a numeric literal in the source, with a leading minus sign counted as part of it.
An _integer-written_ literal has no decimal point and no exponent.

### 5.2. Rules

**Rule 5.1.** An integer-written literal must take the integer type the position around it declares; in a position that declares no integer type it must be an `f32`.

- Rationale: this is WGSL's abstract-integer rule narrowed to the positions where a type is stated, and the `f32` default is the surface's history rather than WGSL's rule.
- Derives from: [Abstract Numeric Types](https://gpuweb.github.io/gpuweb/wgsl/#abstract-types) and [Conversion Rank](https://gpuweb.github.io/gpuweb/wgsl/#conversion-rank); surface §13.
- Enforced by: `src/compiler/ts/lit-coerce.ts`, `src/compiler/ts/int-lit-context.test.ts`, and `int-lit-coerce.test.ts`.

The default is _open_: WGSL concretizes an undecided integer literal to `i32`, TypeShade to `f32`, and #148 proposes the flip with a deprecation window (§14).

**Rule 5.2.** A written number beside a typed peer in an arithmetic operator or a builtin call must take the peer's kind; a written number beside an `f64` or an `f64` vector must become an `f64` literal carrying the full double.

- Rationale: a literal has no type of its own until something states one, and the peer is the nearest statement.
- Derives from: [Overload Resolution](https://gpuweb.github.io/gpuweb/wgsl/#overload-resolution-section); surface §13 (the `min(1, i)` edge).
- Enforced by: `retargetLit` in `src/compiler/ts/numeric.ts` (the lift is guarded on `isF64(peer) || isVec64(peer)`, PR #166), so `x + 0.1` and `min(x, 0.1)` on an `x: f64` both carry the pair `(0.10000000149011612, -1.4901161415892261e-9)`; `src/compiler/ts/int-lit-coerce.test.ts` and `int-lit-context.test.ts` (the `min(1, i)` case); `src/compiler/ts/f64-types.test.ts` (`lifts a literal beside an f64 and a declared f64 const`) for the double.

`f64(0.1)` says the same thing explicitly and emits the same pair (surface §39).

**Rule 5.3.** There is no implicit conversion between concrete types; an `i32` beside a `u32`, or an integer beside a float, must be refused with the cast to write.

- Rationale: WGSL has no implicit integer or int/float conversion, and a conversion the emitted text does not contain is one Tint refuses.
- Derives from: [Conversion Rank](https://gpuweb.github.io/gpuweb/wgsl/#conversion-rank) (every rank between two concrete types is infinite).
- Enforced by: `TS8003 TYPE_MISMATCH` with the text "WGSL has no implicit integer conversion. Cast one side" (`numeric.ts`), pinned by `src/compiler/ts/numeric.test.ts`.

**Rule 5.4.** A literal must fit the type it takes; `-1` in a `u32` position and `2147483648` in an `i32` position are refused as written.

- Rationale: an out-of-range literal has no value in the type and would be a different number on the GPU.
- Derives from: [Literals](https://gpuweb.github.io/gpuweb/wgsl/#literals) (an integer literal must be representable in its type).
- Enforced by: `TS8003` (surface §13, "the value has to fit").

**Rule 5.5.** A single float-written literal valued as a whole number may take a declared integer type in a declaration only; a return, an argument, and a field must not take that carve-out.

- Rationale: the carve-out predates the integer rule and was kept so that programs did not break; extending it would make `1e3` an integer in places where it never was.
- Derives from: surface §13.
- Enforced by: `src/compiler/ts/int-lit-context.test.ts`, which covers the ten declared positions.

## 6. Declarations and resources

### 6.1. Definition

A _resource_ is a value the host provides: a uniform buffer, a storage buffer, a texture, or a sampler.
A _module constant_ is a value fixed at compile time; an _override_ is one fixed at pipeline creation; a _module variable_ is memory the module owns.

### 6.2. Rules

**Rule 6.1.** A resource must be written `declare const x: uniform<T>`, `declare const x: storage<T>`, `declare const x: storage<T, "read_write">`, or `declare const x: <texture or sampler type>`.
It must have no initializer, and its binding slot is the source order of `declare` in the file.
A resource is never declared with `let`: `declare let x: storage<T>` and `declare let x: uniform<T>` are both refused, and each refusal names the `declare const` form of the line it is on.

- Rationale: `declare` is TypeScript's own word for a value that exists elsewhere, which is what a host-owned resource is, and `const` is the only keyword that says anything true about one, since nothing rebinds the name.
- Derives from: [Variable and Value Declarations](https://gpuweb.github.io/gpuweb/wgsl/#var-and-value), [Address Spaces](https://gpuweb.github.io/gpuweb/wgsl/#address-space), [Shader Interface](https://gpuweb.github.io/gpuweb/wgsl/#shader-interface); surface §1, §7 and §15.
- Enforced by:
  - `TS8099` for a `declare` with a plain type (`declare "x" must be uniform<T>, storage<T>, a texture, a sampler or override<T>.`);
  - `TS8099` for `declare let x: storage<T>` and for `declare let x: uniform<T>`, raised in `src/compiler/ts/bindings.ts` where the declaration's keyword is already read, each sentence naming the `declare const` line to write instead;
  - `TS8033` for a resource type without `declare`, whose sentence names the `declare const` form and, on a `storage` with no access mode of its own, the mode the KEYWORD asked for (`let dst: storage<array<f32>>` names `declare const dst: storage<array<f32>, "read_write">`, the same reading of the same keyword `bindings.ts` makes); a resource with no type argument names the shape `storage<...>`, since the type is one only the author knows;
  - `examples/binding-declared.test.ts` for the slot order.

**Rule 6.2.** A storage binding's access mode is its second type argument: `storage<T>` is `var<storage, read>` and `storage<T, "read_write">` is `var<storage, read_write>`.
The only two words the argument takes are `"read"` and `"read_write"`, spelled as string literal types.
A `uniform` binding is read-only and has no access mode, so `uniform<T>` takes one type argument.
A write to a read-only resource must be refused, by the compiler and by the editor.

- Rationale: the access mode is part of the WGSL type, so it belongs in the type, and the host's bind group layout has to agree with it; the declaration keyword cannot carry it, because a TypeScript `const` array forbids rebinding the name and permits `arr[0] = 1`, which is the opposite of what a `const` storage buffer meant.
- Derives from: [`var` Declarations](https://gpuweb.github.io/gpuweb/wgsl/#var-decls) and [Memory Access Mode](https://gpuweb.github.io/gpuweb/wgsl/#memory-access-mode); surface §7. The two words are WGSL's own enumerants and already appear on this surface in `texture_storage_2d<"r32float", "read_write">`, so neither takes a §9.3 row.
- Enforced by:
  - `TS8002` for an access word outside the two, and for a second type argument on a `uniform<T>`, raised in `src/compiler/ts/bindings.ts`, which recovers the binding as `read_write` so that the author's own write is not a second sentence on the same program;
  - `TS8099` for the retired `{ access }` option of the call form, raised in the same file, whose sentence names the type-argument spelling to write;
  - `TS8005 CONST_ASSIGN` for a write to a read-only resource, whose sentence names the `storage<T, "read_write">` remedy when the target is a storage binding (`writableRemedy` in `src/compiler/ts/context.ts`), and for an atomic builtin on a read binding, whose sentence names the mode rather than the keyword (`src/compiler/ts/lower/atomics.ts`). It names no line in the two cases where no line would close the program: when the binding's declared value type was itself refused and recovered, since the line would be built from a type the compiler could not read (`storage<mat2x3<f64>>` was answered with `storage<mat2x3, "read_write">`, the `<f64>` dropped), and when the target is no place on either mode, which is why the root's access is checked after the target is known to be one, for an element (`md[0]` on an `f64` matrix) and for a member after every one of that branch's refusals (`src.length`, an emulated-double lane `dv[0].x`, a multi-component swizzle `v.xy`);
  - TypeScript's own codes in the editor, because the ambient library resolves `storage<T>` and `uniform<T>` to `ReadView<T>` and `storage<T, "read_write">` to `T` itself: `TS2542` on an indexed write (`src[0] = 1.`), `TS2540` on a field write (`u.scale = 1.`), `TS2344` on an access word outside the two and `TS2314` on a second type argument to a `uniform` (`src/language-service/ambient.test.ts`);
  - `src/compiler/ts/declare-bind.test.ts` for the access mode each spelling collects, and
    `src/compiler/ts/remedy-lines.test.ts` for the lines these sentences name: every refusal that
    quotes a declaration has that declaration written back into its own program, which must then
    compile clean and be clean in the editor;
  - not by the editor in two places, which Appendix B records: an atomic builtin on a read binding
    and a mutating method on a class-typed read binding are refused by the compiler alone.

**Rule 6.3.** A top-level `const` is a module constant: a scalar must fold to one value carried at double precision for the oracle and at the target's precision for emit, and a vector, array, or struct must carry a constant-foldable expression every backend evaluates.

- Rationale: a module constant must be one value on every backend, and the dual-precision scalar is how the oracle stays exact where the target rounds.
- Derives from: [Value Declarations](https://gpuweb.github.io/gpuweb/wgsl/#value-decls) (`const`); `AGENTS.md` ("module constants are scalar dual-precision by default"); surface §12.
- Enforced by: `src/compiler/ts/module-const.ts` and `module-const.test.ts`; a `bool` constant is `true`, `false`, `1`, or `0` (`TS8003`, `Module const "K" is bool, but 2 is neither true nor false. Write true, false, 1 or 0.`, pinned by `rejects a bool module const that is neither true nor false`).

**Rule 6.4.** A pipeline-overridable constant must be written `const x: override<T> = default` or `declare const x: override<T>`.

- Rationale: WGSL's `override` has no TypeScript form, so the wrapper is the one place the word appears (§9.3, family 2).
- Derives from: [`override` Declarations](https://gpuweb.github.io/gpuweb/wgsl/#override-decls); surface §15.
- Enforced by: `examples/override-constants.test.ts`.

**Rule 6.5.** A top-level `let` is a module variable in the per-invocation (`private`) address space; workgroup memory must be written `let x: workgroup<T>`; a module variable must take no `declare`.

- Rationale: a module-level `let` already says "a value this invocation owns", so the address space is read off the syntax and only the space TypeScript cannot express gets a wrapper.
- Derives from: [Address Spaces](https://gpuweb.github.io/gpuweb/wgsl/#address-space); surface §24; the roadmap's first rule.
- Enforced by: `TS8033 MODULE_VAR` and `src/compiler/ts/module-vars.test.ts`.

**Rule 6.6.** An entry point's inputs and outputs are explicit parameters and return values; every parameter and every field of an entry I/O struct must carry `@builtin("...")` or `@location(n)`, and the builtin name must be one WGSL defines for that stage and direction.

- Rationale: an implicit stage input hides a dependency, and WGSL refuses an entry I/O member with no attribute.
- Derives from:
  - [Shader Interface](https://gpuweb.github.io/gpuweb/wgsl/#shader-interface);
  - [Inter-stage Input and Output Interface](https://gpuweb.github.io/gpuweb/wgsl/#stage-inputs-outputs), whose definition of a stage input reads "each datum is either a built-in input value, or a user-defined input";
  - its subsection [Input-output Locations](https://gpuweb.github.io/gpuweb/wgsl/#input-output-locations), which carries the two requirements ("each user-defined input and output must have an explicitly specified IO location"; "each structure member in the entry point IO must be one of either a built-in value, or assigned a location", each a shader-creation error);
  - [`builtin`](https://gpuweb.github.io/gpuweb/wgsl/#builtin-attr) and [`location`](https://gpuweb.github.io/gpuweb/wgsl/#location-attr);
  - surface §3.
- Enforced by:
  - `TS8024 BUILTIN_NAME` and `TS8025 BUILTIN_STAGE` for the builtin name and its stage;
  - `TS8029 STRUCT_FIELD_MISSING_ATTR` for a field of an entry I/O struct;
  - nothing at the front end for a bare parameter: `@fragment export function fs(p: vec4): vec4` compiles and reaches the WGSL text as `fn fs(p: vec4<f32>)` with no attribute, which WGSL refuses;
  - the GLSL writer alone, which reports it as a `TS8015` warning on a render module (`entry 'fs' input 'p' has neither @location nor @builtin`) and not at all on a compute-only module (Appendix B).

**Rule 6.7.** The attribute names the compiler reads are `@vertex`, `@fragment`, `@compute`, `@builtin`, `@location`, `@interpolate`, `@invariant`, `@blend_src`, and `@diagnostic` (the last four since #168, surface §53 and §54); every other WGSL attribute is either inferred by the compiler or carried as an argument (`@compute([64, 1, 1])` carries `@workgroup_size`), and a decorator outside that list must be refused.

- Rationale: a misspelled decorator would otherwise silently stop a function being an entry point.
- Derives from: [Attributes](https://gpuweb.github.io/gpuweb/wgsl/#attributes); the fixture's `attributes` list against the ambient library.
- Enforced by: `TS8028 ATTRIBUTE_NAME` and `surface-names.test.ts`.

An integer varying needs `@interpolate(flat)` on WGSL, and the compiler derives it from the type on both writers, for a struct field and a bare entry parameter alike (#158, surface §53), pinned by `src/core/passes/varying-interpolate.test.ts`.

**Rule 6.8.** The byte layout the emitted module assumes for a resource and the layout `reflect()` reports must agree byte for byte, under WGSL's uniform and storage layout rules.

- Rationale: a buffer the host fills from `reflect()` and the shader reads by its own offsets is a dynamic error nothing detects.
- Derives from: [Memory Layout](https://gpuweb.github.io/gpuweb/wgsl/#memory-layouts) ("it is a dynamic error if buffer producers and consumers do not agree on the memory layout").
- Enforced by: `examples/emit-reflection-conformance.test.ts` for bindings, locations, and entry points, and the one layout engine in `src/core/reflect.ts` that the GLSL writer also uses, whose layout checks are the two-row matrix of Rule 4.8 and the uniform-address-space rules of surface §51 (#156): an array in a uniform is padded to a 16-byte stride and `reflect()` agrees; a `bool` in a uniform or storage struct, a runtime-sized array in a uniform, and one that is not a struct's last field are `TS8051 LAYOUT`; a field `@align` is `TS8010` (`@align on a field is not applied.`) and a field `@size` is `TS8028`; pinned by `src/compiler/ts/uniform-layout.test.ts`.

**Rule 6.9.** A struct must be the members written in it, in one of three spellings (`class`, `interface`, a `type` over an object literal).
On a class or an interface with an `extends` clause it must be the base's members first and its own after, through a chain of any depth.
A class's members include the fields its constructor's parameter properties declare, and a field written without a type takes the one its initializer names (Rule 8.14).
An interface that declares a method is a contract and not a struct: a class may name it in `implements` and a type parameter in its constraint (`<T extends Shape>`), and a value typed by it must be refused with the remedy, once, where the interface declares the method.
A call signature, an index signature, and an optional member must be refused.

- Rationale: a WGSL structure has no form for any of the three, and dropping one silently would change the buffer layout the host fills; a base's members are laid out where TypeScript's structural typing says they are, so an `extends` drops nothing.
  An interface with a method says what a class supplies, and a call through it runs the body of the class the value is, which static dispatch finds through that class or through the type parameter a call binds (Rule 8.9); a value of the interface's own type would have to pick the body at run time, which a WGSL function cannot.
- Derives from: [Structure Types](https://gpuweb.github.io/gpuweb/wgsl/#struct-types); TypeScript's [`implements` clauses](https://www.typescriptlang.org/docs/handbook/2/classes.html#implements-clauses) and [generic constraints](https://www.typescriptlang.org/docs/handbook/2/generics.html#generic-constraints); surface §2; surface §26 ("`extends`, `abstract` and `implements`", roadmap 0.3 item T5, #92; "An interface with methods is a contract").
- Enforced by: `TS8010 STRUCT_FIELD`, pinned by `src/compiler/ts/type-structs.test.ts` (a method signature on an interface a value is typed by, `"Bad" declares a method, so it is a contract a class implements and not a value a shader holds: take the class that implements it, or a type parameter it constrains, "<T extends Bad>(v: T)".`; a call signature, an index signature, an optional field); `src/compiler/ts/class-syntax.test.ts` for a contract in `implements` and in a constraint, held to one value on every CPU path, and `examples/class-parts.shade.ts` in the compile gate; `src/compiler/ts/inheritance.test.ts` (`a derived struct is its base plus its own`) for the layout.

**Rule 6.10.** A local `const` binds its name once and leaves what it holds as writable as TypeScript does.
A write into it (to a field, a component or an element, or by a method that writes its object) must change the value when the initializer builds one nothing else holds (`new`, an object literal, an array literal or a type's constructor, alone or with methods called on it), the declaration being emitted as a `var` from then on; it must be refused with the remedy when the initializer may be a value something else holds (a name, a field, an element, a parameter, a function's result).
A `const` nothing writes into stays WGSL's `let`.

- Rationale: `const v = new V(); v.bump()` is how TypeScript is ordinarily written, since a `const` fixes the name and not the object; nothing else holds the object `new` built, so the local is that object, and a write through it changes what TypeScript changes.
  A `const` that copies a value another name holds is where the two would part: TypeScript's write reaches the object both names hold, and a write here would reach the copy alone, so the front end asks which is meant, a `let` to write a copy or the write on the value itself.
  Before this rule every write through a `const` was refused, with `let` as the remedy.
  A struct is a value here, so `const w = v` and `let w = v` copy it, where TypeScript hands `w` the object `v` holds; a write through either name after the copy is not seen through the other, which Rule 7.2's table records.
- Derives from: ECMAScript [`let` and `const` declarations](https://tc39.es/ecma262/#sec-let-and-const-declarations) (a `const` binding cannot be assigned again, and what it holds is not frozen); [Value Declarations](https://gpuweb.github.io/gpuweb/wgsl/#value-decls) and [`var` Declarations](https://gpuweb.github.io/gpuweb/wgsl/#var-decls); Rule 8.10; surface §26.
- Enforced by: `TS8005 CONST_ASSIGN` for a write through a `const` that may hold a shared value (`"v" is a const whose value may be one something else holds, which TypeScript would change with it and a copy here would not. Declare it with let to write a copy, or write through the value itself.`), `TS8035 CLASS_MEMBER` for a method that writes its object called on one; pinned by `src/compiler/ts/member-assign.test.ts`, `src/compiler/ts/class-methods.test.ts` and `src/compiler/ts/class-syntax.test.ts`, which also holds the three CPU paths to one value for a write through a `const` that built its value; `examples/class-parts.shade.ts` in the compile gate.

## 7. Expressions and statements

### 7.1. Definition

An _expression_ is a TypeScript expression the compiler lowers to a WGSL expression, and a _statement_ is a TypeScript statement it lowers to a WGSL statement.
A _lowering_ is the mapping from one such form to the other, and a _recorded divergence_ is a place where the TypeScript meaning and the WGSL meaning differ, which Rule 7.2 writes down.
A _counted loop_ is a `for` loop whose induction variable moves by a constant step toward a bound the loop body does not write (Rule 7.5); its trip count is known when it is compiled if its start and bound are constants, and when it runs otherwise.
An _open loop_ is a `while` loop: it ends when its condition fails, or at a `break` or a `return` in its body (Rule 7.5).

### 7.2. Rules

**Rule 7.1.** An operator, a swizzle, an index, and a call must mean what WGSL's typing table gives them.

- Rationale: Rule 1.1 applied to expressions.
- Derives from: [Expressions](https://gpuweb.github.io/gpuweb/wgsl/#expressions), [Arithmetic Expressions](https://gpuweb.github.io/gpuweb/wgsl/#arithmetic-expr), [Bit Expressions](https://gpuweb.github.io/gpuweb/wgsl/#bit-expr).
- Enforced by: the compile gate and `src/core/oracle-backend-parity.test.ts`; `TS8003` for a matrix product whose dimensions do not meet (Rule 4.8, #169).

**Rule 7.2.** Where TypeShade lowers a TypeScript form to a WGSL form, the mapping must be a rule with a recorded divergence; the mappings today are:

| TypeScript form                                            | WGSL form                                                                                             | Divergence recorded in                                                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `c ? a : b` on a scalar or vector                          | `select(b, a, c)`, WGSL's own argument order                                                          | surface §10; `CHANGELOG.md` (ternary as `select`); [`select`](https://gpuweb.github.io/gpuweb/wgsl/#select-builtin) |
| `c ? a : b` on a struct or an array                        | an `if` with a temporary, since WGSL has no `select` over a composite                                 | surface §31 (#113)                                                                                                  |
| `a ** b`                                                   | `pow(a, b)`, float-only                                                                               | surface §10                                                                                                         |
| `atan(y, x)`                                               | `atan2(y, x)`                                                                                         | surface §10                                                                                                         |
| `switch`                                                   | WGSL's `switch`, which never falls through; a trailing `break` is dropped                             | surface §14; [Switch Statement](https://gpuweb.github.io/gpuweb/wgsl/#switch-statement)                             |
| `x << n`, `x >> n`                                         | the amount is a `u32`; an `i32` amount is cast (`x << u32(n)`), binary and compound alike             | surface §14, §22 and §52; [Bit Expressions](https://gpuweb.github.io/gpuweb/wgsl/#bit-expr)                         |
| `[a, b]` in a typed position                               | `array<T, 2>(a, b)`                                                                                   | surface §18 and §28                                                                                                 |
| `{ field: value }` in a typed position                     | a struct constructor                                                                                  | surface §16                                                                                                         |
| `obj.method()`                                             | `Cls_method(obj, …)`, dispatched statically                                                           | surface §26                                                                                                         |
| `o.x`, `o.x = v` on an accessor                            | `Cls_get_x(o)`, `Cls_set_x(&o, v)`; `o.x += v` goes through both                                      | Rule 8.11; surface §26                                                                                              |
| a private name `#x`                                        | `x`, private through the front end's check alone                                                      | Rule 8.12; surface §26                                                                                              |
| a static field the file writes                             | a `var<private>` `Cls_f`, as a top-level `let` is                                                     | Rule 8.13; surface §26                                                                                              |
| a call that writes, in an expression                       | a `let` ahead of it, in source order; an `if` for `?:`, `&&` and `\|\|`                               | Rule 7.9; surface §26                                                                                               |
| `v.setX(1.).setY(2.)` as a statement                       | `V_setX(&v, 1.0); V_setY(&v, 2.0);`, each call on the chain's root                                    | Rule 8.10; surface §26                                                                                              |
| `D.f()` on a static `D` inherits                           | `D_f`, the base's body lowered again with `this` as `D`                                               | Rule 8.13; surface §26                                                                                              |
| `const v = new V(); v.bump()`                              | `var v: V = V_new(); V_bump(&v);`, a `var` from the first write through it                            | Rule 6.10; surface §26                                                                                              |
| `f = (x: f32): f32 => …` in a class                        | `Cls_f`, a method under the field's name                                                              | Rule 8.16; surface §26                                                                                              |
| a local function that reads `n` of the function around it  | `fs_f(n, …)`: `n` is a parameter of `fs_f`, which every call passes                                   | Rule 8.17; surface §14                                                                                              |
| a local function that writes `n` of the function around it | `fs_f(&n, …)`, `n: ptr<function, T>` in `fs_f` (`inout` in GLSL ES 3.00)                              | Rule 8.17; surface §14                                                                                              |
| `apply(sq, x)`, `f` a parameter of function type           | `apply_sq(x)`: `apply` once for each function its calls hand it                                       | Rule 8.18; surface §14                                                                                              |
| `s.each(sq)`, `each` a method that takes a function        | `Swarm_each_sq(s)`, and `&s` where a function handed over writes `s`, the one reference both use      | Rules 8.10 and 8.18; surface §26                                                                                    |
| an arrow function written as an argument                   | a local function of the calling body, typed by the parameter                                          | Rule 8.18; surface §14                                                                                              |
| a function, a method or an accessor with no return type    | the type of its first `return` with a value, `-> f32`; none without one                               | Rule 8.19; surface §14                                                                                              |
| `() => n += k` with no return type                         | the assignment as a statement, and the function returns nothing, where TypeScript returns the new `n` | Rule 8.19; surface §14                                                                                              |
| `return g()`, `g` returning nothing                        | `g(); return;`                                                                                        | Rule 8.19; surface §14                                                                                              |
| `const w = v`, `let w = v` on a struct                     | a copy, where TypeScript shares one object; a write through either name is not seen through the other | Rule 6.10; surface §26                                                                                              |
| `for (const x of a)` over an array                         | a counted `for` over `a`'s indices, `x` a copy of `a[i]` read at the top of each trip                 | Rule 7.5; surface §17                                                                                               |
| `xs.map(f)` and the other methods of an array              | a call of a function made for the array's type and `f`, a counted `for`: `array_map_sq(xs)`           | Rule 8.18; surface §63                                                                                              |
| the `index` an array's method passes its function          | an `i32`, where TypeScript passes a `number`                                                          | Rule 7.5; surface §63                                                                                               |
| the value of `xs.map(f)`                                   | an `array<R, N>` value that a `const` holds a copy of, where TypeScript builds a new array object     | Rule 6.10; surface §63                                                                                              |

- Rationale: a TypeScript reader expects the TypeScript meaning, so every place the two languages differ has to be written down where the reader will look.
- Derives from: the rows above.
- Enforced by: the emit goldens and the tests each row's surface section names.

**Rule 7.3.** An empty `switch` case directly above a case with a body is one clause with several selectors (`case 0: case 1:` is WGSL's `case 0, 1:`); an empty case with no case below it or directly above `default:`, and an empty `default:` with a case after it, must be refused; a case body must not fall through into the body of a case below it.

- Rationale: WGSL's `switch` has no fall-through, but a clause may carry several selectors, which is what stacked empty cases mean in TypeScript; the three refused shapes have no clause the compiler can join them to (surface §52; #168 changed this rule, which refused every empty case).
- Derives from: [Switch Statement](https://gpuweb.github.io/gpuweb/wgsl/#switch-statement).
- Enforced by: `src/compiler/ts/switch-array.test.ts` (`shares one body between two selectors, on both targets`); `TS8017 SWITCH_CASE` for the three refused shapes (`switch case 1 has no body: …`, `switch case 1 sits above "default:" with no body of its own. …`, `"default:" has no body of its own and a clause follows it. …`); `TS8017 SWITCH_CASE` at the label of a case or `default:` whose end is reachable and below which a clause has a body (`switch case 0 falls through into the next case: …`), by TypeScript's own reachability (`src/compiler/ts/fallthrough.ts`), in `src/compiler/ts/operators-statements.test.ts` (`a case body does not fall through`, #202). A case that runs on only into empty clauses at the end of the switch runs nothing more in TypeScript either, and is not refused.

**Rule 7.4.** A shift amount the compiler can fold must be in 0 to 31; a divisor the compiler can prove to be zero must be refused where the division is lowered.

- Rationale: WGSL takes a shift amount modulo the bit width and makes a const-expression amount at or past it a shader-creation error, and makes a const-expression divisor of zero a shader-creation error, giving `x` only where the divisor is not known before shader execution; GLSL ES 3.00 leaves both undefined, and a program that is certainly undefined on one target should not compile.
- Derives from: [Bit Expressions](https://gpuweb.github.io/gpuweb/wgsl/#bit-expr) (the concrete shift rows); [Arithmetic Expressions](https://gpuweb.github.io/gpuweb/wgsl/#arithmetic-expr); surface §22 (#71, #68).
- Enforced by: `TS8003 TYPE_MISMATCH` from `src/compiler/ts/lower/expression.ts`, where `lowerBinary` folds a shift amount through `foldConstNumber` (`src/compiler/ts/loop-bound.ts`) and a divisor through `divisorIsZero`; `src/compiler/ts/lower/statement.ts` (`lowerBitwiseAssignOp`) for a compound shift assignment; and `foldsToZero` in `src/compiler/ts/module-const.ts`, which refuses a module const whose initializer divides by a proven zero; pinned by `src/compiler/ts/shift-amount.test.ts` and `src/compiler/ts/zero-divisor.test.ts`.

**Rule 7.5.** A `for` loop must be counted: an `i32` or `u32` induction variable, a constant step, and an exit that compares the induction variable to a bound; the start and the bound may be runtime values, the loop body must not write the bound, and the step must move the variable toward the bound. A runtime bound must be compared with `<`, `<=`, `>` or `>=`, and a multiplicative step with a runtime start or bound must be a whole factor of 2 or more. A header whose start and bound are constants must reach its bound within the induction type's range. An induction variable with no annotation is an `i32`, or a `u32` when its initializer is a non-negative integer literal and the bound it is compared with is a `u32`; that is the integer type the position declares for Rule 5.1. A `while` loop is an open loop and may have any `bool` condition; a `while` whose condition is constantly `true` must have a `break` or a `return` in its body. No limit is placed on a trip count. A `for…of` over an array (`array<T, N>`, or a runtime-sized storage array) is a counted loop over the array's indices, from `0` to its length; its variable is a `const` or a `let` holding a copy of the element, and the array must be a name, or a member or index path to one. A `for…in` must be refused.

- Rationale: both targets accept a runtime bound and an open loop (#203 measured each on Tint and on ANGLE), and a program over data loops over a count it learns at run time. The analyses of roadmap items 15, 18 and 21 need a counted shape, a step whose direction is known and a bound the body does not move; none of them needs the bound to be a literal (#203). What a counted `for` promises a reader is exactly that shape, so a loop that ends some other way is written as a `while`, which says so. `for (let i = 0; i < data.length; i++)` is the loop a TypeScript author writes first, and `data.length` is a `u32`: a counter that stayed `i32` would make it a comparison of two integer types the author never wrote. `for (const x of xs)` is the other loop a TypeScript author writes over data: its trip count is the array's length, which the body cannot change (WGSL has no array that grows), so it is a counted loop with nothing left to check. `for…in` enumerates an object's keys, which a shader value does not have.
- Derives from: [Loop Statement](https://gpuweb.github.io/gpuweb/wgsl/#loop-statement), [For Statement](https://gpuweb.github.io/gpuweb/wgsl/#for-statement), [While Statement](https://gpuweb.github.io/gpuweb/wgsl/#while-statement); surface §17; #203.
- Enforced by: `TS8006 LOOP_BOUND` (an exit that is not a comparison with a bound; `==` or `!=` against a runtime bound; a multiplicative step with a runtime start or bound that is not a whole factor of 2 or more; a bound the body writes; a constant header that leaves its type), `TS8007 LOOP_INFINITE` (a step away from the bound, or one that never moves the variable; a constant header that never exits; a `for` with no condition; `while (true)` with nothing that leaves it), `TS8008 LOOP_INDUCTION`; pinned by `src/compiler/ts/runtime-loop-bound.test.ts` and `src/compiler/ts/loop-shapes.test.ts`, and by `examples/loops-over-data.shade.ts` on the compile gate. What is not checked is in Appendix B.

#203 decided the two loop questions §14 held open: the ceiling of 256 trips (#144 §6 D1) is removed, and a `while` is an open loop whose progress is the author's to ensure, as it is in WGSL.

**Rule 7.6.** A read of a local before its first assignment is zero on WGSL and on the CPU, and undefined on GLSL ES 3.00; the divergence is recorded and the author should assign before reading.

- Rationale: the two targets differ here, and the oracle follows WGSL by Rule 1.3.
- Derives from: [`var` Declarations](https://gpuweb.github.io/gpuweb/wgsl/#var-decls) (zero-initialization); surface §14.
- Enforced by: not enforced as a diagnostic; recorded in surface §14 (Appendix B).

**Rule 7.7.** `discard` must be written as a bare statement, the identifier alone (`discard`), and may stand in a fragment entry and in a helper no vertex or compute entry can reach.
The check closes over the call graph, and `discard()` is not a call the surface has.

- Rationale: WGSL's `discard` is a statement of the fragment stage; TypeScript has no statement to borrow, so the ambient library declares `discard` as a constant of type `void` (§9.3, family 5) and the compiler lowers an expression statement that is exactly that identifier to the statement, with the stage rule kept.
- Derives from: [Discard Statement](https://gpuweb.github.io/gpuweb/wgsl/#discard-statement) ("must only be used in a fragment shader stage"); surface §10; `declare const discard: void` in `src/language-service/ambient.ts`.
- Enforced by: `src/compiler/ts/builtins.test.ts` (`discard`: lowers to the discard statement, emits it on both targets); `TS8099` names the entry, or the helper and the entry, on the wrong stage; `discard()` is `TS8004`, which says that `discard` is a statement and is written without the parentheses (`src/compiler/ts/unknown-names.test.ts`).

**Rule 7.8.** The refusals of surface §28 (a union of two GPU types, a string type, a nullable, a mixed tuple, a rest tuple, `symbol`, an intersection of carriers, `instanceof`, `in`) must apply to expressions as they do to types, each in one sentence.

- Rationale: see Rule 4.5.
- Derives from: surface §28.
- Enforced by: `src/compiler/ts/honest-refusals.test.ts`.

**Rule 7.9.** An expression must be evaluated left to right, as TypeScript and WGSL both evaluate it, and a call that writes (its object, a module variable, a storage binding, an atomic location) inside a larger expression must take effect in that order on every target.
The compiler binds each such call to a temporary ahead of its statement, in source order, and binds ahead of the call an operand evaluated before it that reads what it writes; a call TypeScript evaluates conditionally, in an arm of `?:` or the right operand of `&&` or `||`, keeps its condition as an `if`.
A loop condition runs on every iteration, so it may hold such a call only as one side of its comparison.

- Rationale: GLSL ES 3.00 leaves the order of an operator's operands open, and a scalar `?:` lowers to WGSL's `select`, which evaluates both arms, so the one order every target keeps is the order the compiler writes out; the passes that fold and repeat expressions then see no call that writes inside one.
- Derives from:
  - [Program Order Within an Invocation](https://gpuweb.github.io/gpuweb/wgsl/#program-order) ("The order of evaluation for operands of an expression is left-to-right in WGSL. For example, foo() + bar() must evaluate foo() before bar().");
  - [Function Calls](https://gpuweb.github.io/gpuweb/wgsl/#function-calls) ("Function call argument values are evaluated. The relative order of evaluation is left-to-right.");
  - GLSL ES 3.00 §5.11, which relaxes C++'s rules and fixes no order for an operator's operands, §6.1.1 ("All arguments are evaluated at call time, exactly once, in order, from left to right"), and §5.8 ("Expressions on the left of an assignment are evaluated before expressions on the right of the assignment");
  - surface §19 and §26.
- Enforced by: `src/compiler/ts/sequence.ts` (`sequenceEffects`), pinned by `src/compiler/ts/sequence.test.ts`, which holds the CPU oracle, the codegen and the debugger to the source order; `TS8006 LOOP_BOUND` for a loop condition that holds a call that writes anywhere but as one side of its comparison (`A while condition runs "rng.next()" on every iteration, and a call that writes can stand there only as one side of the comparison. …`); `examples/rng-method.shade.ts` in the compile gate.

## 8. Functions and entry points

### 8.1. Definition

A _function_ is a top-level `export function` or `function`; an _entry point_ is a function decorated with `@vertex`, `@fragment`, or `@compute`; a _helper_ is any other function.
A class method, a constructor, and a static function are functions of the module under their flattened names (surface §26).

### 8.2. Rules

**Rule 8.1.** An entry point is a top-level function; an entry method on a class must be refused.

- Rationale: `this` is not a GPU instance, and an entry has no receiver.
- Derives from: [Entry Points](https://gpuweb.github.io/gpuweb/wgsl/#entry-points); surface §3 and §4.
- Enforced by: `TS8035 CLASS_MEMBER` (`A decorator has no place on "C.k"; an entry is a top-level function.`), beside surface §7's row "`@compute` method on a class".

**Rule 8.2.** A vertex entry must return the position, as a bare `vec4` or as a struct with a `@builtin("position")` field; a fragment entry returns one `@location(0)` value, a struct of render targets, or nothing.

- Rationale: nothing can invent a position, and WGSL says so.
- Derives from: [Restrictions on Functions](https://gpuweb.github.io/gpuweb/wgsl/#function-restriction) ("a vertex shader must return the position built-in output value"); surface §3.
- Enforced by: `src/compiler/ts/entry-io.test.ts`.

**Rule 8.3.** A builtin WGSL confines by stage may be used in an entry of a permitted stage, and in a helper that no entry of an excluded stage can reach.
The derivatives, implicit-LOD sampling, and `discard` may be used in the fragment stage only.
Barriers and workgroup memory may be used in the compute stage only.
The atomic builtins may be used in the compute and fragment stages, and must not be used in the vertex stage.

- Rationale: the stage rule is Tint's, and the call graph is how a helper inherits it.
- Derives from:
  - [Derivative Built-in Functions](https://gpuweb.github.io/gpuweb/wgsl/#derivative-builtin-functions) ("must only be used in a fragment shader stage");
  - [Discard Statement](https://gpuweb.github.io/gpuweb/wgsl/#discard-statement);
  - [Synchronization Built-in Functions](https://gpuweb.github.io/gpuweb/wgsl/#sync-builtin-functions) ("all synchronization functions must only be used in the compute shader stage");
  - [Address Spaces](https://gpuweb.github.io/gpuweb/wgsl/#address-space) ("variables in the workgroup address space must only be statically accessed in a compute shader stage");
  - [Atomic Built-in Functions](https://gpuweb.github.io/gpuweb/wgsl/#atomic-builtin-functions) ("atomic built-in functions must not be used in a vertex shader stage", with no other stage restriction);
  - surface §10, §24, and §25.
- Enforced by:
  - the reachability check in `src/compiler/ts/lower/function.ts` (`TS8099` names the builtin, the helper, and the entry) for the fragment-only builtins;
  - `TS8033` for workgroup memory, and `TS8034` for a barrier outside a compute entry (a barrier in a branch is Rule 8.5's `TS8052`);
  - `TS8099` for an atomic builtin in a `@vertex` entry or in a helper it reaches (`"atomicAdd" is only valid in a fragment or compute shader; "vs" is a vertex entry. WGSL allows an atomic built-in in a fragment or compute stage only.`), pinned by `src/compiler/ts/atomics.test.ts` (`refuses atomicAdd in a vertex entry`).

**Rule 8.4.** A function must not take part in a call cycle, directly or through other functions; the check reads the calls a body writes, and the calls a method call, an accessor and `new` lower to, before any optimisation, so a call in a branch the optimizer would drop is a cycle too.

- Rationale: WGSL has no call stack, and matching the optimizer would make the answer depend on constant folding an author cannot predict.
  A call on a value (`this.g(n)`, `o.m()`), a read or write of an accessor and `new` name no function in their text, so the check reads them as lowered; before that, a cycle through a method reached Tint.
- Derives from: [Restrictions on Functions](https://gpuweb.github.io/gpuweb/wgsl/#function-restriction) ("recursion is disallowed because cycles are not permitted among any kinds of declarations"); surface §4.
- Enforced by: `TS8031 RECURSION`, on the call that closes the cycle, naming the whole cycle as the author writes its members (`Recursive call: "N.f" -> "N.g" -> "N.f". WGSL has no call stack, so a function must not take part in a call cycle.`), once for a body a class inherits and once for every instance of a generic function; pinned by `src/compiler/ts/namespace.test.ts`, `src/compiler/ts/default-args.test.ts` and `src/compiler/ts/class-syntax.test.ts`.

**Rule 8.5.** A collective operation (a derivative, an implicit-LOD texture sample, a barrier) must be in uniform control flow.

- Rationale: a barrier outside uniform control flow is a shader-creation error.
  A derivative or an implicit-LOD sample outside it triggers the `derivative_uniformity` diagnostic, whose default severity is `error` and which a WGSL author can lower or turn off with a `diagnostic` filter.
  The compiler performs the analysis at the source line (Rule 12.6) and emits a filter only where the author writes `@diagnostic` on an entry (surface §54).
- Derives from: [Uniformity](https://gpuweb.github.io/gpuweb/wgsl/#uniformity); [Synchronization Built-in Functions](https://gpuweb.github.io/gpuweb/wgsl/#sync-builtin-functions) ("all synchronization functions must only be invoked in uniform control flow"); [Derivative Built-in Functions](https://gpuweb.github.io/gpuweb/wgsl/#derivative-builtin-functions) ("trigger a derivative_uniformity diagnostic if uniformity analysis cannot prove the call is in uniform control flow"); [Filterable Triggering Rules](https://gpuweb.github.io/gpuweb/wgsl/#filterable-triggering-rules) (default severity `error`).
- Enforced by: `TS8052 UNIFORMITY` for a derivative, an implicit-LOD sample, or a barrier reached under a condition on a non-uniform value, naming the value (#161); `@diagnostic("off", "derivative_uniformity")` on the entry emits `diagnostic(off, derivative_uniformity);` and lifts the derivative half, never the barrier half; pinned by `src/core/passes/uniformity.test.ts` and `src/compiler/ts/barriers.test.ts`.

**Rule 8.6.** An entry point must not be called from another function.

- Rationale: WGSL forbids it, and an entry's parameters are stage inputs no caller can supply.
- Derives from: [Restrictions on Functions](https://gpuweb.github.io/gpuweb/wgsl/#function-restriction) ("an entry point must never be the target of a function call").
- Enforced by: `TS8099` (`"fs" is a fragment entry point and cannot be called; the pipeline invokes it. Move the body into a plain function and call that from both.`), pinned by `src/compiler/ts/operators-statements.test.ts` (`refuses calling an entry point`) (#160).

**Rule 8.7.** `@compute` carries the workgroup size as an array literal of one to three whole numbers, `x`, `y` and `z`, a missing `y` or `z` being 1, and the default is 64; every extent reaches the emitted `@workgroup_size` and the reflection, and a shape over WebGPU's default compute limits must be reported as a warning.

- Rationale: an argument the decorator cannot read must not fall through to a default the author did not ask for, and an extent the author wrote must not be dropped. The limits are the device's, not the language's: a device requested with raised limits runs a larger workgroup, so a shape over the defaults compiles, and the warning says which limit the host has to raise.
- Derives from: [`workgroup_size`](https://gpuweb.github.io/gpuweb/wgsl/#workgroup-size-attr); WebGPU [Limits](https://gpuweb.github.io/gpuweb/#limits) (`maxComputeWorkgroupSizeX` and `Y` 256, `Z` 64, `maxComputeInvocationsPerWorkgroup` 256); #118.
- Enforced by:
  - `TS8037 WORKGROUP_ARG`, where a bare `@compute` emits `@workgroup_size(64)` and the object form is refused (`@compute takes an array of one to three whole numbers, "@compute([64, 1, 1])", or no argument for the default of 64; "{ workgroup: [64, 1, 1] }" is not a workgroup shape.`);
  - `TS8026 WORKGROUP_SHAPE`, a warning naming the first default limit the shape exceeds;
  - `SD0111`, which keeps a `portable` kernel's workgroup one-dimensional, since the WebGL2 lowering has no workgroup;
  - surface §3's bullets on the payload of `@compute`, under the entry example, which state the default of 64, the emitted spelling of a two- or three-dimensional shape, the limits warning, and the refused object form.

**Rule 8.8.** A parameter an author writes must be passed by value; there must be no pointers and no reference parameters.
The object of a method that changes its object, and a variable of the function around it that a local function writes, are not parameters an author writes: Rules 8.10 and 8.17 govern them, and each is passed by reference.

- Rationale: whether a parameter is a reference is a language decision the roadmap places after 1.0.
  The two references are how the emitted function keeps TypeScript's own meaning (a method writes the object it was called on, a closure writes the variable it closes over), and no author writes either one.
- Derives from: `docs/roadmap.md` After 1.0 ("pointers and reference parameters"); [Function Calls](https://gpuweb.github.io/gpuweb/wgsl/#function-calls).
- Enforced by: `TS8020 FUNCTION_SHAPE` for a parameter shape the surface does not take.

**Rule 8.9.** Method dispatch must be static, and a generic function or class must be compiled once per set of type arguments the file uses.
A body a class inherits is compiled again for that class; what fails only there (a call that takes the base, a static the class does not have) must be refused when a function that is not a class's own reaches it through calls, and must not be when nothing does, the body being dropped with every function that calls it.

- Rationale: a WGSL struct is one layout and a WGSL function has one overload, so the only meaning a generic or a method can have is the monomorphised one.
- Derives from: [Functions](https://gpuweb.github.io/gpuweb/wgsl/#functions) ("each user-defined function only has one overload"); surface §26, §30, §32 (design #92).
- Enforced by: `TS8035 CLASS_MEMBER` and `examples/generic-class.shade.ts`; `src/compiler/ts/class-syntax.test.ts` for a body a class inherits that fails for it alone, said when a call reaches it and dropped when none does.

**Rule 8.10.** A method that writes its object (assigns to `this` or to a field, a component or an element of it, applies `++` or `--` to one, or calls such a method or reads such a getter on `this`, on a field, a component or an element of it whatever class that field is, or through `super`) must take the object by reference, and may return a value like any other method; a base's body that a class calls through `super` and that writes its object takes it by reference too, and so does the copy of a method that takes a function (Rule 8.18) when a function handed over writes the variable the call is on.
Its receiver must be a place a function may write: a `let` local, a `const` local whose initializer built its value (Rule 6.10), a module variable, a storage element, or `this` inside a constructor or another such method, or a field or an element of one of those.
A receiver that is a parameter, a `const` whose value something else may hold, or a value nothing holds must be refused with the remedy, as must a call of such a method that returns nothing where a value is expected.
A method whose every `return` is `return this` returns its object, and a chain of calls on what it returns that is the whole of a call statement, of a declaration's initializer or of a `return` (`v.setX(1.).setY(2.)`) must run each call but the last as a statement of its own, in source order, on the place the chain starts from, found once before the first call (an index it is reached through is read into a `let`), a `new` at the root being held in a temporary; inside a larger expression what such a method returns is a copy, and a call on it that writes its object must be refused with the remedy.

- Rationale: WGSL takes a place as a pointer and GLSL ES 3.00 as an `inout` parameter, and either leaves the return free for a value, so a generator's `next()` can advance its state and return the draw as TypeScript's own method does; the rule that such a method returns nothing belonged to the protocol that returned the struct itself, which the reference replaced. A base's body called through `super` changes the object of the body that called it, which hands its own reference on. A function handed to a method may write the very object the method runs on (`this.each((i) => { this.total += … })`), which in TypeScript is one object, so the copy takes it by the one reference both use. A field of `this` is part of `this`, so `this.body.step(dt)` writes `this` when `step` writes its object, whichever class declares `step`; before this a method that did so was refused as one that reads its object only. `return this` hands back a struct, which is a value: where a chain is the whole statement it can run on the place itself, which is TypeScript's meaning, and where it is not, the copy is all there is, which is right for a read and wrong for a write.
- Derives from: [Reference and Pointer Types](https://gpuweb.github.io/gpuweb/wgsl/#ref-ptr-types); [Function Calls](https://gpuweb.github.io/gpuweb/wgsl/#function-calls); GLSL ES 3.00 §6.1.1 ("Evaluation of an inout parameter results in both a value and an l-value"); ECMAScript [the `super` keyword](https://tc39.es/ecma262/#sec-super-keyword); surface §26 (design #86 step 2).
- Enforced by: `TS8035 CLASS_MEMBER` for each refusal (`"Gen.next" changes its object, and "r" is a const whose value may be one something else holds, which TypeScript would change with it and a copy here would not. Declare it with let to change a copy, or call it on the value itself.`; `"V.setY" changes its object, and inside this expression it would change the copy "v.setX(3.)" hands back. Make the chain a statement of its own, or call each method on the object itself.`), pinned by `src/compiler/ts/class-methods.test.ts` and `src/compiler/ts/class-syntax.test.ts`, which also hold the three CPU paths to one value for a method that changes its object and returns one, a base's body called through `super` that writes its object, a chain, and a method that writes its object through a field of another class, three levels deep; `src/compiler/ts/higher-order.test.ts`, which holds them to one value for the copy of a method whose function writes the object the call is on; `src/compiler/ts/inout-params.test.ts`; `examples/orbit-inout.shade.ts`, `examples/particle-step.shade.ts`, `examples/rng-method.shade.ts`, `examples/class-builder.shade.ts` and `examples/class-parts.shade.ts` in the compile gate.

**Rule 8.11.** A `get` or `set` accessor is a function of the module, `Owner_get_x` or `Owner_set_x`, which takes its object as a method does (Rule 8.10); a read of `o.x` must call the getter, and an assignment, a compound assignment, `++` and `--` must call the setter with the new value, the compound forms reading the old one through the getter.
The nearest class of a chain that declares either half of an accessor owns both, as in TypeScript, and either half's annotation types the other when one has none.
`super.x` must call the half of `x` that the nearest class above the one that wrote the body declares, lowered for this class and run on this body's object.
A read of an accessor with no getter, a write of one with no setter, a `super.x` whose class above declares the other half alone or names an instance field, which is the object's own, and a write into what a getter returns (`o.pos.x = 1.`), which is a copy, must be refused with the remedy.

- Rationale: an accessor is TypeScript's own spelling of a computed or checked property, and a function for each half is all it is once `this` has a name; a getter hands back a value and not a place, so a write through its result would change a copy and be lost where TypeScript changes the object.
- Derives from: ECMAScript [method definitions](https://tc39.es/ecma262/#sec-method-definitions) (`get` and `set`) as TypeScript spells them; [Function Calls](https://gpuweb.github.io/gpuweb/wgsl/#function-calls); surface §26.
- Enforced by: `TS8035 CLASS_MEMBER` for each refusal (`"C.y" has a getter and no setter, so it cannot be assigned. Declare "set y(value)" beside the getter.`; `"super.x" names a field, and a field is the object's own, which "super" does not reach. Write "this.x".`) and `TS8018 ASSIGN_TARGET` for a write through a getter, pinned by `src/compiler/ts/class-syntax.test.ts`, which also holds the three CPU paths to the value the WGSL and GLSL ES 3.00 text computes; `examples/class-syntax.shade.ts` and `examples/class-builder.shade.ts` in the compile gate.

**Rule 8.12.** A private name `#x` must be emitted without its `#`: a field as the struct member `x`, a method as `Owner_x`, an accessor as `Owner_get_x` and `Owner_set_x`, a static field as `Owner_x`.
It may be named only inside the body of the class that declares it, which is TypeScript's rule and which the front end enforces because it does not run the checker; a public name never reaches a private member, and an object literal, a spread and a destructuring pattern do not reach one either.
Two members of one class chain that would share an emitted name (`#x` beside `x`, a static field beside a function of its name, or `#x` declared by a class and again by one that extends it) must be refused.

- Rationale: WGSL and GLSL ES 3.00 have no private member and no `#` in a name, so privacy is a property of the source that the front end keeps, and it can keep it only while no emitted name stands for two members.
- Derives from: ECMAScript [private names](https://tc39.es/ecma262/#sec-private-names) as TypeScript spells them (TS18013 for an access from outside, TS2741 for a literal of such a class); Rule 3.2; surface §26.
- Enforced by: `TS8035 CLASS_MEMBER` for an access from outside the class, for two members on one function name and for a static field and a function on one module name (`The static field "Base.#n" and the function "Base.n" would both be "Base_n": a private name is emitted without its "#". Rename one of them.`), `TS8010 STRUCT_FIELD` for two members on one struct member and for an object literal of a class with a private field, pinned by `src/compiler/ts/class-syntax.test.ts`; `examples/class-syntax.shade.ts`.

**Rule 8.13.** A static field must be a module constant `Owner_x` when nothing in the file writes it, and a module variable in the per-invocation space (Rule 6.5) when something does; a `readonly` static is never written.
A class inherits the statics of the classes it extends: `D.K`, `D.f()` and `D.x` reach the nearest class above `D` that declares them, and a static function or accessor `D` inherits must be lowered again for `D`.
Inside a static member `this` is the class the call names, `D` in `D.f()`: `this.K`, `this.f()` and `this.x = v` name its statics, `new this(...)` builds it, and a static that builds its value with `new this(...)` and is declared to return the class that declares it returns `D`; `super.K`, `super.f()` and `super.x` name the statics of the class above the one that wrote the member.
A write to a static field through a class that does not declare it (`D.K = v`, `this.K = v`, `super.K = v`), `this.#x` where `this` is a class that extends the one declaring `#x`, `this` as a value, and a static block must be refused with the remedy; a write into such a static (`D.origin.y = v`, a method that changes it) changes the one object both classes read, and a generic base's statics are its class's, one for every instance.

- Rationale: a static field that TypeScript code writes is state of the program's run, which on the GPU is the invocation, so it is the variable a top-level `let` already is (surface §24); one no code writes folds as a top-level `const` does; a static block runs when a class is evaluated, and a shader has no such moment. TypeScript keeps statics on the constructor, whose prototype is its base's constructor, so a read finds the nearest declaration, `this` in a static member is the constructor the call names, and a write through a derived constructor gives it a property of its own, which one module variable cannot be; a private static lives on its declaring constructor alone, so TypeScript throws where a derived class reaches it through `this`.
- Derives from: Rule 6.3; Rule 6.5; ECMAScript [ClassDefinitionEvaluation](https://tc39.es/ecma262/#sec-runtime-semantics-classdefinitionevaluation) (the constructor's prototype is the base constructor) and [the `super` keyword](https://tc39.es/ecma262/#sec-super-keyword); [Variable and Value Declarations](https://gpuweb.github.io/gpuweb/wgsl/#var-and-value); surface §24 and §26.
- Enforced by: `TS8035 CLASS_MEMBER` for a static block, for `this` as a value, for `this.#x` through a class that extends the one declaring it (`"Derived" has no "#k": a private static is the class's own, and TypeScript throws where a body "Derived" inherits reaches it through "this". Name the class that declares it, "Base.#k".`) and for `super.K = v`; `TS8005 CONST_ASSIGN` for a write to a `readonly` static and for one through a class that does not declare it (`"Derived.count" is a static "Base" declares, and assigning it through "Derived" would give "Derived" a copy of its own in TypeScript. Write "Base.count".`); `TS8013 HOST_STMT` for `new this()` outside a static member; pinned by `src/compiler/ts/class-syntax.test.ts` and `src/compiler/ts/class-methods.test.ts`, which also hold the three CPU paths to one value for a static a derived class inherits and for `super` in a static member; `examples/class-builder.shade.ts` in the compile gate.

**Rule 8.14.** A constructor's parameter property (`constructor(public x: f32)`, or `private`, `protected` or `readonly` in place of `public`) is a field of its class, at the constructor's place among the members, which the constructor assigns from the parameter before the field initializers run.
A field written without a type must take the type its initializer names (a written number is an `f32` by Rule 5.1, `true` and `false` a `bool`, `new C()` the struct `C`, and a type's own constructor that type), and a field whose initializer names none, or that has neither, must be refused.
A `readonly` field may be assigned only in a constructor of the class that declares it, which is TypeScript's rule; `readonly` is shallow, as TypeScript's is, so a write into what the field holds stands.
Field initializers must run in TypeScript's order: those of the classes above the class whose constructor runs first (in the base constructor its `super(...)` calls, or before its body when none of them has one), that class's parameter properties and its own after `super(...)` returns, and those of the classes below it when its body returns, so an initializer a derived class writes for an inherited field runs last.

- Rationale: all three are how a TypeScript class is ordinarily written; before this rule a field without a type was dropped from the struct with nothing said where it was declared and an unknown field at every use, and a `readonly` field took any write. Every initializer ran before the constructor's body and a derived class's one for an inherited field was dropped, so `class B extends A { limit = 5. }` built a `B` whose `limit` was `A`'s.
- Derives from: TypeScript's [parameter properties](https://www.typescriptlang.org/docs/handbook/2/classes.html#parameter-properties) and `readonly` modifier (TS2540); Rule 5.1; Rule 6.9; surface §26.
- Enforced by: `TS8010 STRUCT_FIELD` for a field with no type, `TS8005 CONST_ASSIGN` for a write to a `readonly` field, pinned by `src/compiler/ts/class-syntax.test.ts`.

**Rule 8.15.** A member declared `private` may be named only inside the body of the class that declares it, and one declared `protected` only inside the bodies of that class and of the classes that extend it, on an object of the naming body's own class or of one that extends it; a name either rule does not allow must be refused with the remedy.
The declaration a name is checked against is the one the class whose body holds it sees, whichever class that body is compiled for (Rule 8.9), and a field a derived class declares again without a modifier is public, as TypeScript allows.
An object literal cannot build a class with a `private` or `protected` field, and a spread and a destructuring pattern leave such a field out, as they leave out a private name (Rule 8.12).

- Rationale: `private` and `protected` are TypeScript's own access rules, and the front end does not run the checker that enforces them, so without this a program TypeScript refuses would compile; before this rule the two keywords were accepted and meant nothing.
- Derives from: TypeScript's [member visibility](https://www.typescriptlang.org/docs/handbook/2/classes.html#member-visibility) (TS2341, TS2445, TS2446; TS2322 for a literal of such a class); Rule 8.12; surface §26.
- Enforced by: `TS8035 CLASS_MEMBER` for each refusal (`"C.x" is private, so only the body of "C" may name it. Reach it through a public member of "C".`; `"C.p" is protected, and "D" may name it only on a "D"; this object is a "C". Reach it through a public member of "C".`), `TS8010 STRUCT_FIELD` for an object literal of such a class, pinned by `src/compiler/ts/class-syntax.test.ts`.

**Rule 8.16.** An instance field that holds an arrow function or a function expression is a method of its class under the field's name: the function's parameters, return type and body are the method's, an expression body is the value it returns, and `this` in it is the object, as it is in TypeScript.
With no return type written, it returns what its body does, and an expression body that is an assignment, `++` or `--` runs as a statement (Rule 8.19).
A static field that holds a function, a function with type parameters, and an `async` or generator function must be refused with the remedy.
A member a class that extends declares again must keep the kind the class above gives it, as TypeScript requires (a field, a method or an accessor, a field that holds a function standing where a method was and a field where an abstract accessor was), and `super.f` on a field that holds a function must be refused; so must an accessor over an abstract field, which TypeScript takes and which a struct here cannot mean.

- Rationale: `onHit = (d: f32): f32 => d * this.k` is how TypeScript code often writes a method, to keep `this` bound; a shader has no function value to hand anywhere, so the one thing such a field can be is the method it is written as, called as `o.onHit(d)`, and `this` is the object in both.
  A static one binds `this` to the class that declares it where a static method binds it to the class the call names (Rule 8.13), so it is written as the static method it means; type parameters need a generic function.
  TypeScript refuses a member that changes kind in a class that extends, and without the check each such program compiled to the derived class's member where TypeScript's object holds the base's; a field is the object's own, so `super` does not reach one.
  An abstract field is laid out in every struct below the class that declares it, so a body that class wrote reads the member and never an accessor a class below declares, 0 where TypeScript computes the getter; `abstract get f(): T` says the same thing and reaches the accessor.
- Derives from: ECMAScript [class field definitions](https://tc39.es/ecma262/#sec-classfielddefinition-record-specification-type) and [arrow functions](https://tc39.es/ecma262/#sec-arrow-function-definitions) (`this` is the object the field initializer runs for); TypeScript's override checks (TS2416, TS2423, TS2425, TS2426, TS2610, TS2611) and TS2855 (`super` on a field); Rule 8.9; Rule 8.13; surface §26.
- Enforced by: `TS8035 CLASS_MEMBER` for each refusal (`A static field holding a function is a static method: write "static f(...) { ... }".`; `"B.f" is a method, and the "A.f" it overrides is a field that holds a function; TypeScript refuses an override of another kind. Declare it as a field that holds a function, or rename it.`; `"super.f" names a field that holds a function, and a field is the object's own, which "super" does not reach. Declare "A.f" as a method, or write "this.f".`), pinned by `src/compiler/ts/class-syntax.test.ts` and `src/compiler/ts/class-methods.test.ts`, which also hold the three CPU paths to one value for a field that holds a function, an override of one, and a method a field overrides; `examples/class-parts.shade.ts` in the compile gate.

**Rule 8.17.** A local function (a `const` that holds an arrow function or a function expression, or a `function` declaration, written inside a function's body) is a function of the module named after the body that declares it (surface §14), and it may read and write the variables of the functions around it, as a TypeScript closure does.
A name its body reads is looked up as TypeScript looks it up, from the innermost block outward; one that lands on a `let`, a `const` or a parameter of a function around it is a capture, which the emitted function takes as a parameter ahead of its own and which every call of it passes: by value while neither it nor a local function it calls writes the variable, and by reference once one does; a `const` keeps its constant, so a loop it bounds is still counted (Rule 7.5).
`this` in an arrow function is the object of the method around it, captured the same way, and the class the call names in a static member (Rule 8.13).
A write through a capture follows the variable's own declaration: a `let` may be written, a `const` only through what it holds and only when its initializer built the value (Rule 6.10), and a parameter never (Rule 8.8).
A `function` declaration may be called anywhere in its block, as TypeScript hoists it, and a local function may be declared in a generic function, once for each of its instances.
A call of a local function at a point where a variable it captures is not declared yet must be refused, since TypeScript throws there; so must a function named where a value is read (held in a variable, returned, compared or chosen at run time), there being no function value, other than as an argument of a parameter that takes a function (Rule 8.18).
A function named as the callback of a fold (`any(xs, isBig)`, `zip(xs, ys, f)`) passes what it captures to every call the fold makes.

- Rationale: a function is no value here: nothing can return one, store one or choose one at run time, so every call of a local function is written inside the scope that declares it, where every variable it reads is in scope too.
  Passing those variables at each call is all a closure's environment holds, and passing a written one by reference is what makes the write visible to the function around it and to the next call, as it is in TypeScript.
  A call is where TypeScript would read a variable that is not declared yet, so that is where the refusal stands.
  Before this rule a local function that read a name from the function around it was refused, with the parameter to add instead.
- Derives from: ECMAScript [function environment records](https://tc39.es/ecma262/#sec-function-environment-records) (a closure reads the binding, not a copy of it), [FunctionDeclarationInstantiation](https://tc39.es/ecma262/#sec-functiondeclarationinstantiation) (a `function` declaration is instantiated before its block runs), [`let` and `const` declarations](https://tc39.es/ecma262/#sec-let-and-const-declarations) (a binding may not be read before its declaration is evaluated) and [arrow functions](https://tc39.es/ecma262/#sec-arrow-function-definitions) (`this` is the enclosing one); Rule 6.10; Rule 8.8; Rule 8.10; Rule 8.13; surface §14.
- Enforced by: `TS8022 UNKNOWN_NAME` for a call before a captured variable's declaration (`"f" reads "y", which is not declared yet where "f" is called: a let or a const is not there before its declaration, and TypeScript throws. Call "f" after "y" is declared.`), `TS8099` for a function named as a value (`"f" is a function, and a shader has no function values: nothing at run time can hold one, return one or choose between two. Call it where its value is needed, "f(...)".`), `TS8018 ASSIGN_TARGET` and `TS8005 CONST_ASSIGN` for a write through a parameter or a `const`; pinned by `src/compiler/ts/closures.test.ts`, which holds WGSL, GLSL ES 3.00, the CPU oracle, the codegen and the debugger to one value for each form; `examples/closures.shade.ts` in the compile gate.

**Rule 8.18.** A function whose parameter has a function type, written out (`f: (x: f32) => f32`) or through a type alias of one, takes a function: a function declared at the top of the file or of a namespace, a method, a static method, a constructor, a field that holds a function (Rule 8.16) and a local function (Rule 8.17). It is compiled once for each set of functions its calls hand it, as a generic function is once for each set of type arguments (Rule 8.9), and in each copy a call of the parameter calls the function handed over (`apply_sq`, `apply_run_f`, `Swarm_each_sq`, `run_twice_run_f`).
A call hands a function over by its name (a module function, a local function, or a parameter of function type of the function the call is in) or as an arrow function or a function expression written in the call, which is a local function of the calling body (Rule 8.17) and takes its parameter types, and its return type where it writes none, from the parameter's type.
What the function handed over captures, the copy takes as parameters too and passes on, by reference where the function writes it.
A variable the copy and a function handed over both reach is passed once, as TypeScript has it once: a variable a local function and the function it is handed both capture, and the object a method is called on when a function handed over captures that very variable (`this`, or a local named as the object), which the copy then takes as its object, by reference where the caller may write it (Rule 8.10).
A function handed over takes the parameter's types and returns its type, or any type where the parameter's returns `void`, whose value is not used; an arrow function may leave parameters off at the end, as TypeScript allows, and one whose body is an expression and whose type returns `void` runs the expression as a statement.
Inside the function that takes it, a parameter of function type may only be called or handed on to another such parameter.
A fold's function (`any(xs, (x) => x > k)`, `zip(xs, ys, (a, b) => a * b)`) is handed over the same way, its types read off the arrays, and an arrow function whose return type nothing gives returns what its body does.
An array's method (`xs.map(f)`, `xs.forEach(f)`, `xs.some(p)`, `xs.every(p)`, `xs.reduce(f, init)`, surface §63) takes a function the same way, a function the file declares taking as few of the arguments as it declares: each call is a call of a function of the module made once for each array type and function handed over (`array_map_sq`), a counted loop over the indices (Rule 7.5) that hands the function the element, its index as an `i32` and the array, and for `reduce` the running value first, which has the type of the function's first parameter where that is written and of the value to start from otherwise. The loop reads the array as it goes: a module variable, a module constant or a binding in place, the variable a function handed over captures through the one reference both use, and any other array by value, an index on the way to it read once.
Of an array's methods, one `Array.prototype` has beyond those five, `map` on an array with no size, whose value would be an array with none, `reduce` with no value to start from on an array with no size, which may be empty, a second argument to any but `reduce` (`thisArg`), and a function a method passes an array with no size to must be refused.
A function type anywhere else (a return, a field, a variable), a parameter of function type on a setter or an entry point, an argument that would choose a function at run time (`c ? f : g`), a function whose copies would never end (one that hands itself a function it builds anew each time), and a call on a field or an element of a variable that a function handed over reaches, where one of the two may write it, which would be two references into one variable, must be refused.

- Rationale: TypeScript code hands functions to functions all the time: a callback to a loop helper, a predicate to a search, an operator to a fold.
  The GPU has no function value, but every call names the function it hands over, so each call reaches exactly one function, and a copy for each is what the program means; the copies are a generic function's instances by another key, and the captures, the TDZ and the cycle check are Rule 8.17's and Rule 8.4's.
  Before this rule a function type was "Unsupported type syntax" and an arrow function written as an argument "Unsupported expression".
  A copy of a method has an object, and a copy of a local function has captures of its own; each is one more parameter of the copy, and where one of them and a function handed over reach one variable, the copy takes one reference to it, since two references into one variable are refused by WGSL where either is written (Alias Analysis) and would let the method read a stale copy where they are not. A setter's value is given by an assignment, which hands it no function.
  An array's method is a loop, and a method call is an expression, which may stand in an argument, beside `&&` or in a loop's condition, where no loop can be written in place; a function of the module is a call anywhere one may be, and every target and the CPU oracle run one already, so the IR gains no node. Unrolled, as the folds are, the code would grow with the array and would have no length to unroll to for a runtime-sized array, the one a compute kernel meets first. Before this rule every method of an array was refused.
- Derives from: ECMAScript [function objects](https://tc39.es/ecma262/#sec-ecmascript-function-objects) (a function is a value a call hands over); ECMAScript [`Array.prototype.map`](https://tc39.es/ecma262/#sec-array.prototype.map) and its four siblings, which read each element as the loop reaches it; TypeScript's contextual typing of a function expression and its rule that a function with fewer parameters is assignable; WGSL's [Alias Analysis](https://gpuweb.github.io/gpuweb/wgsl/#alias-analysis); Rule 8.4; Rule 8.9; Rule 8.10; Rule 8.16; Rule 8.17; surface §14, §26 and §63.
- Enforced by: `TS8003 TYPE_MISMATCH` for a function that does not fit (`"add" takes 2 argument(s), and "(x: f32) => f32" passes 1, so it cannot be "f" of "apply".`), `TS8099` for a choice at run time (`"f" of "apply" takes a function, which a call hands over by its name or as an arrow function written there; "c ? sq : cube" would choose one at run time, and a shader has no function value to choose with.`), `TS8020 FUNCTION_SHAPE` for a parameter of function type where none may be (`"f" takes a function, and "G.each" is a setter, whose value an assignment gives it: a shader has no function value to assign. Take the function in a method instead (Rule 8.18).`), `TS8002` for a function type anywhere else, `TS8031 RECURSION` for copies without end, and `TS8099` for two references into one variable (`"f" of "Inner.each" reaches "this", which holds "this.inner", the object the call is on, so the call would take two references into one variable, which WGSL refuses where either is written. Call it on a copy in a let, and assign the copy back if the call changes it (Rule 8.18).`); for an array's methods, `TS8099` for another method (`".filter" is not one of an array's methods here, which are map, forEach, some, every and reduce. …`), for `map` on an array with no size and for a function handed that array, and `TS8019 ARITY_MISMATCH` for `reduce` with no value to start from on one and for a `thisArg`; pinned by `src/compiler/ts/higher-order.test.ts` and `src/compiler/ts/array-methods.test.ts`, which hold WGSL, GLSL ES 3.00, the CPU oracle, the codegen and the debugger to one value for each form, on a fixed-size array and on a runtime-sized storage one; `examples/higher-order.shade.ts` and `examples/array-methods.shade.ts` in the compile gate; the light-list journey on WebGPU.

**Rule 8.19.** A function that writes no return type returns what its body does, as TypeScript infers it: a function of the file or of a namespace, a local function (Rule 8.17), each instance of a generic function (Rule 8.9) and of a function that takes a function (Rule 8.18), a method, a getter and a field that holds a function (Rule 8.16) take the type of their first `return` with a value, the `return`s after it are typed against that type as against a written one, and one with no such `return` returns nothing.
An arrow function whose body is an expression returns its value, unless the expression is an assignment, `++`, `--` or a call of a function that returns nothing, which runs as a statement, and the function returns nothing; a method whose every `return` is `return this` returns its object, as one written `this` does (Rule 8.10).
A call that needs the type before the body's turn lowers that body first, so a function may be called above its declaration and from any body.
A setter's value that writes no type takes the type its getter returns, written or said by the getter's body, as TypeScript types it; an assignment that needs the type before the getter's body is lowered lowers it first.
A call back into a body still being lowered is a call cycle, and must be refused as one (Rule 8.4); so must `return`s of two types, a bare `return` beside one with a value, a default parameter value that calls such a function, since every default is lowered before any body, and a setter's value with no type and no getter, or beside a getter that returns nothing.
An entry point writes its return type, which is its output (Rule 8.2).
`return g()` where `g` returns nothing calls `g` and returns nothing, in any function.

- Rationale: TypeScript code leaves return types off as often as it writes them, most of all on a helper and on a local arrow function (`const f = (x: f32) => x * k`), and the body saying the type is the ordinary TypeScript experience.
  Before this rule a function with none returned `void` beside a TS8021 warning, so one that returned a value was a type mismatch at every call, and an arrow function whose body is an expression, a getter and a field that holds a function with none were refused.
  The front end has no checker to ask, but it lowers every body, and the type of the first `return` with a value is the one TypeScript infers whenever the program has a shader meaning: a union of two types, or `undefined` beside a value, has none, and those are refused.
  Lowering a body when a call first needs it, rather than in declaration order, is what lets a function be called above its declaration, as TypeScript hoists it; a type that waits on itself only arises in a call cycle, which is refused anyway.
  An assignment's value is what an arrow function written to run it is never for, so it runs as a statement, the one divergence here, which Rule 7.2 records.
  No call says a setter's value type, and the getter does: TypeScript types the property from the getter's return, inferred or written, and a setter with no getter is its implicit `any` (TS7006), which a shader has no word for.
- Derives from: TypeScript's [return type inference](https://www.typescriptlang.org/docs/handbook/2/functions.html#return-type-annotations) (the type of the returned expressions; TS7023 for one that waits on itself); ECMAScript [`return`](https://tc39.es/ecma262/#sec-return-statement) (`return g()` evaluates the call and returns its value, `undefined` for a function that returns nothing); Rule 8.2; Rule 8.4; Rule 8.9; Rule 8.10; Rule 8.11; Rule 8.16; Rule 8.17; Rule 8.18; surface §14 and §26.
- Enforced by: `TS8031 RECURSION` for a cycle (`Recursive call: "a" -> "b" -> "a". WGSL has no call stack, so a function must not take part in a call cycle.`), `TS8003 TYPE_MISMATCH` for two types (`Function "f" returns f32 at its first "return" and vec2<f32> at another; a function returns one type (Rule 8.19): make them agree, or write the return type.`), `TS8021 RETURN_SHAPE` for a bare `return` beside a value and for an entry that returns a value with no return type, `TS8020 FUNCTION_SHAPE` for a default (`"h" says what it returns in its body, and a default is lowered before any body: write the return type on "h" (Rule 8.19).`) and `TS8002 UNKNOWN_TYPE` for a setter's value with nothing to take a type from (`The setter "A.x" needs a type for "v": write "set x(v: T)".`, `The getter "A.x" returns nothing, so the setter has no type for "v": write "set x(v: T)".`); pinned by `src/compiler/ts/return-inference.test.ts`, which holds WGSL, GLSL ES 3.00, the CPU oracle, the codegen and the debugger to one value for each form, compares each with the program that writes its return types, and holds the multi-file path and the editor's silence; `examples/inferred-returns.shade.ts` in the compile gate.

**Rule 8.20.** A function a host file can call through an import of its module is an exported function that is not an entry point, is not generic, takes no function, has a host value (Rule 8.21) for each parameter and for its result, and reaches, through the calls of its body, no binding, no workgroup variable and no builtin only a GPU computes (a derivative, a barrier, an atomic, an implicit-LOD texture sample).
An exported constant and an `enum` are values of the host face, and an exported struct is a type of it; every other export is declared `never` in the host view, with the reason and the work that adds it, so a call of one is a type error at the host's own line.

- Rationale: a host call runs on the CPU tier (Rule 11.7), which has no device, so what it reaches must be computable there with nothing a host call does not pass; a generic function and a function that takes a function exist only as the copies the module's own calls make (Rules 8.9 and 8.18), and a host call names no such copy.
  The IR does not keep the source's export list (a generic function is its instances, a method is `P_len`, an enum is its member constants), so the host face is read off the source's `export`s and the lowering's symbol table.
  An export the host cannot use is still declared, as `never`, because an import of a name the view leaves out would be `any` in a host program that does not check it, and a crash at run time.
- Derives from: `docs/roadmap.md` item 16 ("The run layer has no import"); change `0009` in `changes/`; Rule 8.9; Rule 8.18.
- Enforced by: `hostFace` in `src/compiler/ts/host-face.ts`, which computes the callable set and the reason for each other export; pinned by `src/compiler/ts/host-face.test.ts`, one case per exclusion, and by its host programs type-checked against the view, in which a call of an export declared `never` is TS2349.

**Rule 8.21.** A host call passes and returns host values by value: an `f32`, `f64`, `i32` or `u32` is a `number`, a `bool` a `boolean`, a vector a `readonly` tuple of its components as an argument and a tuple as a result, a matrix a flat column-major array of its components, an `array<T, N>` an array of `N` host values of `T`, a struct an object of its fields, and an `enum` member its number.
Each argument is checked and converted: an `ArrayLike` of the right length becomes a fresh array, an `f32` is rounded as a buffer write rounds it, and a value that does not fit is refused with a `TypeError` naming the function, the parameter and its TypeShade type; the result aliases no argument and nothing the module keeps (Rule 8.8), and an exported constant is a frozen copy.
A call of a function this rule and Rule 8.20 admit is synchronous, and no later tier changes that; a runtime-sized array, an atomic, a texture, a sampler and a binding have no host value.

- Rationale: the representation is the one the CPU tier already runs on (`src/core/cpu-runtime.ts`), typed precisely in the host view, so there is nothing to construct and a wrong shape is a type error before it is a `TypeError`.
  The check at the call is for the caller `tsc` did not read: an IR node passed as a vector gave `NaN` in silence, and a `Float32Array` added to another gave a string.
  A later tier takes new shapes (an entry point, a runtime-sized array parameter) that are asynchronous from the day they appear, so a helper's call site never gains an `await` it does not need (`docs/dx.md` principle 4).
- Derives from: change `0009` in `changes/` ("Host values were undefined"); Rule 8.8; `docs/dx.md`.
- Enforced by: `toShader` and `fromShader` in `src/core/host-values.ts`, which the generated module calls at every argument and result; the view's types, from `hostTypeOf` in `src/compiler/ts/host-face.ts`; pinned by `src/compiler/ts/host-face.test.ts`, which checks every row in the view, a `Float32Array` vector, each refusal's text, and that a result aliases no argument.

## 9. Built-in functions and the TypeShade extensions

### 9.1. Definition

A _builtin_ is a function the compiler provides under a name of source (a) or (b).
A builtin is _portable_ when its spelling is identical on WGSL and on GLSL ES 3.00; it is _divergent_ when the GLSL writer spells it differently; it is _WGSL-only_ when GLSL ES 3.00 has no spelling and the module derives a capability (§10).

### 9.2. Rules

**Rule 9.1.** Every builtin id the compiler can emit must be classified as portable (`PORTABLE_INTRINSICS`) or as a row of the `INTRINSICS` registry; an unclassified id must not reach a backend.

- Rationale: "absent from the registry" used to mean "assume identical", and a new builtin whose spelling differs would then be emitted wrong on one target and caught only at GPU compile time.
- Derives from: [Built-in Functions](https://gpuweb.github.io/gpuweb/wgsl/#builtin-functions); the comment above `PORTABLE_INTRINSICS` in `src/core/intrinsics.ts`.
- Enforced by: `src/core/intrinsic-coverage.test.ts` (inline snapshot).

**Rule 9.2.** A builtin's signature must be WGSL's, checked at the call.
The two recorded exceptions are `atan(y, x)` (WGSL's `atan2`) and the ECMAScript arity of the `Math` members.
A name of the f64 family, which has no WGSL signature, must take the signatures WGSL gives the type it stands in for (`f64(x)` as `f32(x)`, `vecNf64` as WGSL's vector constructors), and a further signature of one is a new name under Rule 2.2.

- Rationale: an argument shape Tint refuses should be refused at the source line, with the splat or the cast to write; and a signature is a spelling, so an overload that no WGSL form has is a spelling from nowhere (§2.1).
- Derives from: [Numeric Built-in Functions](https://gpuweb.github.io/gpuweb/wgsl/#numeric-builtin-functions); [Value Constructor Built-in Functions](https://gpuweb.github.io/gpuweb/wgsl/#value-constructor-builtin-function) for the scalar and vector constructor forms; surface §10 (#57), §39.
- Enforced by: `TS8036 MATH_ARGUMENT` and `src/compiler/ts/lower/math-args.ts`; `TS8019` for `f64(a, b)` (`f64() expects 1 argument.`) and `surface-names.test.ts` (`the f64 family declares only the constructor forms WGSL gives the type it stands in for`, `the compiler refuses a second argument to f64`).

**Rule 9.3.** A WGSL builtin GLSL ES 3.00 has no spelling for must be behind a capability, and the GLSL emit must fail closed on it.

- Rationale: see Rule 1.2.
- Derives from: `docs/roadmap.md`, "make what does not compile, compile"; #152 for the builtins still to place.
- Enforced by: `src/core/passes/required-caps.ts` and `capability-reachability.test.ts`.

**Rule 9.4.** A `Math` member and its free-function spelling must lower to the WGSL builtin of the same meaning; a `Math` member with no WGSL builtin must be expanded into WGSL arithmetic and stays an ECMAScript name; `Math.fround(x)` is `f32(x)`.

- Rationale: see Rule 2.4.
- Derives from: `MATH_FN_ALIAS` and `MATH_EXPAND_ALIAS` in `src/compiler/ts/math-alias.ts`.
- Enforced by: `surface-names.test.ts` and `src/compiler/ts/math-expand.test.ts`.

**Rule 9.5.** A function the file declares must win over a builtin of the same name, as a module-scope declaration hides a predeclared object in WGSL.
The builtins that predate the rule (those not in `USER_FIRST_BUILTINS`: `clamp`, `pow`, `f32`, and the rest of the original set) keep their precedence over a function of the module, which is a recorded divergence from WGSL in the direction of Rule 4.2.
A name a function's body declares, a local function (Rule 8.17) or a parameter that takes a function (Rule 8.18), must win over every builtin, as TypeScript's lookup finds it before any global.

- Rationale: a program that meant the author's function before a builtin existed must keep meaning it, and a program that meant the builtin before the rule existed must keep meaning that.
  No program calling a name its own body declares meant a builtin: `step(i)` on a parameter `step`, and a local `const mix = …` called as `mix(…)`, reached WGSL's builtin before, a wrong arity or a silently different value, where TypeScript calls the author's function.
- Derives from: [Declaration and Scope](https://gpuweb.github.io/gpuweb/wgsl/#declaration-and-scope) (the example "Shadowing predeclared objects") for the first clause; surface §10 and `USER_FIRST_BUILTINS` in `math-alias.ts` for the second, which WGSL does not have; ECMAScript [ResolveBinding](https://tc39.es/ecma262/#sec-resolvebinding) (the innermost environment first) for the third.
- Enforced by: `src/compiler/ts/builtins.test.ts`; `src/compiler/ts/closures.test.ts` and `src/compiler/ts/higher-order.test.ts` for a local function and a parameter.

A declared function named after a GLSL ES 3.00 keyword or type name (`bool`) is renamed by the GLSL writer (`bool_`), whose rename #103 widened to every module-scope name, so it compiles on both targets.
One named after a GLSL ES 3.00 builtin function (`exp2`), which no reserved-word list carries, is emitted as written, refused by ANGLE, and accepted by Tint.
So the precedence rule can hand the author a WGSL-only module, and the compiler does not warn about it yet (surface §10, Appendix B).

### 9.3. The TypeShade extensions

**Rule 9.6.** The author-facing names of source (c) must be exactly the rows below; the table is shrink-only, and a name may join it only by Rule 13.6.

- Rationale: an extension is a decision that was reviewed, not a place to put a name that failed the source check.
- Derives from: PR #166's body, section "A design rule this lane settled"; the allowlist `TYPESHADE_EXTENSIONS`.
- Enforced by: `surface-names.test.ts` (`the TypeShade allowlist shrinks`), which fails on a row the library no longer declares and on a row WGSL or ECMAScript now covers.

<!-- LINT.IfChange(extensions) -->

| Family           | Name                     | Reason                                                                                |
| ---------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| f64 (Rule 4.4)   | `f64`                    | the double-precision scalar WGSL has no type for                                      |
| f64              | `f64Tag`                 | the brand that keeps an `f64` from assigning to an `f32`                              |
| f64              | `vec2f64`                | the two-component vector of `f64`                                                     |
| f64              | `vec3f64`                | the three-component vector of `f64`                                                   |
| f64              | `vec4f64`                | the four-component vector of `f64`                                                    |
| f64              | `vec2d`                  | the short spelling of `vec2f64`, a type name and never a call                         |
| f64              | `vec3d`                  | the short spelling of `vec3f64`, a type name and never a call                         |
| f64              | `vec4d`                  | the short spelling of `vec4f64`, a type name and never a call                         |
| f64              | `vec64Tag`               | the brand symbol of the three `f64` vector types                                      |
| resources        | `uniform`                | declares a binding in WGSL's uniform address space                                    |
| resources        | `storage`                | declares a binding in WGSL's storage address space                                    |
| resources        | `workgroup`              | declares a module variable in WGSL's workgroup address space                          |
| resources        | `override`               | declares a pipeline-overridable constant, WGSL `override`                             |
| bool vectors     | `vec2b`                  | the two-component vector of bool, which WGSL has no alias for                         |
| bool vectors     | `vec3b`                  | the three-component vector of bool, which WGSL has no alias for                       |
| bool vectors     | `vec4b`                  | the four-component vector of bool, which WGSL has no alias for                        |
| bool vectors     | `BoolVec`                | the union of the three, taken by `any`, `all` and `select`                            |
| matrices         | `mat2`                   | the short spelling of a 2x2 matrix                                                    |
| matrices         | `mat3`                   | the short spelling of a 3x3 matrix                                                    |
| matrices         | `mat4`                   | the short spelling of a 4x4 matrix                                                    |
| operations       | `mod`                    | floor-modulo over the truncating `%`; WGSL reserves the token and gives it no meaning |
| operations       | `fill`                   | builds an `array<T, N>` from one value; WGSL takes N arguments                        |
| operations       | `discard`                | WGSL `discard` is a statement, and TypeScript has none to borrow                      |
| operations       | `log10`                  | the base-10 logarithm, `log(x) * LOG10E`; WGSL has `log` and `log2`                   |
| operations       | `log1p`                  | the natural logarithm of 1 plus x, `log(x + 1)`                                       |
| operations       | `expm1`                  | e to the x, less one, `exp(x) - 1`                                                    |
| operations       | `cbrt`                   | the cube root, `pow(x, 1 / 3)`                                                        |
| operations       | `hypot`                  | the length of the vector its 2 or 3 arguments make, `length(v)`                       |
| operations       | `random`                 | a hash of its seed, an `f32` in [0, 1); ECMAScript spells a draw `Math.random()`      |
| operations       | `sum`                    | the sum of an array's elements, unrolled; WGSL has no fold                            |
| operations       | `none`                   | whether no element passes a test, unrolled; the negation of the `any` fold            |
| operations       | `zip`                    | an array built from two, element by element, by a function the call hands over        |
| storage textures | `StorageFormat`          | the texel formats a storage-texture binding may carry                                 |
| storage textures | `ReadWriteStorageFormat` | the subset a device both loads and stores                                             |
| storage textures | `StorageTexel`           | the vector type a format reads and writes                                             |
| storage textures | `StorageAccess`          | a storage texture's access mode: read, write, read_write                              |
| type machinery   | `Numeric`                | the scalar-and-vector union the arithmetic overloads use                              |
| type machinery   | `Mat`                    | the matrix brand shape                                                                |
| type machinery   | `MatColumn`              | a matrix column's vector type, per its element                                        |
| type machinery   | `LaneKeys`               | which constant indices a vector or a matrix takes at each arity                       |
| type machinery   | `Vec64Any`               | the union of the three `f64` vectors, taken by the reductions                         |
| type machinery   | `MathObject`             | the shape of the `Math` stand-in; lib.es5.d.ts calls it `Math`                        |
| type machinery   | `AnyClass`               | the constructor shape a mixin extends (surface document §29)                          |
| type machinery   | `TextureElem`            | what a sampled texture's element may be: `f32`, `i32` or `u32`                        |
| type machinery   | `Vec4OfElem`             | the `vec4` a texel fetch or a gather yields, by the texture's element                 |
| type machinery   | `TexelCoord2`            | a 2d texel coordinate, which WGSL takes as either integer vector                      |
| type machinery   | `TexelCoord3`            | a 3d or array texel coordinate, the same union one component wider                    |
| type machinery   | `BitcastArg`             | what `bitcast<T>` reads, derived from the type argument                               |
| type machinery   | `VecElemOf`              | a vector type's element kind, keyed on `keyof`                                        |
| type machinery   | `VecFor2`                | the `vec2` alias of an element type                                                   |
| type machinery   | `VecFor3`                | the `vec3` alias of an element type                                                   |
| type machinery   | `VecFor4`                | the `vec4` alias of an element type                                                   |
| type machinery   | `WriteOnlyStorageFormat` | the storage-texture formats a device stores to and never loads from                   |
| type machinery   | `StorageBufferAccess`    | a storage buffer's access mode: read, read_write                                      |
| type machinery   | `ReadView`               | the read-only view a binding's value type takes, all the way down                     |
| type machinery   | `ArrayOps`               | which members of `Array<T>` an author-facing array offers                             |
| brand tags       | `f32Tag`                 | the brand symbol of `f32`                                                             |
| brand tags       | `i32Tag`                 | the brand symbol of `i32`                                                             |
| brand tags       | `u32Tag`                 | the brand symbol of `u32`                                                             |
| brand tags       | `vecTag`                 | the brand symbol of the vector types                                                  |
| brand tags       | `matTag`                 | the brand symbol of the matrix types                                                  |
| brand tags       | `arrayTag`               | the brand symbol of `array`                                                           |
| brand tags       | `atomicTag`              | the brand symbol of `atomic`                                                          |
| brand tags       | `textureTag`             | the brand symbol of the sampled texture handles                                       |
| brand tags       | `storageTextureTag`      | the brand symbol of the storage texture handles                                       |
| brand tags       | `depthTextureTag`        | the brand symbol of the depth texture handles                                         |
| brand tags       | `samplerTag`             | the brand symbol of `sampler`                                                         |
| brand tags       | `samplerComparisonTag`   | the brand symbol of `sampler_comparison`                                              |
| constants        | `PI`                     | π as a free name; ECMAScript spells it `Math.PI`                                      |
| constants        | `TAU`                    | 2π, which neither WGSL nor ECMAScript `Math` predeclares                              |
| constants        | `E`                      | e as a free name; ECMAScript spells it `Math.E`                                       |
| constants        | `LN2`                    | the natural logarithm of 2; ECMAScript spells it `Math.LN2`                           |
| constants        | `LN10`                   | the natural logarithm of 10; ECMAScript spells it `Math.LN10`                         |
| constants        | `LOG2E`                  | the base-2 logarithm of e; ECMAScript spells it `Math.LOG2E`                          |
| constants        | `LOG10E`                 | the base-10 logarithm of e; ECMAScript spells it `Math.LOG10E`                        |

<!-- LINT.ThenChange(src/core/spec-conformance/surface-names.test.ts:extensions) -->

Nine families, and the shape of each is itself a rule:

1. The f64 family is the only place TypeShade adds a numeric type WGSL does not have (Rule 4.4); `f64FromParts` and `f64Parts` are not in it, nor is any other spelling of the same two operations, a second signature of `f64` included (§2.1, §2.4, Rule 9.2).
2. Every resource and module-variable spelling is WGSL's own word for an address space or for a declaration form TypeScript has no syntax for; the private address space is the one with no spelling at all, because a top-level `let` already is that variable (Rule 6.5).
3. The bool vectors exist because every vector comparison produces one and `any`, `all`, and `select` take one, and WGSL predeclares no alias for `vecN<bool>`.
4. The square-matrix short spellings stand beside WGSL's nine `matCxR` names, which are WGSL names and not rows (Rule 4.8).
5. `mod`, `fill` and the five free spellings of a `Math` member WGSL has no builtin for (`log10`, `log1p`, `expm1`, `cbrt`, `hypot`) name operations WGSL has no function name for, and each of them reaches the emitted text as WGSL arithmetic or as a WGSL builtin under another name; the MEMBER keeps its ECMAScript source and the free name beside it does not, which is Rule 2.1(b) read at the site the name is declared (Rule 9.4). `random` is in the family for the same reason and is the one whose `Math` member is a DIFFERENT operation, which is why the member could never have accounted for it: ECMAScript's `Math.random()` is a seedless draw and does not compile here at all, while `random(seed)` hashes its seed (surface §55, #181, Appendix B). `discard` is WGSL's statement, declared as a `void` constant so that the bare identifier is a TypeScript statement (Rule 7.7).
6. The storage-texture vocabulary is a set of names TypeScript needs in order to refer to a shape; none is a shader value, and where a row does name a set of _values_ — a storage texture's formats and access words, a storage buffer's two access words in `StorageBufferAccess` — those values are WGSL enumerants passed as strings.
7. The type machinery is the same kind of name: a shape TypeScript has to be able to refer to, and never a shader value.
8. A brand tag is never written by an author, but each is a declared name, so each is listed rather than exempted by a pattern.
9. A constant is a number the compiler inlines as an `f32` literal, and WGSL predeclares none at all; six of the seven are the free spelling of an ECMAScript `Math` constant, which is a member and therefore a different name (Rule 2.1(b)), and `TAU` is the one ECMAScript has no member for either.

Three rows are WGSL tokens given a TypeShade meaning: `override` and `discard` are WGSL [keywords](https://gpuweb.github.io/gpuweb/wgsl/#keyword-summary) that name the same declaration and the same statement here (families 2 and 5), and `mod` is a WGSL [reserved word](https://gpuweb.github.io/gpuweb/wgsl/#reserved-words), a token WGSL reserves and gives no meaning, which the row gives one.
Each is written only as the ambient library declares it, since Rule 3.3 refuses a declaration of any of the three, and `mod` reaches the WGSL text as inline arithmetic and never as the token.
`surface-names.test.ts` (`the rows that are WGSL keywords or reserved words are exactly the three §9.3 records`) pins the set against the fixture's `keywords` and `reservedWords` lists, so a new row that collides with either list is recorded here first.

**Rule 9.7.** A name must be added to the table in this order and in no other: the rationale is written into this section (and into Rule 4.4's family for an f64 type), the row is added to `TYPESHADE_EXTENSIONS` with the same reason, the surface document gains or extends a `§`, and `CHANGELOG.md` gains an entry under `[Unreleased]`.

- Rationale: the test message that catches a stray name tells the reader to do exactly this, and the order keeps the reason ahead of the name.
- Derives from: the comment above `TYPESHADE_EXTENSIONS` in `surface-names.test.ts`.
- Enforced by: `surface-names.test.ts` (`the extension table of docs/language-design.md is TYPESHADE_EXTENSIONS, row for row`), which reads the table above and fails on a row, an order, or a reason that differs from the allowlist; review for the surface `§` and the CHANGELOG.

**Rule 9.8.** A row, a declaration, a signature, an overload, or a member must never be added for a compiler-internal name (§2.1), under its own id, under an allowed id, or under a new spelling that denotes the same thing.
The reviewer reads the row's reason, and reads a changed signature of an existing name as a new spelling.
A reason that describes a representation the compiler chose (the halves of an emulated value, a lowering intermediate, a mangled name) describes an internal name, whatever the id.

- Rationale: see Rule 2.2; a row is how a decision is recorded, not how a check is bypassed, and a new id is the cheapest bypass there is.
- Derives from: PR #166's body, section "A design rule this lane settled" ("the maintainer's decision is that they must not exist on the surface", written against an issue text that asked for an author spelling).
- Enforced by:
  - `surface-names.test.ts` (`no pre-emit intrinsic id is declared or listed`), which fails on a row for any id of `PRE_EMIT_INTRINSICS` but `f64`;
  - the same test (`the f64 family declares only the constructor forms WGSL gives the type it stands in for`), which fails on a signature of `f64` or of a `vecNf64` outside WGSL's constructor forms;
  - the review Rule 13.1 and `CLAUDE.md` require of every pull request that changes what an author can write, which alone catches a row under any other id, a row for a generated backend name, and a signature added to a name outside the f64 family;
  - that review, which reads the change for new authorable names and new signatures that are not WGSL's, applying the definition of §2.1 to what the name, or the signature, denotes.

## 10. Extensions and capabilities

### 10.1. Definition

A _capability_ (`Capability` in `src/core/ir/nodes.ts`) is a GPU feature a module's emit needs, by a neutral id.
A capability is _derived_ when the module's shape implies it (a storage binding, a `@compute` entry, a storage texture, a multisampled load, a 1d or cube-array texture, a gather, a `bgra8unorm` storage format, a packed 4x8 call: nine ids, which `enables` cannot name and `capabilityMatrix` reports `declarable: false`), and _declarable_ when only an explicit `enables` entry, or a `"enable <ext>"` directive for a WGSL extension (Rule 10.1), names it (`f16`, `subgroups`, the float render-target family, `multiview`).

### 10.2. Rules

**Rule 10.1.** A `"use typeshade"` file must not spell a WGSL `enable` or `requires` statement. A capability comes from the shape the file writes; an extension the shape cannot imply is turned on with a string directive beside `"use typeshade"`, `"enable <ext>"`, one WGSL extension name per directive, from the WGSL backend's capability profile. A built-in value that needs an extension derives it (`@builtin("clip_distances")` derives `enable clip_distances;`), and a `requires` directive is emitted by the compiler, never written.

- Rationale: the shape already says what the module needs, and a directive that says more than the shape uses can fail pipeline creation on a device that lacks the feature; the string directive covers the extensions no shape can imply, and names only what the writer can emit.
- Derives from: [Directives](https://gpuweb.github.io/gpuweb/wgsl/#directives), [Enable Extensions](https://gpuweb.github.io/gpuweb/wgsl/#enable-extensions-sec), [Language Extensions](https://gpuweb.github.io/gpuweb/wgsl/#language-extensions-sec); `src/compiler/ts/texture-wgsl-only.test.ts` ("the capability comes from the shape, never from enables"); surface §50. #168 changed this rule (closing #146), which had left no author spelling at all.
- Enforced by: `enable f16;` in a shader file is a parse error (`TS8030`); `"enable <ext>"` with a name outside the profile is `TS8050`, naming the profile; the derived and declared extensions are `src/compiler/ts/builtin-values.test.ts`.

**Rule 10.2.** The compiler must derive `requiredFeatures` from the module and must report them through `reflect()`, with every implied capability included.

- Rationale: a host activates features off `reflect()`, so the list must be the whole set and not the half the author named.
- Derives from: `requiredCaps` and `CAP_IMPLIES` in `src/core/passes/required-caps.ts`.
- Enforced by: `src/core/backends/extension-profile.test.ts` and `required-caps.test.ts`.

**Rule 10.3.** A GLSL ES 3.00 emit that lacks a capability's row must fail closed with the target sentence, which opens `backend 'glsl-es300' cannot emit this module` and ends `missing capabilities: <ids>`; on a module with a render entry that is a `TS8015` warning that leaves `wgsl` in place, and on a compute-only module it is silence, `glsl` being `undefined`.

- Rationale: GLSL is the second target of a module whose WGSL exists, so its shortfall must not unsay the compile, and a compute-only module has nothing GLSL ES 3.00 could serve.
- Derives from: `src/compiler/ts/compile.ts` (the comment above `emitGlslStages`); `docs/roadmap.md`, "make what does not compile, compile".
- Enforced by: `assertCaps`, whose throw `src/core/passes/required-caps.test.ts` asserts by type (`UnsupportedFeatureError`) and not by text; the sentence is asserted in `src/core/backends/glsl-compute.test.ts` and `glsl.test.ts` (`/missing capabilities:[\s\S]*compute/`); the warning on a render module and the silence on a compute-only one are `src/compiler/ts/compile.contract.test.ts` (Rule 12.3).

**Rule 10.4.** Every capability must have a witness: a module shape an author can write that uses the feature; a declarable capability with no witness is recorded as such and never advertised as usable.

- Rationale: a capability is a promise to an author, and a promise with nothing behind it fails pipeline creation for nothing.
- Derives from: `src/core/backends/capability-reachability.test.ts`.
- Enforced by: that test's witness table.

**Rule 10.5.** A GLSL lowering of a WGSL-only feature (the family #130 to #139: 1d, multisampled, depth read both ways, gather, cube array, storage texture, read-write storage, atomics, and barriers) is deferred by the maintainer, and must not be written until the deferral is lifted.
Until it is lifted, each of those features must fail closed on GLSL by Rule 10.3, and the deferral must be written where the refusal is.

- Rationale: the lowering family is one design (#130's fidelity classes) and is worked one item at a time when the maintainer says so.
- Derives from: the deferral recorded in #162, whose summary asks that the lowering family be worked one item at a time.
- Enforced by: review; `capability-reachability.test.ts` records which target each capability has a row for.

## 11. Targets and the oracle

### 11.1. Definition

A _target_ is a language the compiler emits, with the compiler that reads it: WGSL for WebGPU, read by Tint, and GLSL ES 3.00 for WebGL2, read by a driver.
The _oracle_ is the CPU evaluation of the IR (§1.6), a reference and not a fourth backend.
A _target divergence_ is a difference between two targets, or between a target and the oracle, on one program (Rule 11.2).
An _emit golden_ is a recorded emitted module under `examples/__emit-goldens__/` that a test compares byte for byte.

### 11.2. Rules

**Rule 11.1.** There must be one IR, and the WGSL writer, the GLSL ES 3.00 writer, and the CPU oracle must consume it over one shared tree walk; a new emit feature must go into the shared walk, or the oracle and the GLSL writer drift.

- Rationale: three backends over one walk is what makes the oracle a reference and not a fourth implementation.
- Derives from: `AGENTS.md` ("one IR, three backends, one tree walk").
- Enforced by: `src/core/oracle-backend-parity.test.ts` and `examples/glsl-stages-parity.test.ts`.

**Rule 11.2.** A divergence between targets, or between a target and the oracle, must be measured on Tint and on a WebGL2 driver before it is kept, and recorded where the emit is decided: a comment on the `INTRINSICS` row with the measured text, and a row of the determinism report (surface §38) where the results may differ.

- Rationale: the specification text says what a compiler may do; the compiler says what it does, and the emitted text has to satisfy the compiler.
- Derives from: #162 ("measure before you keep a design"); surface §31 (a ternary on a struct, where the ES 3.00 text and the driver disagreed); [Floating Point Accuracy](https://gpuweb.github.io/gpuweb/wgsl/#floating-point-accuracy).
- Enforced by: the compile gate for the emitted text; `src/core/passes/determinism.test.ts`, which requires every emitted operation to be placed in one column of the accuracy table.

**Rule 11.3.** Every registered example must compile on Tint and, where the module has a GLSL row for each capability it needs, on a WebGL2 driver; an example that is WGSL-only says so with `renderable: false` and a stated reason.

- Rationale: an instrument that cannot fail cannot pass, which is why the gate feeds each compiler a broken shader first.
- Derives from: `scripts/compile-gate.ts`; `AGENTS.md`.
- Enforced by: `bun run gate:compile`, run in CI.

**Rule 11.4.** An emit golden is a reviewed artifact: a change to `examples/__emit-goldens__/` must be read as a diff and must not be re-baked as a rubber stamp.

- Rationale: a byte-identical change is what the goldens gate, and a semantic change must also pass the oracle parity gate and the compile gate.
- Derives from: `AGENTS.md` ("emit changes come in two kinds").
- Enforced by: `examples/emit-goldens.test.ts` and `examples/shade-examples.test.ts`; the review is a person's.

**Rule 11.5.** Where WGSL fixes a result and GLSL ES 3.00 does not, the oracle must follow WGSL; where a GLSL spelling answers differently on an input WGSL settles, the determinism report must list the operation as `target`.

- Rationale: see Rule 1.3.
- Derives from: surface §38 ("the two targets").
- Enforced by: `src/core/passes/determinism.ts` and its test.

**Rule 11.6.** The public API surface (`src/__api__/surface.md`) is generated and must not be edited by hand; an exported name or type may change only with a re-bake.

- Rationale: 1.0 is a promise about that file.
- Derives from: `docs/roadmap.md` 0.8 item 24.
- Enforced by: `src/api-surface.test.ts`.

**Rule 11.7.** The CPU tier, which runs a host call of a module's function, is the oracle's generated code (`generateModuleJs`) at `f32` precision, written into the module the bundler reads as module code, with no `new Function`, over the runtime alone.

- Rationale: a host call computes what the GPU would, so it rounds as `f32` does, which the default `f64` algebra oracle is blind to by construction.
  The generated code calls the same runtime helpers the interpreter calls, so the tier is the oracle and not a fourth implementation (Rule 11.1).
  Building it with `new Function` at run time would need `unsafe-eval`, which a strict content security policy forbids, and would ship the IR and the generator; as module code it is minified with the application, and the application ships the op library only.
- Derives from: change `0009` in `changes/` ("The CPU tier's precision"); `src/core/oracle.ts` (the `'f32'` mode, "a correctly-rounding f32 machine over the same IR"); Rule 11.1.
- Enforced by: `hostFace` in `src/compiler/ts/host-face.ts`, which generates at `precision: 'f32'`, and `src/core/host-runtime.ts`, what a generated module imports; pinned by `src/compiler/ts/host-face.test.ts`, where every call equals `compileModule(m, { precision: 'f32' })` on inputs chosen so the `f32` and `f64` answers part, and the generated module holds no `new Function`.

## 12. Diagnostics

### 12.1. Definition

A _diagnostic_ is one message the compiler reports for the author's benefit, with a code, a category (`error` or `warning`), and a source span.

### 12.2. Rules

**Rule 12.1.** A diagnostic must name the offending thing and the remedy in at most two sentences: the first states the mistake, and the second, when there is one, states the remedy or the reason.
For a name the compiler cannot find (a value, a callee, a type, a field, a member, an assignment target, an attribute, a `@builtin` id, an extension, an import), the remedy is chosen in one order at every place a name is written: TypeShade's spelling of a GLSL or HLSL name; else the name of the same kind that exists at that place and is spelled like it, by TypeScript's own spelling rule with a swap of two adjacent letters counted as one edit ("Did you mean "clamp"?"); else the place's own remedy. The span is the name itself.

- Rationale: an author reads it against the line they wrote, and a third sentence is where the remedy gets lost.
- Derives from: [Diagnostics](https://gpuweb.github.io/gpuweb/wgsl/#diagnostics); surface §7 and §28 ("one mistake reads as one sentence"); the pinned sentences of the refusal tests under `src/compiler/ts/` (`TS8031 Recursive call: "a" -> "b" -> "a". WGSL has no call stack, so a function must not take part in a call cycle.`), which have that shape.
- Enforced by: every refusal test asserts the code and the message text (Rule 12.5). A GLSL or HLSL name the compiler refuses names TypeShade's spelling as its remedy rather than "declare it in this file" (`lerp` is `mix`, `gl_FragCoord` a `@builtin("position")` parameter), from `FOREIGN_NAMES` in `src/compiler/ts/foreign-names.ts`, in `src/compiler/ts/foreign-names.test.ts` (#218); no name is added (Rules 2.1 and 9.6), and the table's targets are checked against the ambient library (Rule 12.7). The order for an unknown name is `unknownNameRemedy` in `src/compiler/ts/unknown-names.ts`, pinned at each place a name is written by `src/compiler/ts/unknown-names.test.ts`; that the compiler names every name TypeScript would suggest for a misspelling is `src/language-service/editor-parity.test.ts`.

**Rule 12.2.** A code must be `TS8` followed by a sequential number in the order codes were added, or a number from a block handed to a parallel branch (Rule 3.7), whose unused numbers stay a gap.
`TS8099` is the catch-all for a site that does not yet deserve its own code, and a refusal that has a reason must leave it.

- Rationale: a stable code is what a test, an issue, and a language service filter key on.
- Derives from: the head comment of `src/compiler/ts/codes.ts`; surface §28 (roadmap 0.3 item T10, "in place of `TS8099 Unsupported expression`").
- Enforced by: review against Rule 3.7.

**Rule 12.3.** Severity must follow the target's role: a program WGSL refuses must be an error; a shortfall of GLSL ES 3.00 on a module with a render entry must be a warning that leaves `wgsl` in place; a compute-only module's GLSL shortfall must be no diagnostic at all.

- Rationale: an error would unsay a compile that succeeded, and a warning on a module GLSL could never serve is not news.
- Derives from: `src/compiler/ts/compile.ts`; PR #165's decision 1.
- Enforced by:
  - `src/compiler/ts/compile.contract.test.ts` (`keeps the wgsl of a render+compute module when only the GLSL backend cannot emit it` and `keeps the wgsl of a vertex+fragment module whose binding the GLSL backend cannot spell`), each asserting one `TS8015` warning;
  - the same file (`yields wgsl but no glsl and no warning for a compute-only module`);
  - `src/compiler/ts/reserved-names.test.ts` (`reports a struct field named half, on the field`), which asserts one `TS8068` warning, `wgsl` carrying `half` and `glsl` undefined, and is a fourth pin of the same shape.

**Rule 12.4.** One mistake reads as one diagnostic; a refusal must not be followed by further diagnostics about the same mistake.

- Rationale: a cascade hides the sentence that says what to do.
- Derives from: surface §28 ("and one mistake reads as one sentence").
- Enforced by: `honest-refusals.test.ts` (`one mistake reads as one sentence`), for the surface §28 shapes, and (`a refused declaration is the one diagnostic for its name`), for a refused declaration: a read of the name, an assignment to it or a write through it reports nothing more when an error stands inside the declaration the name resolves to or inside a declaration that one reads (`a local declared from a refused one`), while a name read out of its scope, read before its declaration or declared nowhere still reports `TS8022` (`src/compiler/ts/refused-names.ts`, #171); and, across the language service's two halves, `mergeDiagnostics` (`src/language-service/diagnostics.ts`), which keeps the compiler's diagnostic where TypeScript and the compiler report one mistake, with no exception (a misspelled name included, since the compiler names the fix itself under Rule 12.1), and drops TypeScript's knock-on of a value it could not type itself (a call it failed to resolve, a name or a member it cannot find), reached directly, through a local declared with no type or through an operation, in `src/language-service/diagnostics.test.ts` (`one mistake reads as one diagnostic across the two halves`, among it a comparison of vectors of two sizes, the uses of a local whose product the compiler refused, a value from an unknown function used in an operation, and a return of the wrong type, which the compiler reports on the `return`, where TypeScript does).

**Rule 12.5.** The message text is part of the contract: a test that pins a refusal must assert the code and the text, and a change to the text is a change to the surface.

- Rationale: an issue's "Expected" row spells the sentence, and the sentence is what the author sees.
- Derives from: the refusal tests under `src/compiler/ts/`, which pin the text, and the "Expected" section of each issue of #162, which spells it.
- Enforced by: the refusal tests under `src/compiler/ts/`.

**Rule 12.6.** A requirement the front end can check must be checked at the front end, in the author's words, and not left to Tint or a driver.

- Rationale: WGSL checks each requirement at the earliest opportunity, and for TypeShade the earliest opportunity is the source line.
- Derives from: [Errors](https://gpuweb.github.io/gpuweb/wgsl/#errors) ("each requirement will be checked at the earliest opportunity"); surface §3 and §7.
- Enforced by: `TS8029`, `TS8031`, `TS8036`, `TS8038`, `TS8068`, and the rest of the front-end codes, among them `TS8002` for a type the file declares nowhere, which used to be emitted as a struct of that name for Tint to refuse (`src/compiler/ts/unknown-names.test.ts`); the debts of Appendix B are the requirements not yet moved forward.

**Rule 12.7.** The language service and the compiler must name one vocabulary: the ambient library's declarations are derived from the compiler's own tables and never retyped, and a program the compiler accepts must draw no error in the editor or in `typeshade check`.

- Rationale: an editor that accepts what the compiler refuses, or the reverse, is a second surface.
- Derives from: the head of `src/language-service/ambient.ts`; #157 for the remaining gaps.
- Enforced by: `src/language-service/ambient.test.ts` (among it `accepts an unsigned coordinate on textureLoad and textureStore`, the `vec2u` coordinate WGSL and the compiler take, and every example with no diagnostic) and `surface-names.test.ts`; `src/language-service/editor-parity.test.ts`, over every swizzle of every vector type and the vector index; `src/language-service/diagnostics.test.ts` (`an operation other than arithmetic loses a vector type the same way`) and `src/language-service/projection.test.ts`, over every operator TypeScript types as a `number` or a `boolean` (the `ERASING_OPERATORS` table the projection and the diagnostics filters share), used in place and through a local; `src/compiler/ts/doc-snippets.test.ts`, which checks each documentation snippet in the editor as well as in the compiler.

## 13. Change control

### 13.1. Definition

A _change to the surface_ is a change to what an author can write: a name, a type, a spelling, a diagnostic's text, or a refusal.
A _hot-spot file_ is a file two branches are likely to edit at once, listed under Rule 13.5.
A _gate_ is a command CI runs that fails the change when the change breaks it, and a _claim_ is a `§` number, a `TS80xx` code, or an `INTRINSICS` row taken in an issue before a branch is opened.

### 13.2. Rules

**Rule 13.1.** An issue or pull request that changes what an author can write must cite the rule of this document it rests on.

- Rationale: a change with no rule behind it is the shape the `f64FromParts` case took.
- Derives from: `CLAUDE.md` (the citation rule) and §1.1 of this document.
- Enforced by: review; `CLAUDE.md` states the rule for a Claude Code session.

**Rule 13.2.** A change the rules do not cover must change the rules first: the rule is written or amended in this document, in the same pull request, before the surface moves.

- Rationale: this document is only normative while it is ahead of the tree.
- Derives from: `CLAUDE.md` ("a change the rules do not cover changes the rules first").
- Enforced by: review.

**Rule 13.3.** A design that a target might refuse must be measured on Tint, on a WebGL2 driver, or on a device before it is kept, and the measured text must be recorded in the plan and in the code comment.

- Rationale: see Rule 11.2.
- Derives from: #162 ("measure before you keep a design").
- Enforced by: the compile gate; review of the recorded text.

**Rule 13.4.** Every change must pass the mechanical gates: `bun run build`; `bun run test`, with `surface-names.test.ts`, `intrinsic-coverage.test.ts`, `capability-reachability.test.ts`, `determinism.test.ts`, `api-surface.test.ts`, `emit-reflection-conformance.test.ts`, and the emit goldens among them; `bun run gate:compile`; the docs snippet test `src/compiler/ts/doc-snippets.test.ts`, which compiles every snippet of the surface document.

- Rationale: a rule with a gate is enforced; a rule without one is Appendix B.
- Derives from: `AGENTS.md` and `.github/workflows/ci.yml`.
- Enforced by: CI (`.github/workflows/ci.yml`).

**Rule 13.5.** A hot-spot file must be edited only after reading what the branch already did to it, and a claim of a `§` number, a `TS80xx` code, or an `INTRINSICS` row must be made in the issue before the branch is opened.

- Rationale: two branches editing one of these at once conflict on merge, and two claims of one number conflict forever.
- Derives from: #162 ("hot-spot files" and "claim before you write"); the list is `src/core/intrinsics.ts` (append-only), `src/language-service/ambient.ts` and `docs.ts`, `src/core/ir/types.ts` and `nodes.ts`, `src/compiler/ts/lower/expression-call.ts` and `function.ts`, `src/core/backends/wgsl.ts` and `glsl.ts`, `src/core/passes/required-caps.ts` and the capability witness table, `src/core/intrinsic-coverage.test.ts`, `docs/use-typeshade-surface.md` § numbering, `CHANGELOG.md`, `examples/_shade.ts`, `docs/roadmap.md`.
- Enforced by: review.

**Rule 13.6.** A new author-facing name must be added only by its source: a WGSL name by citing the specification section that declares it, and an ECMAScript name by citing the `Math` or `console` member it is.
A TypeShade extension, including a new type of the f64 family, must be added by Rule 9.7, with the rationale in §9 and, for the f64 family, in Rule 4.4.

- Rationale: see Rule 2.1.
- Derives from: the comment above `TYPESHADE_EXTENSIONS` in `surface-names.test.ts`, which names §9 and this section.
- Enforced by: `surface-names.test.ts`.

**Rule 13.7.** The extension table must shrink when WGSL grows a builtin or a type a row was standing in for, or when a spelling is withdrawn; the row must be deleted, the surface document must say so, and the CHANGELOG must record it.

- Rationale: a row WGSL now covers is stale, and the test says so.
- Derives from: `surface-names.test.ts` (`no row keeps a name WGSL or ECMAScript now covers`).
- Enforced by: that test.

**Rule 13.8.** Every change to the surface must carry a CHANGELOG entry under `[Unreleased]` in the house style (a bold lead naming the feature and the § or roadmap item, then what an author can now write, what each target emits, what is refused and how, and what was measured) and a surface `§` whose snippets compile.

- Rationale: the CHANGELOG is where the reasons live between releases, and the snippet test is what keeps the surface document true.
- Derives from: the `[Unreleased]` entries of `CHANGELOG.md`, whose shape the rule describes; `docs/use-typeshade-surface.md` §8 ("a target example stays labelled _(target)_").
- Enforced by: `doc-snippets.test.ts`; review for the CHANGELOG.

**Rule 13.9.** A published version must follow Semantic Versioning 2.0.0, and before `1.0.0` the minor is the breaking position: a breaking change must ship only in a new `0.N.0`, and a `0.N.P` must only fix and add. From `1.0.0`, a breaking change must ship only in a new major.
A change is _breaking_ when an upgrade can make a program that worked stop working or work differently: `compile()` or the language service refuses a program it accepted, a program that compiled computes a different value on a target or on the CPU oracle, an export listed in `src/__api__/surface.md` is removed or reshaped so that a caller's code no longer type-checks, or the `typescript` peer range narrows.
A change is not breaking when the emitted text moves and the values it computes do not, when a warning is added, when a program is newly refused that Tint or WebGL2 already refused (Rule 12.6), or when a target or the oracle is fixed to compute what WGSL defines; that last is recorded under `### Fixed` with the old result named.
Every breaking change must carry a `CHANGELOG.md` entry that names the edit an author makes to migrate.

- Rationale: npm's caret range reads a `0.x` version as `>=0.N.0 <0.(N+1).0`, so a break in a patch reaches every `^0.N.0` user unasked; and semver alone does not say what "breaking" means for a compiler whose output text changes far more often than its meaning.
- Derives from: roadmap item 25 (`docs/roadmap.md`), decided by the maintainer on 2026-09-24 in `changes/0010-versions-and-deprecation-window.md`.
- Enforced by: `src/changelog.test.ts` (the version headings of `CHANGELOG.md` and the minor bump of a release that breaks); review for what counts as breaking.

**Rule 13.10.** A change that keeps a program compiling and makes it compute something else must ship in two steps, and the second must come no earlier than the next breaking release after the first step's release was published (the next minor before `1.0.0`, the next major after it).
First, a published release must report every affected line as a `category: 'warning'` diagnostic behind the opt-in deprecation option (`compile(src, { deprecations: true })`, `typeshade check --deprecations`), naming the edit that keeps today's meaning, with no emitted byte moved with the option on or off.
Then the default changes, the warning and its code are retired, a `### Changed` entry names the old meaning, the new one and the one-line edit that keeps the old, and every example golden is re-baked and reviewed.
The window is counted in published releases. From `1.0.0`, a spelling or an export that will be removed must get the same window: the spelling warns under the same option, and the export carries `@deprecated` in its JSDoc naming its replacement.

- Rationale: a program that stops compiling says so, with its fix (Rule 12.1); a program that computes something else says nothing, and a shader is where a silent change is hardest to see. A warning that never reached npm warned nobody.
- Derives from: `RELEASING.md#7-versions-and-deprecations`; `changes/0010-versions-and-deprecation-window.md`; #148, the first change to take the window.
- Enforced by: `src/compiler/ts/integer-literal-deprecation.test.ts` (the first step for #148: the warning under the option, no emitted byte moved); review for the timing of the second step.

## 14. Open decisions

A decision listed here is not made; the "what holds today" column is the behaviour of this tree, and it stands until the maintainer decides.
Two decisions the first draft listed were made by PR #166 and are rules now: a two-row matrix in a uniform block is refused with the remedy (#149, Rule 4.8), and an `f64` across a stage boundary is refused with `f32(x)` while a scalar `f64` vertex attribute is admitted (#151, Rule 2.3).
Two more were made by #203 and are Rule 7.5 now: the loop trip ceiling is removed, and a `while` is an open loop whose progress is left to the author.

| Decision                                                                                                                                                                               | Issue                                  | What holds today                                                                                             | Who decides                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Default type of an integer-written literal in an undeclared position: decided `i32` (WGSL), flipped under Rule 13.10 no earlier than `0.2.0`, after `0.1.0` ships the `TS8053` warning | #148                                   | `let i = 0` is `var i: f32 = 0.0;` (Rule 5.1); `compile(src, { deprecations: true })` reports `TS8053` on it | decided by the maintainer; the row leaves when the flip lands |
| `read_write` storage-texture formats beyond `r32uint`, `r32sint`, `r32float`: a host-feature capability, or refuse                                                                     | #147                                   | `ReadWriteStorageFormat` is the three formats a device accepted when measured (surface §33)                  | measured on a device, then the maintainer                     |
| Whether `frexp` and `modf`, which return a struct on WGSL, get the implicit result struct GLSL needs                                                                                   | roadmap 0.2 item 8 note; #162 (G1, G2) | neither is authorable                                                                                        | the maintainer                                                |
| Subgroup operations, pointers and reference parameters, `f16`, reverse-mode `grad`                                                                                                     | `docs/roadmap.md` After 1.0            | none is authorable                                                                                           | the roadmap, after 1.0                                        |

## Appendix A: TypeShade spelling and WGSL type

Every row is a spelling the compiler accepts on this tree (`SUPPORTED_TYPE_NAMES`, plus the wrapper and attribute forms of §6).

| TypeShade spelling                                                                                                                                 | WGSL type                                                        | Source                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `f32`, `i32`, `u32`, `bool`                                                                                                                        | `f32`, `i32`, `u32`, `bool`                                      | WGSL [Scalar Types](https://gpuweb.github.io/gpuweb/wgsl/#scalar-types)                                                   |
| `vec2`, `vec3`, `vec4`                                                                                                                             | `vec2<f32>`, `vec3<f32>`, `vec4<f32>`                            | WGSL [Vector Types](https://gpuweb.github.io/gpuweb/wgsl/#vector-types) (the type-generator, defaulted to `f32`)          |
| `vec2f`, `vec3f`, `vec4f`                                                                                                                          | `vec2f`, `vec3f`, `vec4f`                                        | WGSL predeclared aliases                                                                                                  |
| `vec2i`, `vec3i`, `vec4i`                                                                                                                          | `vec2i`, `vec3i`, `vec4i`                                        | WGSL predeclared aliases                                                                                                  |
| `vec2u`, `vec3u`, `vec4u`                                                                                                                          | `vec2u`, `vec3u`, `vec4u`                                        | WGSL predeclared aliases                                                                                                  |
| `vec2b`, `vec3b`, `vec4b`                                                                                                                          | `vec2<bool>`, `vec3<bool>`, `vec4<bool>`                         | TypeShade (§9.3, family 3)                                                                                                |
| `mat2x2`, `mat2x3`, `mat2x4`, `mat3x2`, `mat3x3`, `mat3x4`, `mat4x2`, `mat4x3`, `mat4x4`, and each one's `matCxRf` alias (`mat4x4f`)               | `matCxR<f32>`; a two-row shape is refused in a uniform block     | WGSL [Matrix Types](https://gpuweb.github.io/gpuweb/wgsl/#matrix-types) (Rule 4.8)                                        |
| `mat2`, `mat3`, `mat4`                                                                                                                             | `mat2x2<f32>`, `mat3x3<f32>`, `mat4x4<f32>`                      | TypeShade (family 4)                                                                                                      |
| `mat2<f64>`, `mat3<f64>`, `mat4<f64>`                                                                                                              | none; a pair of `f32` per component; `*` and `transpose` only    | TypeShade (family 1, Rule 4.4); the non-square `matCxR<f64>` is refused (`TS8027`)                                        |
| `array<T, N>`, `[T, T]` (a tuple of one type)                                                                                                      | `array<T, N>`                                                    | WGSL [Array Types](https://gpuweb.github.io/gpuweb/wgsl/#array-types); the tuple spelling is surface §28                  |
| `array<T>` in a storage binding                                                                                                                    | `array<T>`, runtime-sized                                        | WGSL [Array Types](https://gpuweb.github.io/gpuweb/wgsl/#array-types)                                                     |
| `class`, `interface`, `type X = { … }`                                                                                                             | `struct`                                                         | WGSL [Structure Types](https://gpuweb.github.io/gpuweb/wgsl/#struct-types); the three spellings are ECMAScript/TypeScript |
| `atomic<u32>`, `atomic<i32>`                                                                                                                       | `atomic<u32>`, `atomic<i32>`                                     | WGSL [Atomic Types](https://gpuweb.github.io/gpuweb/wgsl/#atomic-types)                                                   |
| `uniform<T>`, `storage<T>`, `storage<T, "read_write">` on a `declare const`                                                                        | `var<uniform>`, `var<storage, read>`, `var<storage, read_write>` | TypeShade (family 2); the address spaces and the two access words are WGSL's                                              |
| a top-level `let`, `workgroup<T>` on a top-level `let`                                                                                             | `var<private>`, `var<workgroup>`                                 | TypeShade (family 2); the private space has no spelling of its own (Rule 6.5)                                             |
| `override<T>`                                                                                                                                      | `override`                                                       | TypeShade (family 2)                                                                                                      |
| `texture_1d<T>`, `texture_2d<T>`, `texture_2d_array<T>`, `texture_3d<T>`, `texture_cube<T>`, `texture_cube_array<T>`, `texture_multisampled_2d<T>` | the same names                                                   | WGSL [Texture and Sampler Types](https://gpuweb.github.io/gpuweb/wgsl/#texture-sampler-types)                             |
| `texture_depth_2d`, `texture_depth_2d_array`, `texture_depth_cube`, `texture_depth_cube_array`, `texture_depth_multisampled_2d`                    | the same names                                                   | WGSL, the same section                                                                                                    |
| `texture_storage_2d<F, A>`, `texture_storage_2d_array<F, A>` with `F` and `A` as string literal types                                              | `texture_storage_2d<F, A>` with `F` and `A` as enumerants        | WGSL, the same section; `StorageFormat` and `StorageAccess` are TypeShade (family 6)                                      |
| `sampler`, `sampler_comparison`                                                                                                                    | `sampler`, `sampler_comparison`                                  | WGSL, the same section                                                                                                    |
| `f64`, `vec2f64`/`vec2d`, `vec3f64`/`vec3d`, `vec4f64`/`vec4d`                                                                                     | none; a pair of `f32` per component on every GPU target          | TypeShade (family 1, Rule 4.4)                                                                                            |
| `type Meters = f32`                                                                                                                                | an alias of `f32`                                                | WGSL [Type Aliases](https://gpuweb.github.io/gpuweb/wgsl/#type-aliases)                                                   |
| `f32 & { readonly [m]: 'm' }`                                                                                                                      | `f32` (the brand is erased)                                      | surface §28                                                                                                               |

Not spelled on this tree: `f16` and the `h` aliases (Rule 4.7), `ptr` (Rule 8.8), `texture_external`, the 1d and 3d storage textures (#162, scheduled by the roadmap).

## Appendix B: rules the current tree does not yet enforce

| Rule                | What is not enforced                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Issue                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Rule 2.3, Rule 12.1 | an `f64` passed, returned or assigned where an `f32` is declared is refused with a `TS8003` that names no remedy (`Argument 1 of "g" type mismatch.`); the entry I/O case has its sentence (`TS8038`), this one does not name `f32(x)`                                                                                                                                                                                                                                                                                                           | no issue names this sentence yet (#151 closed the entry I/O half)                                    |
| Rule 3.2            | `$` in a name is emitted as written (`var $a: f32` reaches Tint); `_` and a `__` prefix are `TS8068`                                                                                                                                                                                                                                                                                                                                                                                                                                             | `reportReservedNames` is the check that would take it (`wgslRefusal`); no issue names this shape yet |
| Rule 6.2            | two writes to a read-only storage binding are refused by the compiler alone, and the editor is silent about both: `atomicAdd(bins[0], 1)` on a `storage<array<atomic<u32>>>` (an `atomic<T>` is one symbol-keyed brand, so its read view is the type itself, and an atomic is written through a CALL, where no `readonly` modifier is involved) and a mutating method on a class-typed read binding, `acc.add(1.)` (the view stops at the method boundary, because the method is declared once and shared by read and read_write bindings alike) | no issue names this shape yet (surface §49 records both)                                             |
| Rule 6.6            | an entry parameter with neither `@builtin` nor `@location` passes the front end and reaches the WGSL text, which WGSL refuses; only the GLSL writer reports it, as a `TS8015` warning, and a compute-only module gets no diagnostic                                                                                                                                                                                                                                                                                                              | surface §3 (no issue names this shape yet)                                                           |
| Rule 7.5            | a `while` body is not checked to move toward an exit, since an open loop is the author's to end, as in WGSL; a `for` with a runtime bound is not checked to reach it before the induction variable leaves its type (`i <= n` with `n` at the type's maximum, `i += 4` within 4 of it, `i /= 2` toward a negative `i32` bound, `i *= 2` from a runtime start of 0); a bound written by a function the body calls, and not by the body itself, is not seen                                                                                         | [#203](https://github.com/typeshade/typeshade/issues/203)                                            |
| Rule 7.6            | a read of a local before its first assignment gets no diagnostic; it is zero on WGSL and on the CPU and undefined on GLSL ES 3.00                                                                                                                                                                                                                                                                                                                                                                                                                | surface §14 (no issue)                                                                               |
| Rule 9.5            | a declared function named after a GLSL ES 3.00 builtin function (`exp2`) is not warned about, and hands the author a WGSL-only module; a keyword or type name (`bool`) is renamed by the GLSL writer, whose rename #103 widened to every module-scope name                                                                                                                                                                                                                                                                                       | surface §10 (no issue)                                                                               |
| Rule 9.7            | eleven §9.3 rows record names that were already on the surface when the row was written — the six `Math` constants under a free spelling, and `log10`, `log1p`, `expm1`, `cbrt` and `hypot` — and no `§` of `docs/use-typeshade-surface.md` names any of them, nor `TAU`; `random`, recorded with them, is the one that got its section (§55)                                                                                                                                                                                                    | no issue names the eleven yet (#181 covers `random`)                                                 |
| Rule 12.6           | `random(seed)` is documented as one value per seed and the emitted `fract(sin(h) * 43758.5453123)` does not keep it: WGSL bounds `sin` to 2⁻¹¹ absolute error on [-π, π] and does not bound it outside that range, so the value is the driver's — perturbing `sin` by 2⁻¹¹ moves seed 0.5 from 0.9642 to 0.3306 and seed 12.0 from 0.3497 to 0.7161, and the emitted expression parts from the f64 oracle by up to 0.8078 on a [0, 1) range; no diagnostic says so (§55)                                                                         | #181                                                                                                 |
| Rule 12.7           | the ambient library is narrower than the compiler: a WHOLE-binding write (`s = 1.` on a `storage<f32, "read_write">`) is `TS2588` in the editor, because a binding is `declare const` (Rule 6.1) and no value type can make a `const` assignable, while the compiler emits it                                                                                                                                                                                                                                                                    | surface §49 records it                                                                               |

Each row is removed when its issue lands and the rule's "Enforced by" line names the test.
