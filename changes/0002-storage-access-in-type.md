---
id: '0002'
title: A storage binding's access mode is its second type argument, every binding is declare const, and the editor refuses a write to a read binding
status: accepted
rules:
- '3.6'
- '6.1'
- '6.2'
- '9.6'
surface:
- 1
- 5
- 7
- 8
- 9
- 17
- 19
- 20
- 23
- 24
- 25
- 43
- 49
exports: []
exports-removed: []
codes: []
examples: []
downstream:
- repo: typeshade.github.io
  what: Every `declare let x: storage<T>` the site shows (the language, resources, GPU types and pipeline pages, the error-code examples, the target-mapping and lowering snippets), the resources page's access table, and the uniform refusal copy in both locales
- repo: vscode-typeshade
  what: The skill's binding rule and its three examples (SKILL.md, references/language.md, references/examples.md), and the MCP server's KERNEL fixture
---

## What changes

The implementation is #188 (branch `claude/storage-access-in-type`), written and measured before
proposals existed. This proposal records what it changes so the change can be agreed first, as
`changes/README.md` asks, and holds the merge of that branch to it.

**Before.** The declaration keyword picks the access mode:

```ts
declare const src: storage<array<f32>>   // var<storage, read>
declare let dst: storage<array<f32>>     // var<storage, read_write>
declare const cam: uniform<Camera>       // var<uniform>
```

**After.** The mode is the second type argument, the one place WGSL puts it. Every binding is
`declare const`:

```ts
declare const src: storage<array<f32>>                 // var<storage, read>
declare const dst: storage<array<f32>, "read_write">   // var<storage, read_write>
declare const cam: uniform<Camera>                     // one type argument: a uniform is read-only
```

- **Rule 6.1.** The list of resource spellings names
  `declare const x: storage<T, "read_write">` in place of `declare let x: storage<T>`.
  `declare let` on a `storage<T>` or a `uniform<T>` is refused (`TS8099`). The sentence names
  the `declare const` line to write instead.
- **Rule 6.2.** The access mode is the second type argument, and it takes exactly `"read"` and
  `"read_write"`, WGSL's own enumerants. `uniform<T>` takes one argument. A write to a read-only
  resource is refused by the compiler, as it is today (`TS8005`). The new part is that the
  editor refuses it too: `TS2542` for an indexed write and `TS2540` for a field write.
- **Rule 9.6.** Three type-machinery rows join the §9.3 table: `StorageBufferAccess` (the two
  words), `ReadView` (the read-only view of a binding's value type) and `ArrayOps` (which
  members of `Array<T>` an author-facing array offers).
- **Rule 3.6.** The rationale's sentence on arrays names how a read-only view is built:
  `ReadView`, over the surface's own `interface Array<T>`, which `array<T, N>` picks from
  (`Pick<Array<T>, ArrayOps>`).
- **The call form.** `storage<T>(...)` loses its `{ access }` option. That option is refused
  with `TS8099`, whose sentence names the type-argument spelling.

The emit does not move. #188 measured it over 15 recorded cases and every authored example: the
WGSL, both GLSL stages, `module.bindings` and `reflect()` are identical, and so are the emit
goldens.

## Why

- **The keyword said the wrong thing.** In TypeScript, a `const` array forbids rebinding the
  name and permits `arr[0] = 1`. So `declare let` never told a TypeScript reader "writable",
  and `declare const` never told them "read-only". The code read one way and meant another.
- **The type is where WGSL, and this surface, already put a mode.** WGSL writes
  `var<storage, read_write>`. This surface already writes a storage texture's mode as a type
  argument: `texture_storage_2d<"r32float", "read_write">`.
