---
id: '0012'
title: A "use typeshade" directive after another top-level statement is refused on the directive, and the rest of the file is still checked
status: accepted
rules:
- '3.1'
surface: []
exports: []
exports-removed: []
codes:
- TS8069
examples: []
downstream:
- repo: typeshade.github.io
  what: A TS8069 entry on the error-code pages (src/lib/error-codes.ts, a trigger with a statement above the directive and its fix) in both locales; the Playground's TS8001 special case stays as it is, since TS8001 keeps meaning "no directive"
- repo: vscode-typeshade
  what: The skill's line on the directive, if it says only that one is required, gains "first"; any TS8001 quick fix is checked to leave a late directive to TS8069
---

This proposal was merged as 0010 (#253) the minute before `0010-versions-and-deprecation-window.md`
(#255) took the same number, and was renumbered to 0012, the next free one, so each id is unique.

<!-- doc-refs: skip-file — a proposal names the code and the test it will add, and files of the repositories downstream, which this tree does not have -->

## What changes

Rule 3.1 already says that a shader file must begin with `"use typeshade"` as its first
statement. The compiler enforces only the file with no directive at all (`TS8001`). A file whose
directive comes after another top-level statement compiles with no diagnostic (#200, and the
Rule 3.1 row of Appendix B):

```ts
class A { x: f32 }
"use typeshade";
@fragment export function fs(): vec4 { return vec4(1.); }
```

After this change the same file gets one error, a new code `TS8069 MISPLACED_DIRECTIVE`, on the
directive:

> `TS8069 "use typeshade" must be the file's first statement: here it follows a class declaration, so TypeScript reads it as an ordinary string and not as a directive. Move it to the top of the file.`

The rest of the file is still lowered and checked, as it is for a file whose directive is in the
right place. So the editor keeps hover, completion and the file's other diagnostics while the
directive is out of place, and `compile()` emits nothing, because the file has an error.
`isTypeshadeSource` still answers `true` for such a file, so a bundler or a host that routes by
it keeps sending the file to the compiler, where the author sees the error. If it answered
`false`, the file would be treated as host TypeScript, silently.

"First statement" means what Rule 3.1 says. A comment is not a statement, so a leading licence
header is allowed. Another string directive before it is not allowed: `"enable f16"` goes
beside and after `"use typeshade"`, as Rule 10.1 and surface §50 already write it. The rule's
text does not change. Its "Enforced by" line gains `TS8069`, and the Appendix B row for Rule 3.1
goes.

## Why

In ECMAScript, a directive is a string-literal statement in the directive prologue, which is
only the leading run of such statements. A `"use typeshade"` after a `class` is not a directive
at all: TypeScript, and any tool that reads the file as TypeScript, sees an expression statement
with no effect. TypeShade treats the same file as a shader. The file means one thing to one of
its readers and another thing to the other, and Rule 12.7 exists to prevent that.

Alternatives considered. The owner decided all three on #253 as recommended here: a new code,
no deprecation window, and the directive strictly first.

1. **`TS8001` with a second sentence**, instead of a new code. This adds no code. But the site's
   Playground replaces any `TS8001` with its own "add the directive" sentence
   (`src/scripts/playground.ts`), and it infers `hasDirective` from the absence of `TS8001`
   (`playground-language-worker.ts`). A late directive would then be shown as a missing one,
   with the wrong remedy, and the Playground would stop emitting. Rule 12.4 (one code per
   mistake) points the same way: "missing" and "misplaced" have different fixes. That is why
   this proposal recommends a new code.
2. **A deprecation window**, as #148 had: a warning first, and an error in a later release.
   #148 changed what an accepted program means. This change refuses a program the rules already
   said was ill-formed. I measured the tree: none of the 155 `"use typeshade"` units (every
   `examples/*.shade.ts` and every `ts` fence in the Markdown) has a statement above its
   directive, and the site's error-code examples do not either. So this proposal recommends an
   error with no window. If the owner prefers the window, the code is the same and only its
   severity changes for one release.
3. **The directive anywhere in the prologue**, so that `"enable f16"; "use typeshade";` is
   accepted. That is the ECMAScript reading, but it changes Rule 3.1's text ("first statement")
   and allows a second spelling that no document shows. This proposal does not take it. It can
   be proposed on its own if someone needs it.

## What it touches

- **Rule 3.1**: only the "Enforced by" line. It names `TS8069` beside `TS8001` and drops the
  "only that is enforced" clause. The Appendix B row for Rule 3.1 (#200) is removed.
- **`TS8069`** (`MISPLACED_DIRECTIVE`): the next free code by Rule 3.7. The sequential range
  ended at `TS8038`, the blocks spent up to `TS8068`, and a block's unused numbers stay a gap.
  It is claimed on #200 when this proposal opens (Rule 13.5). Its row goes in
  `docs/language-service-api.md`'s code table.
- **No surface section.** The surface document has no section on the directive. §50's examples
  already put `"enable …"` after it.
- Tests (both halves on the same source, as CLAUDE.md asks):
  - a new `src/compiler/ts/directive-placement.test.ts`. It covers `compile()`'s diagnostics
    (code, text, span on the directive) for a class, a function, an `"enable f16"` and a `const`
    above the directive. It also covers the language service's `getDiagnostics` on the same
    sources, and that hover still answers in such a file.
  - the valid neighbours: a leading comment, `"use typeshade"` followed by `"enable f16"`, and a
    file with no directive (still `TS8001`, unchanged).
  - `isTypeshadeSource` stays `true` for a late directive.

## What it owes downstream

- **typeshade.github.io**:
  - a `TS8069` entry in `src/lib/error-codes.ts` in both locales, with a trigger that puts a
    `class` above the directive and a fix that moves the directive up. The page's own test holds
    the trigger to producing `TS8069` and the fix to compiling clean.
  - Nothing else moves. `TS8001` keeps its meaning, so the Playground's special case (lines
    2135 and 2187 of `src/scripts/playground.ts`) and the worker's `hasDirective` inference stay
    correct.
- **vscode-typeshade**: the skill's sentence on the directive, if it says only that one is
  required, says "the first statement". A `TS8001` quick fix, if one inserts the directive,
  is checked to leave a late directive alone, since `TS8069`'s fix is to move it and not to add
  a second one.
