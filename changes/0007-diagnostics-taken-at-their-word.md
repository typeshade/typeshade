---
id: '0007'
title: A mistake reads as one diagnostic that names its fix, a program that compiles draws no editor error, and a case body cannot fall through
status: implemented
rules:
- '7.3'
- '7.7'
- '9.6'
- '12.1'
- '12.4'
- '12.6'
- '12.7'
surface:
- 7
- 10
- 14
- 28
- 49
- 52
exports:
- CheckDiagnostic
- CheckDocument
- checkDocuments
- checkOpenDocument
- CheckOptions
- CheckReport
- FOREIGN_NAMES
- ForeignName
- foreignNameRemedy
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: The constructs page's switch row and the statements.switch copy, which say a case body does not fall through; one that would is refused now (TS8017)
- repo: vscode-typeshade
  what: The skill's claim that a failed declaration makes later uses TS8022, its TS8017 row and switch advice, design.md's TS2304-and-TS8004 note, and the MCP server's own FOREIGN_NAMES copy and check path
---

<!-- doc-refs: skip-file — a proposal names the files its implementation adds, and files of the repositories downstream, which this tree does not have -->

## What changes

Recorded after the implementation, as `0001` was. #210 was written before proposals existed
(#221). It cannot merge until it can name an accepted proposal, so it names this one.

1. **One mistake reads as one diagnostic** (Rule 12.4). The editor and `typeshade check` merge
   TypeScript's report and the compiler's into one list. Where both report one mistake, the
   compiler's report is kept, with no exception. Before, `y = 2.` on a `const` read as TS2588
   and TS8005. A refused declaration's name says nothing more where it is used. That includes a
   name declared from a refused one: after a refused `const t = a * b`, `return u` from
   `const u = t * 2.` was `Unknown identifier "u"`.
2. **The diagnostic names its fix** (Rule 12.1). Every unknown name has one remedy order:
   - a GLSL or HLSL name gets TypeShade's spelling (`lerp` is `mix`, #218);
   - otherwise, a name of the same kind spelled like it, by TypeScript's own spelling rule;
   - otherwise, the general remedy.

   The span is the name itself. TypeScript's "Did you mean" has nothing left to add, so the
   compiler's sentence is the one the editor and the build both show.

3. **A program the compiler accepts draws no error in the editor or in `typeshade check`**
   (Rule 12.7). Each of these compiled and still drew an editor error:
   - a swizzle beyond the component names, such as `v.yx` or `c.bgra`;
   - the vector index `v[i]`;
   - a class's field literal, `let r: Rng = { state: 1 }`;
   - a local declared from vector arithmetic;
   - a comparison, a bitwise or shift operator, `**`, `~` or `!` on a vector.
4. **A type declared nowhere is refused at the front end** (Rule 12.6). `v: Foo` was emitted as
   a struct `Foo` for Tint to refuse. It is `TS8002` now, and names the type it is spelled like.
5. **`discard()` names its fix** (Rule 7.7): write `discard;`, since it is a statement.
6. **A case body that falls through is refused** (Rule 7.3, #202). Before, it was a silent
   miscompile: `case 0: x = 1.` above `case 1: x += 2.; break` gave 3 in TypeScript and 1 on the
   GPU. It is `TS8017` at the label, with the two remedies.
7. **Four type helpers leave the ambient library** (Rule 9.6): `VecOf`, `ScalarOf`,
   `ComponentKeys` and `Vec64`. Each vector is a concrete interface now, and §9.3's
   extension table shrinks by those four rows.
8. **`typeshade check`**, and the check and the foreign-name table exported from
   `typeshade/language-service`, so the MCP server stops keeping copies.

## Why

A person skims past a noisy line. A coding agent acts on every diagnostic it sees: it "fixes" a
false positive, repeats a fix for a cascade, and trusts a clean compile. In a 10-task agent
pilot on `main`:

- 7 tasks met TypeScript false positives on correct code.
- 3 rewrote vector maths per component only to satisfy the checker.
- 1 hid two real mistakes behind a cascade.
- 1 compiled a fall-through to a different value than TypeScript's, with no diagnostic.
- Every port from GLSL or HLSL wrote foreign names, and the refusal said "declare it in this
  file".

Alternatives considered:

- **Keep TypeScript's "Did you mean" beside the compiler's report.** Rejected. The editor would
  then show a sentence the build does not print, and for `fmod` it suggests `mod`, which floors
  where `fmod` truncates.
- **Warn on fall-through instead of refusing it.** Rejected. The program runs differently on
  the GPU than in TypeScript, so a warning would let a silent miscompile through.
- **Write the swizzles as one mapped template-literal type.** Rejected. It doubled the check
  time over the examples. Concrete interfaces cost nothing measurable: 3.1 s against 3.2 s.
- **Restore a local's vector type in the diagnostics filter**, by reading the compiler's type
  for the name. Rejected for #217's projection, which writes the type into the text TypeScript
  reads. That fixes hover and completion too. The filters read one operator table with it.

## What it touches

- **Rule 7.3** now reads "into the body of a case below it". Its Appendix B row is removed.
- **Rule 7.7**'s Enforced-by names the `discard()` refusal.
- **Rule 9.6**: §9.3's table loses the four helper rows.
- **Rule 12.1** gains the remedy-order sentence.
- **Rule 12.4**'s Enforced-by names three things: the refusal of a declaration read from a
  refused one, the exception-free merge, and TypeScript's knock-ons.
- **Rule 12.6**'s Enforced-by names `TS8002` for a type declared nowhere.
- **Rule 12.7**'s Enforced-by names the parity tests and the operator table.
- **Surface §7** gains the row for a name the file does not declare.
- **Surface §10**: `discard()`.
- **Surface §14**: fall-through.
- **Surface §28**: a refused local says nothing more.
- **Surface §49**, only if #237 lands first. #237 records there that the editor refuses a
  swizzle beyond the prefixes and names #210 as the fix. This change declares every swizzle, so
  that section goes, with the closed-row count. If this change lands first, #237 leaves the
  section out instead, and §49 stays as it is.
- **Surface §52**: the note that points at §14.
- **Exports**, all on `typeshade/language-service`:
  - `checkDocuments`, `checkOpenDocument`, and their types `CheckDocument`, `CheckOptions`,
    `CheckDiagnostic` and `CheckReport`: the check `typeshade check` runs;
  - `FOREIGN_NAMES`, `ForeignName` and `foreignNameRemedy`: the table the refusals read.
- **Codes and examples**: none added, removed or renumbered. The sentences of `TS8002`,
  `TS8004`, `TS8017` and `TS8022` grow.

The tests that pin the new behaviour:

- **Compiler**: `src/compiler/ts/unknown-names.test.ts`, `foreign-names.test.ts`,
  `honest-refusals.test.ts` (#171 and the read-from-refused case), `switch-array.test.ts` and
  `operators-statements.test.ts` (fall-through).
- **Language service**: `src/language-service/editor-parity.test.ts` (every swizzle, the index,
  misspelling parity with TypeScript), `diagnostics.test.ts` (the merge and the operator table),
  `projection.test.ts` and `check.test.ts`.
- **Documentation**: `src/compiler/ts/doc-snippets.test.ts` checks each snippet in the editor
  too.

## What it owes downstream

- **typeshade.github.io**:
  - `src/i18n/en.ts` says a case body does not fall through, in `switchRow` ("a body does not
    fall through") and in `statements.switch` ("No case falls through"). One that would is now
    refused, `TS8017`, and each case ends with `break`.
  - The error-code pages compile their programs at the pin, so the new sentences reach them
    unedited. Every trigger program still produces its code: TS8017's is a repeated label, not
    a fall-through. The lowering table's `switch` row already ends each case with `break`.
  - A search for the old messages ("Unknown identifier", "Unknown function", "Did you mean")
    finds no copy that quotes one.
- **vscode-typeshade**:
  - `plugins/typeshade/skills/typeshade/SKILL.md` (working loop, step 1) and
    `references/diagnostics.md` say a failed declaration makes every later use a
    `TS8022 Unknown identifier`. That is no longer true. Fixing the first error first stays good
    advice.
  - `references/diagnostics.md`'s TS8017 row gains "a case body that falls through".
    `references/language.md`'s "Cases never fall through" becomes "a case body that would is
    refused; end each with `break`".
  - `docs/design.md` says a missing function reports both TS2304 and TS8004. It reports once
    now.
  - `packages/mcp-server/src/vocabulary.ts` keeps its own `FOREIGN_NAMES` (112 rows), which
    moved into the compiler. It should import that table and `foreignNameRemedy` from
    `typeshade/language-service`, and `docs/agents.md` §3.5 should say so.
  - The `check` tool in `packages/mcp-server/src/tools.ts` can call `checkOpenDocument` in
    place of its own path.