- **The editor could not refuse the write.** A keyword cannot make an element `readonly`, and
  a type can. With the mode in the type, `src[0] = 1.` on a read binding is red in the editor
  as well as in `compile()`. Rule 12.4 asks the two halves to agree, and this is one of the
  places they did not (#186 is about the same asymmetry).

**Alternatives considered in #188:**

- **Keep the keyword.** It cannot be made true in the editor, for the reason above.
- **A `ReadonlyArray`-shaped view.** It loses `length: N`, so `array<f32, 3>` and
  `array<f32, 2>` become assignable to each other.
- **The full standard `ReadonlyArray`.** It offers 27 completions after `src.`, and
  `src.reduce(...)` becomes clean in the editor although the compiler refuses it.
- **A view built with `infer`.** It leaves a matrix column inside a read binding writable.

## What it touches

- **Rules.**
  - **6.1:** the list of spellings, plus the refusal of `declare let` on a resource.
  - **6.2:** the mode as a type argument, the two words, `uniform<T>`'s single argument, and
    the editor's refusal.
  - **9.6:** the three rows added to its table.
  - **3.6:** the sentence in its rationale.
  - Appendix A's binding row and Appendix B's Rule 6.1 row change with them. The appendices
    carry no rule paragraph of their own.
- **Surface sections.** Each has a binding in its prose or its fences.
  - **§1 and §7:** define the spelling and the refusals.
  - **§5, §8, §9 and §17:** show a writable binding (§17's runtime-bounded loop, which
    `main` added after #188 was written, writes a buffer).
  - **§19, §20 and §23 to §25:** are the call-statement, `.length`, atomics, module-variable
    and barrier sections, whose programs write a buffer.
  - **§43:** names the atomic-on-a-read-binding stage rule.
  - **§49:** gains the two programs the editor now refuses, and the two only the compiler
    refuses.
- **Exports.** None. The three new names are ambient type machinery for `"use typeshade"`
  files, not entries of `src/__api__/surface.md`.
- **Codes.** None added, removed or renumbered. Three existing codes gain sentences:
  - `TS8099`: `declare let` on a resource, and the retired `{ access }` option.
  - `TS8002`: an access word outside the two, and a second argument on `uniform<T>`.
  - `TS8005`: the `storage<T, "read_write">` remedy.
- **Examples.** None added or removed. Every writable binding is migrated, one substitution
  each: 12 bindings across 8 `.shade.ts` examples on today's `main`, and the 4 journey shaders
  under `journeys/`.
- **Tests that will pin it:**
  - `src/compiler/ts/declare-bind.test.ts`: the mode each spelling collects.
  - `src/compiler/ts/remedy-lines.test.ts`: every refusal that quotes a declaration has that <!-- doc-refs: skip — lands with the implementation, on #188's branch -->
    line written back into its own program, which must then be clean in both the compiler and
    the editor.
  - the language-service tests: `TS2542` and `TS2540` on a read binding, and no new diagnostic
    on a `read_write` one.
  - the 43 test files on `main` that declare a writable buffer, migrated.

**Before this is implemented, #188 owes what its own body lists:**

1. A merge of `main`. The branch is at `c54170e`, and `main` has since added Doorstop
   traceability (`reqs/rules/RULE-0601.md`, `RULE-0602.md`), `for…of`, the runtime loop bound,
   and more files that write buffers.
2. Every gate re-run on the result, with the goldens re-baked rather than trusted.
3. The adversarial verification that did not run: rebuild the remedy table independently,
   check the new tests for vacuity, and probe over-refusal on every legal write to a
   `read_write` binding.

## What it owes downstream

This is a breaking change for every file that declares a writable buffer. The migration is one
substitution: `declare let x: storage<T>` becomes `declare const x: storage<T, "read_write">`.

- **typeshade.github.io:** 25 lines on `main` write `declare let x: storage<...>`.
  - **Pages:** `LanguagePage.astro` (3), `LanguageResourcesPage.astro` (2, one of them the
    Declaration / Space / Access table, whose rows become the two type arguments),
    `LanguageGpuTypesPage.astro` and `ConceptsPipelinePage.astro`.
  - **Examples in the site's code:** `src/lib/error-codes.ts` (10, the TS8003, TS8005 and <!-- doc-refs: skip — a file in typeshade.github.io -->
    TS8006 examples among them), `src/lib/target-mapping.ts` (6) and <!-- doc-refs: skip — a file in typeshade.github.io -->
    `src/lib/typescript-lowering.ts` (2). <!-- doc-refs: skip — a file in typeshade.github.io -->
  - **Copy:** the "Do not use `declare let x: uniform<T>`" line in `src/i18n/en.ts` and its <!-- doc-refs: skip — a file in typeshade.github.io -->
    `ko.ts` counterpart, which become the general rule "a binding is `declare const`".
  - **Guide:** the `{ access: 'read_write' }` call in
    `content/guide/ko/capabilities-extensions.md` is the IR authoring layer's <!-- doc-refs: skip — a file in typeshade.github.io -->
    `storageBuffer()`, not the `"use typeshade"` call form, and stays.
- **vscode-typeshade:**
  - **The skill's rule:** `plugins/typeshade/skills/typeshade/references/language.md` says <!-- doc-refs: skip — a file in vscode-typeshade -->
    "`declare let s: storage<T>` is read-write". That line and the atomics line below it change.
  - **The skill's examples:** `SKILL.md` and `references/examples.md` each have one <!-- doc-refs: skip — a file in vscode-typeshade -->
    `declare let` binding. `skill.test.ts` compiles both against the pin, so the pin bump that
    carries this change fails until they move.
  - **The MCP server:** the `KERNEL` fixture in `packages/mcp-server/src/fixtures.ts` declares <!-- doc-refs: skip — a file in vscode-typeshade -->
    `pixels` with `declare let`. Its tests quote line numbers, and the substitution keeps them.
  - Both repositories record `0002` in their `compiler-changes.md` when they pin a compiler
    that carries it (`scripts/downstream-impact.ts`).
