---
id: '0010'
title: A version number says what an upgrade can break, and a spelling that will mean something else warns for one published minor release first
status: draft
rules:
- '13.9'
- '13.10'
surface: []
exports: []
exports-removed: []
codes: []
examples: []
downstream: []
---

<!-- doc-refs: skip-file — a proposal names the files its implementation adds, which this tree does not have yet -->

## What changes

Roadmap item 25 (`docs/roadmap.md`, section 0.8) asks for semver rules, a deprecation policy and
the release checklist run once for real. The first two are rules about what a version number
promises, so they go into the design rules as chapter 13 ("Change control") rules, beside
Rule 13.8, which already governs the CHANGELOG. The maintainer decided three questions on
2026-09-24, in the session that drafted this proposal:

- a `0.x` version breaks only in its minor;
- the window is one published minor release;
- #148 flips in `0.2.0`, after `0.1.0` has shipped its warning.

**Rule 13.9 (new): what a version number promises.** A published version follows Semantic
Versioning 2.0.0. Before `1.0.0` the minor is the breaking position: a breaking change ships
only in a new `0.N.0`, and a `0.N.P` only fixes and adds. That is how npm's caret range reads
a `0.x` version (`^0.2.0` is `>=0.2.0 <0.3.0`), so a caret range never pulls in a break. From
`1.0.0` a breaking change ships only in a new major.

A change is **breaking** when an upgrade can make a program that worked stop working or work
differently. That covers four cases:

- `compile()` or the language service now refuses a program it accepted;
- a program that compiled computes a different value on a target or on the CPU oracle;
- an export in `src/__api__/surface.md` is removed, or reshaped so that a caller's code no
  longer type-checks;
- the TypeScript peer range narrows.

A change is **not breaking** in four cases:

- the emitted text changes and the values it computes do not;
- a warning is added;
- a program is newly refused that Tint or WebGL2 already refused (Rule 12.6), because it never
  ran;
- a target or the oracle is fixed to compute what WGSL defines, because that is a fix. Its
  CHANGELOG entry goes under `### Fixed` and names the old result.

Every breaking change carries a `CHANGELOG.md` entry that names the edit an author makes to
migrate.

**Rule 13.10 (new): the deprecation window.** A change that keeps a program compiling and makes
it compute something else is the one kind a user cannot see. It ships in two steps, and the
second step comes no earlier than the next breaking release after the first step's release:
the next minor before `1.0.0`, the next major after it.

1. **Warn.** A published release reports every affected line as a `category: 'warning'`
   diagnostic behind the opt-in deprecation option: `compile(src, { deprecations: true })` and
   `typeshade check --deprecations`. The diagnostic names the edit that keeps today's meaning.
   With the option on or off, no emitted byte moves. The release's CHANGELOG names the warning
   and the release that will change the default.
2. **Change.** The default changes, and the warning is retired along with its code. There is a
   `### Changed` entry naming the old meaning, the new one, and the one-line edit that keeps
   the old. Every example golden is re-baked and reviewed.

The window is counted in published releases, not in commits on `main`: a warning that never
reached npm warned nobody. After `1.0.0`, a spelling or an export that will be removed gets the
same window. A removed spelling warns under the same option first. A removed export carries
`@deprecated` in its JSDoc, naming the replacement, for one minor release before the major
that removes it. The site's API reference already prints that tag as a badge. Before `1.0.0` a
removal is a loud break that the refusal's own diagnostic explains (Rule 12.1), so it needs a
minor version and a migration line, not a window.

**Applied to #148.** The first step shipped in #168 (`TS8053`), and it reaches users in
`0.1.0`. The flip may land in `0.2.0` at the earliest. §14's row for the decision becomes
"decided: `i32`, flip in `0.2.0` under Rule 13.10". The row leaves §14 when the flip lands.

## Why

`RELEASING.md` §7 already describes a two-step window, but it is not a rule. It says "at least
one minor release" without saying whether an unpublished minor counts. It does not say which
changes are breaking. And no test or rule names it, so #148's flip had nothing normative to
cite. Semver alone does not answer the question a shader compiler raises. Most emit changes
move bytes without moving values, and the one change that matters most moves values without
refusing anything. The breaking definition above is written for that case.

The maintainer considered and turned down these alternatives:

- Treat everything in `0.x` as open to change (semver item 4 read literally). Then
  `^0.2.0` could pull in a break from a patch.
- A window of two minors, or one minor plus 30 days. Either one makes #148 wait about another
  roadmap phase and protects no known user.
- Flip #148 before `0.1.0`, since nothing is published and the window counts published
  releases. The maintainer preferred to run the window once for real before `1.0.0`.

## What it touches

- **Rule 13.9 (new):** versions, and the definition of a breaking change.
- **Rule 13.10 (new):** the deprecation window. Both get `reqs/rules/` items through
  `bun run reqs:sync`.
- **`docs/language-design.md` §14:** the open-decisions row for the integer-literal default
  records the decision and names Rule 13.10. It is not a rule paragraph.
- **`RELEASING.md`:**
  - §7 is rewritten as the procedure for Rule 13.10, keeping the table of open windows;
  - §1 step 1 chooses the version by Rule 13.9;
  - §1 step 3 gains the gates CI runs that the checklist omits (`bun run lint`,
    `bun run format:check`, `bun run gate:journeys`), which the dry run of 2026-09-24 found
    missing;
  - a new section records that dry run.
- **`CHANGELOG.md`:** the preamble states the `0.x` reading of semver and points to
  Rule 13.9.
- **`docs/roadmap.md`:** row 25 notes what shipped, and row T15 cites Rule 13.10 and `0.2.0`.
- **Tests:**
  - `src/compiler/ts/integer-literal-deprecation.test.ts` carries `Verifies: Rule 13.10`. It
    already asserts that no emitted byte moves with the option on;
  - a new `src/changelog.test.ts` (`Verifies: Rule 13.9`) checks that the version headings
    are `## [Unreleased]` followed by `## [X.Y.Z] - YYYY-MM-DD` in descending order, and that a
    released version whose section has a `### Changed` or `### Removed` entry bumps the minor
    (the major from `1.0.0`) over the version before it.

No surface section, export, diagnostic code or example changes. `TS8053`'s text already names
the edit that keeps `f32`.

## What it owes downstream

Nothing is written by hand. The site's `/reference/rules/` pages are derived from `reqs/` at
the pin (`src/lib/design-rules.ts` in typeshade.github.io), so Rules 13.9 and 13.10 appear
there without an edit. I searched both repositories at their current `main`
(typeshade.github.io 0ab83b2, vscode-typeshade 454544a) for `semver`, `deprecat`,
`breaking change`, `RELEASING` and `Rule 13.`. Nothing states a versioning or deprecation
policy that these rules would contradict. The site's `PRODUCT.md` says `0.1.0` will be the
first release, which stays true.
